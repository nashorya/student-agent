import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  annotateCompactionPromptTokens,
  assessJspaceRunValidity,
  buildJspaceFeatureManifest,
  compareRunStructures,
  extractRunStructure,
  noOpNeutralityResult,
  summarizeBoundaryContextUsage,
  summarizeEffectiveParams,
  summarizeProviderTokenUsage,
  summarizeThinkingEvidence,
  type RunStructure,
  writeJspaceRunArtifacts,
} from '../jspace-compaction-runner.js';

const outputDirs: string[] = [];

afterEach(async () => {
  await Promise.all(outputDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('J-space compaction probe arm isolation', () => {
  const structure = (overrides: Partial<RunStructure> = {}): RunStructure => ({
    modelCalls: 4,
    toolSequence: ['read', 'read', 'edit', 'bash'],
    boundaryMsgCounts: [8],
    perCheck: { config: true, protectedFiles: true },
    ...overrides,
  });

  it('keeps the fixture instruction free of eval language and seals earlier audit materials', async () => {
    const taskRoot = resolve('evals/tasks/jspace-compaction-probe-01');
    const instruction = await readFile(join(taskRoot, 'instruction.md'), 'utf8');
    for (const forbidden of ['压缩', 'compaction', '摘要', '恢复', '探针', '评测', '测试', '上下文体量']) {
      expect(instruction.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(instruction).toContain('从本阶段起，Phase 1-2 的审计材料已经封存');

    const decisionLedger = await readFile(join(
      taskRoot,
      'environment/docs/ledgers/phase-2/vendor-compatibility-004.md',
    ), 'utf8');
    expect(decisionLedger).not.toContain('mode=bridge');
    expect(decisionLedger).not.toContain('preserveLegacyIds=true');
    expect(decisionLedger).not.toContain('reportTag=APAC-R7');
  });

  it('locks the generated ledger distribution and token-volume budget', async () => {
    const ledgerRoot = resolve('evals/tasks/jspace-compaction-probe-01/environment/docs/ledgers');
    let laterPhaseChars = 0;
    let markerCount = 0;
    let decisionEvidenceCount = 0;
    for (const phase of [1, 2, 3, 4]) {
      const directory = join(ledgerRoot, `phase-${phase}`);
      const names = (await readdir(directory)).filter((name) => name.endsWith('.md'));
      expect(names.length).toBeGreaterThanOrEqual(2);
      expect(names.length).toBeLessThanOrEqual(4);
      for (const name of names) {
        const content = await readFile(join(directory, name), 'utf8');
        const estimatedTokens = Buffer.byteLength(content, 'utf8') / 3.5;
        expect(estimatedTokens).toBeGreaterThanOrEqual(3_000);
        expect(estimatedTokens).toBeLessThanOrEqual(6_000);
        if (phase >= 3) laterPhaseChars += Buffer.byteLength(content, 'utf8');
        markerCount += content.includes('CONTROL_MARKER:') ? 1 : 0;
        decisionEvidenceCount += content.includes('AUDIT_FINDING:') ? 1 : 0;
      }
    }
    expect(laterPhaseChars / 3.5).toBeGreaterThanOrEqual(25_000);
    expect(markerCount).toBe(3);
    expect(decisionEvidenceCount).toBe(1);
  });

  it('keeps every model-facing context runtime feature disabled in the plain arm', () => {
    expect(buildJspaceFeatureManifest('plain')).toEqual({
      arm: 'plain',
      piBuiltInCompaction: true,
      contextRuntime: false,
      memorySystemPrefix: false,
      taskLedgerModelInjection: false,
      recallModelInjection: false,
      checkpointInjection: false,
      jspaceInjection: false,
    });
  });

  it('records the repository context runtime features in the current arm', () => {
    expect(buildJspaceFeatureManifest('current')).toMatchObject({
      arm: 'current',
      piBuiltInCompaction: true,
      contextRuntime: true,
      memorySystemPrefix: true,
      taskLedgerModelInjection: true,
      recallModelInjection: true,
      checkpointInjection: false,
      jspaceInjection: false,
    });
  });

  it('extracts a normalized structure from protected run artifacts', () => {
    expect(extractRunStructure({
      usageEvents: [{ index: 1, usage: {} as never }, { index: 2, usage: {} as never }],
      providerRequestAudit: [
        { index: 1, at: '', url: '', model: 'glm-5.2', thinking: {}, temperature: 0, doSample: false, compliant: true },
        { index: 2, at: '', url: '', model: 'glm-5.2', thinking: {}, temperature: 0, doSample: false, compliant: true },
        { index: 3, at: '', url: '', model: 'glm-5.2', thinking: {}, temperature: 0, doSample: false, compliant: true },
      ],
      toolCalls: [
        { id: '1', name: 'student_read', args: {}, startedAt: '' },
        { id: '2', name: 'BASH', args: {}, startedAt: '' },
      ],
      compactionEvents: [{
        kind: 'boundary_observed',
        boundary: 'phase:1',
        observedAt: '',
        state: { messages: 6, entries: 7 },
      }],
    }, {
      exitCode: 0,
      correctnessScore: 1,
      perCheck: { config: true },
    })).toEqual({
      modelCalls: 3,
      toolSequence: ['read', 'bash'],
      boundaryMsgCounts: [6],
      perCheck: { config: true },
    });
  });

  it('states explicitly when response-side reasoning proves thinking is active', () => {
    expect(summarizeThinkingEvidence([{
      index: 1,
      at: '',
      url: '',
      model: 'glm-5.2',
      thinking: { type: 'enabled' },
      temperature: 0,
      doSample: false,
      compliant: true,
      response: {
        httpStatus: 200,
        inspected: true,
        hasReasoningContent: true,
        reasoningChars: 42,
        reasoningTokens: 11,
      },
    }])).toEqual({
      requestCount: 1,
      requestPolicyCompliant: true,
      thinkingRequested: true,
      responsesInspected: 1,
      responsesWithReasoning: 1,
      reasoningChars: 42,
      reasoningTokens: 11,
      thinkingActive: true,
      verdict: 'active',
    });
  });

  it('reports effective request parameters from final provider bodies', () => {
    expect(summarizeEffectiveParams([{
      index: 1,
      at: '',
      url: '',
      model: 'glm-5.2',
      thinking: { type: 'enabled' },
      temperature: 0,
      doSample: false,
      compliant: true,
    }])).toEqual({
      requestCount: 1,
      consistent: true,
      model: 'glm-5.2',
      thinking: { type: 'enabled' },
      temperature: 0,
      do_sample: false,
    });
  });

  it('summarizes provider token usage and keeps subscription cost distinct', () => {
    expect(summarizeProviderTokenUsage([{
      index: 1,
      at: '',
      url: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
      model: 'glm-5.2',
      thinking: { type: 'enabled' },
      temperature: 0,
      doSample: false,
      compliant: true,
      response: {
        httpStatus: 200,
        inspected: true,
        hasReasoningContent: true,
        reasoningChars: 20,
        promptTokens: 100_000,
        cachedPromptTokens: 25_000,
        completionTokens: 10_000,
        totalTokens: 110_000,
        reasoningTokens: 4_000,
      },
    }], {
      inputTokens: 99_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 9_000,
      totalTokens: 108_000,
      costUsd: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    })).toMatchObject({
      promptTokens: 100_000,
      cachedPromptTokens: 25_000,
      uncachedPromptTokens: 75_000,
      completionTokens: 10_000,
      reasoningTokens: 4_000,
      totalTokens: 110_000,
      peakPromptTokens: 100_000,
      estimatedCostUsd: null,
      listPriceEquivalentCny: 0.93,
      billingMode: 'coding_plan_subscription',
      source: 'provider_response',
      providerResponsesWithUsage: 1,
    });
  });

  it('measures prompt size at each observed compaction boundary', () => {
    expect(summarizeBoundaryContextUsage([{
      index: 1,
      at: '2026-07-16T10:00:00.000Z',
      url: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
      model: 'glm-5.2',
      thinking: { type: 'enabled' },
      temperature: 0,
      doSample: false,
      compliant: true,
      response: {
        httpStatus: 200,
        inspected: true,
        hasReasoningContent: true,
        reasoningChars: 5,
        promptTokens: 60_000,
      },
    }], [{
      kind: 'boundary_observed',
      boundary: 'phase:2',
      observedAt: '2026-07-16T10:01:00.000Z',
      state: { messages: 10, entries: 12 },
    }])).toEqual({
      targetPromptTokens: { min: 50_000, max: 80_000 },
      allBoundariesMeasured: true,
      allWithinTarget: true,
      boundaries: [{
        boundary: 'phase:2',
        observedAt: '2026-07-16T10:01:00.000Z',
        requestIndex: 1,
        promptTokens: 60_000,
        withinTarget: true,
      }],
    });
  });

  it('marks a run incomplete when phases or expected boundaries are missing', () => {
    expect(assessJspaceRunValidity({
      status: 'success',
      mode: 'task',
      taskState: {
        status: 'active',
        phases: [
          { description: 'phase 1', status: 'in_progress', retryCount: 0 },
          { description: 'phase 2', status: 'pending', retryCount: 0 },
        ],
      },
      compactionEvents: [],
    }, [1])).toMatchObject({
      valid: false,
      status: 'incomplete',
      expectedBoundaries: ['phase:1'],
      observedBoundaries: [],
    });
  });

  it('invalidates a run when eval context truncates protected sections', () => {
    expect(assessJspaceRunValidity({
      status: 'success',
      mode: 'task',
      taskState: {
        status: 'completed',
        phases: [{ description: 'phase 1', status: 'completed', retryCount: 0 }],
      },
      compactionEvents: [{
        kind: 'boundary_observed',
        boundary: 'phase:2',
        observedAt: '2026-07-17T00:00:00.000Z',
        state: { messages: 20, entries: 22 },
      }],
      contextAssemblyTraces: [{ truncated: ['hardConstraints', 'taskSpec', 'knacks'] }],
    }, [2])).toMatchObject({
      valid: false,
      status: 'incomplete',
      reasons: expect.arrayContaining([
        expect.stringContaining('hardConstraints'),
        expect.stringContaining('taskSpec'),
      ]),
    });
  });

  it('does not invalidate a run when only non-protected context is truncated', () => {
    expect(assessJspaceRunValidity({
      status: 'success',
      mode: 'task',
      taskState: {
        status: 'completed',
        phases: [{ description: 'phase 1', status: 'completed', retryCount: 0 }],
      },
      compactionEvents: [{
        kind: 'boundary_observed',
        boundary: 'phase:2',
        observedAt: '2026-07-17T00:00:00.000Z',
        state: { messages: 20, entries: 22 },
      }],
      contextAssemblyTraces: [{ truncated: ['knacks'] }],
    }, [2])).toMatchObject({ valid: true, status: 'complete', reasons: [] });
  });

  it('derives prompt tokens before and after each forced event from adjacent usage records', () => {
    const events = [{
      kind: 'forced_compaction' as const,
      boundary: 'phase:2',
      requestedAt: '2026-07-16T10:00:00.000Z',
      completedAt: '2026-07-16T10:00:10.000Z',
      nextPhaseStartedAt: '2026-07-16T10:00:20.000Z',
      status: 'completed' as const,
      productApi: 'AgentSession.compact' as const,
      lifecycle: { startObserved: true, endObserved: true, reason: 'manual' as const },
      state: {
        messagesBefore: 28,
        messagesAfter: 12,
        entriesBefore: 30,
        entriesAfter: 14,
        changed: true,
        promptTokensBefore: null,
        promptTokensAfter: null,
      },
    }];

    annotateCompactionPromptTokens(events, [
      { seq: 6, ts: '2026-07-16T09:59:55.000Z', promptTokens: 60000, cachedPromptTokens: 0, completionTokens: 600 },
      { seq: 7, ts: '2026-07-16T10:00:05.000Z', promptTokens: 61000, cachedPromptTokens: 0, completionTokens: 500 },
      { seq: 8, ts: '2026-07-16T10:00:25.000Z', promptTokens: 30000, cachedPromptTokens: 0, completionTokens: 400 },
    ]);

    expect(events[0].state).toMatchObject({
      promptTokensBefore: 60000,
      promptTokensAfter: 30000,
    });
  });

  it('invalidates a forced run when messages do not shrink or prompt tokens drop less than 40 percent', () => {
    expect(assessJspaceRunValidity({
      status: 'success',
      mode: 'task',
      taskState: {
        status: 'completed',
        phases: [{ description: 'phase 1', status: 'completed', retryCount: 0 }],
      },
      compactionEvents: [{
        kind: 'boundary_observed',
        boundary: 'phase:2',
        observedAt: '2026-07-16T10:00:00.000Z',
        state: { messages: 28, entries: 30 },
      }, {
        kind: 'forced_compaction',
        boundary: 'phase:2',
        requestedAt: '2026-07-16T10:00:01.000Z',
        completedAt: '2026-07-16T10:00:10.000Z',
        status: 'completed',
        productApi: 'AgentSession.compact',
        lifecycle: { startObserved: true, endObserved: true, reason: 'manual' },
        state: {
          messagesBefore: 28,
          messagesAfter: 28,
          entriesBefore: 30,
          entriesAfter: 31,
          changed: true,
          promptTokensBefore: 60000,
          promptTokensAfter: 40000,
        },
      }],
    }, [2], undefined, { requireEffectiveCompaction: true })).toMatchObject({
      valid: false,
      status: 'compaction_ineffective',
      reasons: expect.arrayContaining([
        expect.stringContaining('phase:2'),
      ]),
    });
  });

  it('accepts a forced run when messages shrink and prompt tokens drop at least 40 percent', () => {
    expect(assessJspaceRunValidity({
      status: 'success',
      mode: 'task',
      taskState: {
        status: 'completed',
        phases: [{ description: 'phase 1', status: 'completed', retryCount: 0 }],
      },
      compactionEvents: [{
        kind: 'boundary_observed',
        boundary: 'phase:2',
        observedAt: '2026-07-16T10:00:00.000Z',
        state: { messages: 28, entries: 30 },
      }, {
        kind: 'forced_compaction',
        boundary: 'phase:2',
        requestedAt: '2026-07-16T10:00:01.000Z',
        completedAt: '2026-07-16T10:00:10.000Z',
        status: 'completed',
        productApi: 'AgentSession.compact',
        lifecycle: { startObserved: true, endObserved: true, reason: 'manual' },
        state: {
          messagesBefore: 28,
          messagesAfter: 12,
          entriesBefore: 30,
          entriesAfter: 14,
          changed: true,
          promptTokensBefore: 60000,
          promptTokensAfter: 36000,
        },
      }],
    }, [2], undefined, { requireEffectiveCompaction: true })).toMatchObject({
      valid: true,
      status: 'complete',
    });
  });

  it('invalidates a forced run that rereads sealed decision material after phase 2', () => {
    expect(assessJspaceRunValidity({
      status: 'success',
      mode: 'task',
      taskState: {
        status: 'completed',
        phases: [{ description: 'phase 1', status: 'completed', retryCount: 0 }],
      },
      toolCalls: [{
        id: 'late-search',
        name: 'search_files',
        args: { query: 'APAC-R7' },
        startedAt: '2026-07-16T10:01:00.000Z',
        resultText: 'docs/migration-map.md:8: | R7 | apac | bridge | true | APAC-R7 |',
      }],
      compactionEvents: [{
        kind: 'boundary_observed',
        boundary: 'phase:2',
        observedAt: '2026-07-16T10:00:00.000Z',
        state: { messages: 28, entries: 30 },
      }, {
        kind: 'forced_compaction',
        boundary: 'phase:2',
        requestedAt: '2026-07-16T10:00:01.000Z',
        completedAt: '2026-07-16T10:00:10.000Z',
        nextPhaseStartedAt: '2026-07-16T10:00:10.000Z',
        status: 'completed',
        productApi: 'AgentSession.compact',
        lifecycle: { startObserved: true, endObserved: true, reason: 'manual' },
        state: {
          messagesBefore: 28,
          messagesAfter: 12,
          entriesBefore: 30,
          entriesAfter: 14,
          changed: true,
          promptTokensBefore: 60000,
          promptTokensAfter: 30000,
        },
      }],
    }, [2], undefined, {
      requireEffectiveCompaction: true,
      rejectSealedMaterialReads: true,
    })).toMatchObject({
      valid: false,
      status: 'invalid_probe_leakage',
      reasons: [expect.stringContaining('docs/migration-map.md')],
    });
  });

  it('accepts a deadline-overrun run when all checks pass and boundaries were observed', () => {
    expect(assessJspaceRunValidity({
      status: 'success',
      mode: 'task',
      taskState: {
        status: 'phase_wall_clock_exceeded',
        phases: [
          { description: 'phase 1', status: 'completed', retryCount: 0 },
          { description: 'phase 2', status: 'in_progress', retryCount: 0 },
        ],
      },
      compactionEvents: [{
        kind: 'boundary_observed',
        boundary: 'phase:1',
        observedAt: '',
        state: { messages: 12, entries: 14 },
      }],
    }, [1], {
      perCheck: { config: true, checklist: true, runner: true },
    })).toMatchObject({
      valid: true,
      status: 'complete',
      reasons: [],
      annotations: expect.arrayContaining([
        'accepted as complete because all verifier checks passed and all boundaries were observed',
      ]),
    });
  });

  it('treats identical strict structures plus boundary observations as neutral', () => {
    expect(noOpNeutralityResult({
      mode: 'strict',
      control: { status: 'success', structure: structure() },
      noOp: {
        status: 'success',
        structure: structure(),
        compactionEvents: [{
          kind: 'boundary_observed',
          boundary: 'phase:1',
          observedAt: '',
          state: { messages: 8, entries: 8 },
        }],
      },
    })).toEqual({
      neutral: true,
      mode: 'strict',
      reason: 'control and no-op structures match exactly',
    });
  });

  it('reports the first strict tool-sequence divergence structurally', () => {
    expect(noOpNeutralityResult({
      mode: 'strict',
      control: { status: 'success', structure: structure() },
      noOp: {
        status: 'success',
        structure: structure({ toolSequence: ['read', 'read', 'edit', 'edit'] }),
        compactionEvents: [],
      },
    })).toMatchObject({
      neutral: false,
      mode: 'strict',
      failedOn: 'toolSequence',
      divergedAtStep: 4,
      control: ['read', 'read', 'edit', 'bash'],
      noOp: ['read', 'read', 'edit', 'edit'],
    });
  });

  it('reports verifier divergence before lower-level trajectory noise', () => {
    expect(compareRunStructures(
      'strict',
      structure({ modelCalls: 3, perCheck: { config: true } }),
      structure({ modelCalls: 9, perCheck: { config: false } }),
    )).toMatchObject({
      neutral: false,
      failedOn: 'perCheck',
      control: { config: true },
      noOp: { config: false },
    });
  });

  it('accepts tolerant model-call noise and an 80 percent shared tool prefix', () => {
    const tools = ['read', 'read', 'edit', 'bash', 'read'];
    expect(noOpNeutralityResult({
      mode: 'tolerant',
      control: { status: 'success', structure: structure({ modelCalls: 5, toolSequence: tools }) },
      noOp: {
        status: 'success',
        structure: structure({ modelCalls: 7, toolSequence: [...tools, 'bash'] }),
        compactionEvents: [],
      },
    }).neutral).toBe(true);
  });

  it('writes the protected per-run evidence artifacts', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'jspace-artifacts-'));
    outputDirs.push(outputDir);

    await writeJspaceRunArtifacts(outputDir, {
      featureManifest: buildJspaceFeatureManifest('plain'),
      compactionEvents: [{ boundary: 'phase:2' }],
      usageEvents: [{ index: 1 }],
      toolTrace: [{ name: 'read' }],
      verifierResult: { correctnessScore: 1 },
      providerRequestAudit: [{ model: 'glm-5.2', compliant: true }],
      runStructure: structure(),
      thinkingEvidence: { thinkingActive: true, verdict: 'active' },
      effectiveParams: { model: 'glm-5.2', thinking: { type: 'enabled' }, temperature: 0 },
      runValidity: { valid: true, status: 'complete' },
      tokenUsage: { promptTokens: 100, completionTokens: 20 },
      contextVolume: { allWithinTarget: true },
      compactionSummaries: { 'phase:2': 'Pi summary text' },
      postCompactionPrompts: { 'phase:2': '[{"role":"user","content":"Phase 3"}]' },
      sandboxPath: '/tmp/probe-sandbox',
    });

    await expect(readFile(join(outputDir, 'feature-manifest.json'), 'utf8'))
      .resolves.toContain('"arm": "plain"');
    await expect(readFile(join(outputDir, 'compaction-events.json'), 'utf8'))
      .resolves.toContain('phase:2');
    await expect(readFile(join(outputDir, 'usage-events.json'), 'utf8'))
      .resolves.toContain('"index": 1');
    await expect(readFile(join(outputDir, 'tool-trace.json'), 'utf8'))
      .resolves.toContain('"name": "read"');
    await expect(readFile(join(outputDir, 'verifier-result.json'), 'utf8'))
      .resolves.toContain('"correctnessScore": 1');
    await expect(readFile(join(outputDir, 'run.json'), 'utf8'))
      .resolves.toContain('/tmp/probe-sandbox');
    await expect(readFile(join(outputDir, 'provider-request-audit.json'), 'utf8'))
      .resolves.toContain('glm-5.2');
    await expect(readFile(join(outputDir, 'run-structure.json'), 'utf8'))
      .resolves.toContain('toolSequence');
    await expect(readFile(join(outputDir, 'thinking-evidence.json'), 'utf8'))
      .resolves.toContain('thinkingActive');
    await expect(readFile(join(outputDir, 'effective-params.json'), 'utf8'))
      .resolves.toContain('glm-5.2');
    await expect(readFile(join(outputDir, 'run-validity.json'), 'utf8'))
      .resolves.toContain('complete');
    await expect(readFile(join(outputDir, 'token-usage.json'), 'utf8'))
      .resolves.toContain('promptTokens');
    await expect(readFile(join(outputDir, 'context-volume.json'), 'utf8'))
      .resolves.toContain('allWithinTarget');
    await expect(readFile(join(outputDir, 'compaction-summary-phase-2.txt'), 'utf8'))
      .resolves.toBe('Pi summary text\n');
    await expect(readFile(join(outputDir, 'post-compaction-prompt-phase-2.txt'), 'utf8'))
      .resolves.toContain('Phase 3');
  });
});
