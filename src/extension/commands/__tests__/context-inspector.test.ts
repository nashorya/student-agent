import { appendFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WriteQueue } from '../../../core/write-queue.js';
import { TaskLedgerManager } from '../../../memory/tasks/task-ledger-manager.js';
import { TasksManager } from '../../../memory/tasks/manager.js';
import {
  formatContextInspection,
  inspectContext,
  type ContextInspectorResult,
} from '../context-inspector.js';

describe('Context Inspector', () => {
  let memoryDir: string;

  beforeEach(async () => {
    memoryDir = await mkdtemp(join(tmpdir(), 'context-inspector-test-'));
    resetState();
  });

  afterEach(async () => {
    resetState();
    await rm(memoryDir, { recursive: true, force: true });
  });

  it('returns safe minimal diagnostics when there is no active task', async () => {
    const result = await inspectContext(memoryDir);

    expect(result.tier).toBe('minimal');
    expect(result.tierReason).toContain('no active task');
    expect(result.budget).toBe(2500);
    expect(result.workingMemory).toEqual({
      taskId: null,
      phase: null,
      goal: null,
      currentStep: null,
      recentErrorCount: 0,
      recentSignalCount: 0,
    });
    expect(result.ledger).toEqual({
      factCount: 0,
      confirmedCount: 0,
      tentativeCount: 0,
      rejectionCount: 0,
      hardRejectionCount: 0,
      softRejectionCount: 0,
      openQuestionCount: 0,
    });
    expect(result.recall).toEqual({
      strategyGenes: { count: 0, limit: 0 },
      preferences: { count: 0, limit: 0 },
      docFindings: { count: 0, limit: 0 },
      historicalSnapshots: { count: 0, limit: 0 },
      artifactRefs: { count: 0, limit: 0 },
    });
    expect(result.topItem).toBeNull();
    expect(result.diagnostics).toEqual({
      queryText: '',
      triggerSummary: 'signalKinds: none, paths: none',
      totalCandidates: 0,
      droppedCount: 0,
      estimatedTokens: 0,
      truncatedSections: [],
      piSchemaRenderMode: 'summary',
      fullPiSchemaRendered: false,
      evalAutonomyRuleEnabled: false,
      anthropicExecutionOverrideEnabled: false,
    });
  });

  it('inspects active task working memory, ledger, recall, scoring, and builder diagnostics', async () => {
    const task = await TasksManager.getInstance(memoryDir).createTask('Context task', ['Inspect context'], {
      workflowStatus: 'executing',
      workingMemory: {
        phase: 'executing',
        goal: 'Fix Hashline stale edit retry behavior',
        currentStep: 'Inspect runtime context',
        recentErrors: [{
          id: 'err_1',
          source: 'hashline',
          pattern: 'stale_rejection',
          summary: 'Hashline stale rejection',
          createdAt: '2026-01-01T00:00:00.000Z',
        }],
        recentSignals: [{
          id: 'sig_1',
          kind: 'hashline_rejection',
          summary: 'Hashline stale rejection',
          severity: 'high',
          createdAt: '2026-01-01T00:00:00.000Z',
        }],
      },
    });
    const ledger = new TaskLedgerManager(memoryDir, task.id);
    await ledger.addFact({
      content: 'Use ContextBuilder for prompt budgets',
      source: 'user',
      confidence: 'confirmed',
    });
    await ledger.addFact({
      content: 'Recall item may be present',
      source: 'inference',
      confidence: 'tentative',
    });
    await ledger.addRejection({
      assumption: 'Blindly retry stale edits',
      reason: 'User correction requires fresh read first',
      source: 'user_correction',
      severity: 'hard',
    });
    await ledger.addRejection({
      assumption: 'Generated docs are authoritative',
      reason: 'Need verification',
      source: 'tool_error',
      severity: 'soft',
    });
    await ledger.addQuestion({
      question: 'Should /context include payloads?',
      context: 'Inspector output must stay compact',
    });
    await appendKnack(memoryDir);

    const result = await inspectContext(memoryDir);

    expect(result.tier).toBe('standard');
    expect(result.tierReason).toContain('default');
    expect(result.workingMemory).toMatchObject({
      taskId: task.id,
      phase: 'executing',
      goal: 'Fix Hashline stale edit retry behavior',
      currentStep: 'Inspect runtime context',
      recentErrorCount: 1,
      recentSignalCount: 1,
    });
    expect(result.ledger).toMatchObject({
      factCount: 2,
      confirmedCount: 1,
      tentativeCount: 1,
      rejectionCount: 2,
      hardRejectionCount: 1,
      softRejectionCount: 1,
      openQuestionCount: 1,
    });
    expect(result.recall.strategyGenes).toEqual({ count: 1, limit: 3 });
    expect(result.recall.preferences).toEqual({ count: 0, limit: 2 });
    expect(result.recall.docFindings).toEqual({ count: 0, limit: 2 });
    expect(result.recall.historicalSnapshots).toEqual({ count: 0, limit: 1 });
    expect(result.recall.artifactRefs).toEqual({ count: 0, limit: 2 });
    expect(result.topItem?.id).toBe('knack_context');
    expect(result.topItem?.total).toBeGreaterThan(0);
    expect(result.topItem?.dimensions).toEqual(expect.objectContaining({
      trigger: expect.any(Number),
      keyword: expect.any(Number),
      recency: expect.any(Number),
      relevance: expect.any(Number),
      metadata: expect.any(Number),
      evidence: expect.any(Number),
    }));
    expect(result.diagnostics.totalCandidates).toBe(1);
    expect(result.diagnostics.droppedCount).toBe(0);
    expect(result.diagnostics.queryText).toContain('Fix Hashline stale edit retry behavior');
    expect(result.diagnostics.triggerSummary).toContain('hashline_rejection');
    expect(result.diagnostics.estimatedTokens).toBeGreaterThan(0);
    expect(result.diagnostics.truncatedSections).toEqual([]);
    expect(result.diagnostics.piSchemaRenderMode).toBe('summary');
    expect(result.diagnostics.fullPiSchemaRendered).toBe(false);
    expect(result.diagnostics.evalAutonomyRuleEnabled).toBe(false);
  });

  it('does not write a recall index while inspecting context', async () => {
    await TasksManager.getInstance(memoryDir).createTask('Readonly task', ['Inspect'], {
      workflowStatus: 'executing',
      workingMemory: {
        goal: 'Readonly context inspection',
        phase: 'executing',
        currentStep: 'Run inspector',
      },
    });
    await appendKnack(memoryDir);

    await inspectContext(memoryDir);

    await expect(stat(join(memoryDir, 'recall-index.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('formats inspection output with stable sections, none values, and fixed score precision', () => {
    const output = formatContextInspection(sampleInspection({
      topItem: {
        id: 'knack_1',
        total: 0.98765,
        dimensions: {
          trigger: 0.12345,
          keyword: 0.2,
          recency: 0,
          relevance: 0.44444,
          metadata: 1,
          evidence: 0.55555,
        },
      },
      diagnostics: {
        queryText: 'x'.repeat(200),
        triggerSummary: 'signalKinds: tool_error, paths: src/app.ts',
        totalCandidates: 3,
        droppedCount: 1,
        estimatedTokens: 1234,
        truncatedSections: [],
        piSchemaRenderMode: 'summary',
        fullPiSchemaRendered: false,
        evalAutonomyRuleEnabled: false,
        anthropicExecutionOverrideEnabled: false,
      },
    }));

    expect(output).toContain('=== Context Inspector ===');
    expect(output).toContain('[L1 Tier]');
    expect(output).toContain('[L1 Budget]');
    expect(output).toContain('[L2 Working Memory]');
    expect(output).toContain('[L2 Task Ledger]');
    expect(output).toContain('[L3 Recall Results]');
    expect(output).toContain('Strategy Genes');
    expect(output).toContain('[L3 Scoring]');
    expect(output).toContain('[Diagnostics]');
    expect(output).toContain('Task: none');
    expect(output).toContain('Top item: knack_1 (total: 0.988, trigger: 0.123, keyword: 0.200, recency: 0.000, relevance: 0.444, metadata: 1.000, evidence: 0.556)');
    expect(output).toContain('Truncated sections: none');
    expect(output).toContain('Pi schema render mode: summary');
    expect(output).toContain('Full pi schema rendered: false');
    expect(output).toContain('Eval autonomy rule enabled: false');
    const queryLine = output.split('\n').find((line) => line.includes('Query text:')) ?? '';
    expect(queryLine.length).toBeLessThan(210);
  });

  it('formats no top item as none', () => {
    const output = formatContextInspection(sampleInspection());

    expect(output).toContain('Top item: none');
    expect(output).toContain('Goal: none');
  });
});

async function appendKnack(memoryDir: string): Promise<void> {
  await appendFile(join(memoryDir, 'knacks.jsonl'), JSON.stringify({
    id: 'knack_context',
    lessonCandidateId: 'lesson_1',
    status: 'candidate',
    summary: 'Use ContextBuilder diagnostics when inspecting Hashline stale retry context',
    trigger: {
      signalKinds: ['hashline_rejection'],
      paths: ['src/hashline.ts'],
      toolNames: ['hashline_edit'],
    },
    recall: {
      trigger: {
        signalKinds: ['hashline_rejection'],
        paths: ['src/hashline.ts'],
        toolNames: ['hashline_edit'],
      },
      applicableWhen: ['Fix Hashline stale edit retry behavior'],
      doNotApplyWhen: [],
      tags: ['context'],
    },
    evidenceRefs: ['sig_1'],
    counterexamples: [],
    allowPromptInjection: true,
    writesHardToolRule: false,
    breakerReport: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) + '\n', 'utf-8');
}

function sampleInspection(overrides: Partial<ContextInspectorResult> = {}): ContextInspectorResult {
  return {
    tier: 'minimal',
    tierReason: 'no active task',
    budget: 2500,
    workingMemory: {
      taskId: null,
      phase: null,
      goal: null,
      currentStep: null,
      recentErrorCount: 0,
      recentSignalCount: 0,
    },
    ledger: {
      factCount: 0,
      confirmedCount: 0,
      tentativeCount: 0,
      rejectionCount: 0,
      hardRejectionCount: 0,
      softRejectionCount: 0,
      openQuestionCount: 0,
    },
    recall: {
      strategyGenes: { count: 0, limit: 0 },
      preferences: { count: 0, limit: 0 },
      docFindings: { count: 0, limit: 0 },
      historicalSnapshots: { count: 0, limit: 0 },
      artifactRefs: { count: 0, limit: 0 },
    },
    topItem: null,
    diagnostics: {
      queryText: '',
      triggerSummary: 'signalKinds: none, paths: none',
      totalCandidates: 0,
      droppedCount: 0,
      estimatedTokens: 0,
      truncatedSections: [],
      piSchemaRenderMode: 'summary',
      fullPiSchemaRendered: false,
      evalAutonomyRuleEnabled: false,
      anthropicExecutionOverrideEnabled: false,
    },
    ...overrides,
  };
}

function resetState(): void {
  TasksManager.resetInstance();
  WriteQueue.resetInstance();
}
