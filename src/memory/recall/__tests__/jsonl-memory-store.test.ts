import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WriteQueue } from '../../../core/write-queue.js';
import { PreferencesManager } from '../../preferences/manager.js';
import { JsonlMemoryStore } from '../jsonl-memory-store.js';
import type { Knack } from '../../knacks/index.js';
import type { DocFinding } from '../types.js';

describe('JsonlMemoryStore', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'recall-store-test-'));
    PreferencesManager.resetInstance();
    WriteQueue.resetInstance();
  });

  afterEach(async () => {
    PreferencesManager.resetInstance();
    WriteQueue.resetInstance();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('recalls knacks, preferences, and doc findings through one metadata contract', async () => {
    await writeKnack(tmpDir, {
      id: 'knack_1',
      lessonCandidateId: 'lesson_1',
      status: 'candidate',
      summary: 'Re-read files after a tool edit error before retrying',
      trigger: {
        signalKinds: ['tool_error'],
        paths: ['src/App.tsx'],
      },
      recall: {
        trigger: {
          signalKinds: ['tool_error'],
          paths: ['src/App.tsx'],
          keywords: ['retry', 'edit'],
        },
        applicableWhen: ['Retrying an edit after a failed tool call'],
        doNotApplyWhen: ['No edit tool failed'],
      },
      evidenceRefs: ['call_1'],
      counterexamples: [],
      allowPromptInjection: true,
      writesHardToolRule: false,
      breakerReport: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await PreferencesManager.getInstance(tmpDir).addExplicit({
      rule: 'Prefer ripgrep for text search before broad file reads',
      scope: 'tool-preference',
      taskId: 'task_1',
      sessionRef: 'session_1',
    });
    await writeDocFinding(tmpDir, {
      id: 'doc_find_1',
      title: 'Roadmap memory notes',
      summary: 'Memory RAG retrieves strategy, preferences, and doc findings',
      source: 'docs/roadmap.md',
      recall: {
        trigger: {
          keywords: ['roadmap', 'memory'],
          scopes: ['architecture'],
        },
        applicableWhen: ['Planning memory retrieval'],
        doNotApplyWhen: ['Searching for code locations'],
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const store = new JsonlMemoryStore({ memoryDir: tmpDir });
    const results = await store.search({
      text: 'retry edit with ripgrep roadmap memory',
      trigger: {
        signalKinds: ['tool_error'],
        paths: ['src/App.tsx'],
      },
      metadata: {
        kinds: ['knack', 'preference', 'doc_finding'],
      },
    });

    expect(results[0].item.kind).toBe('knack');
    expect(results.map((result) => result.item.kind).sort()).toEqual([
      'doc_finding',
      'knack',
      'preference',
    ]);
    expect(results[0].score.trigger).toBeGreaterThan(0);
    expect(results[0].score.trigger).toBe(results[0].score.dimensions.trigger);
    expect(results[0].score.keyword).toBe(results[0].score.dimensions.keyword);
    expect(results[0].score.metadata).toBe(results[0].score.dimensions.metadata);
    expect(results[0].score.vector).toBe(0);
    expect(results[0].score.dimensions.trigger).toBeGreaterThanOrEqual(0);
    expect(results[0].score.dimensions.trigger).toBeLessThanOrEqual(1);
    expect(results[0].score.total).toBeGreaterThanOrEqual(0);
    expect(results[0].score.total).toBeLessThanOrEqual(1);
    expect(results.find((result) => result.item.kind === 'preference')?.item.recall.trigger.scopes)
      .toEqual(['tool-preference']);
    expect(results.every((result) => result.score.total > 0)).toBe(true);

    const index = JSON.parse(await readFile(join(tmpDir, 'recall-index.json'), 'utf-8')) as {
      entries: Array<{ kind: string; recall: unknown }>;
    };
    expect(index.entries.map((entry) => entry.kind)).toEqual([
      'knack',
      'preference',
      'doc_finding',
    ]);
    expect(index.entries.every((entry) => entry.recall)).toBe(true);
  });

  it('applies metadata filters before trigger and keyword scoring', async () => {
    await writeKnack(tmpDir, {
      id: 'knack_2',
      lessonCandidateId: 'lesson_2',
      status: 'candidate',
      summary: 'Hashline stale rejection retry policy',
      trigger: {
        signalKinds: ['hashline_rejection'],
        paths: ['src/App.tsx'],
      },
      recall: {
        trigger: {
          signalKinds: ['hashline_rejection'],
          paths: ['src/App.tsx'],
        },
        applicableWhen: ['Retrying stale edits'],
        doNotApplyWhen: ['No stale rejection occurred'],
      },
      evidenceRefs: ['hash_1'],
      counterexamples: [],
      allowPromptInjection: true,
      writesHardToolRule: false,
      breakerReport: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await PreferencesManager.getInstance(tmpDir).addExplicit({
      rule: 'Use concise Chinese final answers',
      scope: 'communication',
      taskId: 'task_1',
      sessionRef: 'session_1',
    });

    const store = new JsonlMemoryStore({ memoryDir: tmpDir });
    const results = await store.search({
      text: 'retry stale edit',
      metadata: {
        kinds: ['preference'],
        scopes: ['communication'],
      },
      trigger: {
        signalKinds: ['hashline_rejection'],
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0].item.kind).toBe('preference');
    expect(results[0].item.metadata.scope).toBe('communication');
    expect(results[0].score.metadata).toBeGreaterThan(0);
    expect(results[0].score.trigger).toBe(0);
  });

  it('loads working memory snapshots from run outcomes and supports run/task exclusion', async () => {
    await writeOutcome(tmpDir, 'run_old', {
      taskId: 'task_old',
      runId: 'run_old',
      goal: 'Fix stale edit retry behavior',
      phase: 'executing',
      finalStep: 'Patch recall router with historical snapshots',
      completedTodos: [
        { id: 'todo_1', label: 'Added snapshot recall tests' },
      ],
      completedTodoCount: 1,
      readFiles: ['src/memory/recall/recall-router.ts'],
      writtenFiles: ['src/memory/recall/jsonl-memory-store.ts'],
      keyFiles: [
        { path: 'src/memory/recall/recall-router.ts', role: 'read' },
        { path: 'src/memory/recall/jsonl-memory-store.ts', role: 'written' },
      ],
      keySignalSummaries: ['Recovered after hashline stale rejection'],
      errorPatterns: ['hashline_stale'],
      evidenceRefs: ['runs/run_old/events.jsonl', 'runs/run_old/outcome.json'],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await writeOutcome(tmpDir, 'run_current', {
      taskId: 'task_current',
      runId: 'run_current',
      goal: 'Current task should be excluded',
      phase: 'executing',
      finalStep: 'Current step',
      completedTodos: [],
      completedTodoCount: 0,
      readFiles: [],
      writtenFiles: [],
      keyFiles: [],
      keySignalSummaries: [],
      errorPatterns: [],
      evidenceRefs: ['runs/run_current/events.jsonl', 'runs/run_current/outcome.json'],
      createdAt: '2026-01-02T00:00:00.000Z',
    });

    const store = new JsonlMemoryStore({ memoryDir: tmpDir });
    const snapshots = await store.loadTaskSnapshots({
      excludeRunIds: ['run_current'],
      excludeTaskIds: ['task_current'],
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      id: 'wm_snapshot:run_old',
      kind: 'run_archive_ref',
      subtype: 'working_memory_snapshot',
      metadata: {
        taskId: 'task_old',
        runId: 'run_old',
        errorPatterns: ['hashline_stale'],
      },
    });
    expect(snapshots[0].summary).toContain('[Fix stale edit retry behavior] executing');
    expect(snapshots[0].recall.trigger.keywords).toEqual(expect.arrayContaining([
      'fix',
      'stale',
      'patch',
      'added',
      'snapshot',
      'recovered',
      'hashline_stale',
    ]));
    expect(snapshots[0].recall.trigger.paths).toEqual(expect.arrayContaining([
      'src/memory/recall/recall-router.ts',
      'src/memory/recall/jsonl-memory-store.ts',
    ]));
    expect(snapshots[0].recall.sourceRefs).toEqual([
      'runs/run_old/events.jsonl',
      'runs/run_old/outcome.json',
    ]);
  });

  it('orders search results by normalized total score instead of legacy fields', async () => {
    await writeKnack(tmpDir, {
      id: 'knack_trigger',
      lessonCandidateId: 'lesson_trigger',
      status: 'candidate',
      summary: 'trigger-only recall',
      trigger: {
        signalKinds: ['tool_error'],
        paths: [],
      },
      recall: {
        trigger: {
          signalKinds: ['tool_error'],
        },
        applicableWhen: ['unrelated context'],
        doNotApplyWhen: [],
      },
      evidenceRefs: [],
      counterexamples: [],
      allowPromptInjection: true,
      writesHardToolRule: false,
      breakerReport: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
    await writeKnack(tmpDir, {
      id: 'knack_evidence',
      lessonCandidateId: 'lesson_evidence',
      status: 'candidate',
      summary: 'retry stale edit with evidence',
      trigger: {
        signalKinds: [],
        paths: [],
      },
      recall: {
        trigger: {
          signalKinds: ['hashline_rejection'],
        },
        applicableWhen: ['retry stale edit after hashline rejection recovery'],
        doNotApplyWhen: [],
      },
      evidenceRefs: ['a', 'b', 'c', 'd', 'e'],
      counterexamples: [],
      allowPromptInjection: true,
      writesHardToolRule: false,
      breakerReport: null,
      createdAt: '2026-01-15T00:00:00.000Z',
      updatedAt: '2026-01-15T00:00:00.000Z',
    });

    const store = new JsonlMemoryStore({ memoryDir: tmpDir });
    const results = await store.search({
      text: 'retry stale edit',
      trigger: { signalKinds: ['tool_error'] },
      metadata: { kinds: ['knack'] },
    }, {
      tier: 'heavy',
      goal: 'retry stale edit',
      currentStep: 'hashline rejection recovery',
      now: new Date('2026-01-15T00:00:00.000Z'),
    });

    expect(results.map((result) => result.item.id)).toEqual(['knack_evidence', 'knack_trigger']);
    expect(results[0].score.total).toBeGreaterThan(results[1].score.total);
    expect(results[0].score.trigger).toBeLessThan(results[1].score.trigger);
  });

  it('returns a bounded candidate pool larger than the historical top eight', async () => {
    for (let index = 0; index < 12; index += 1) {
      await writeKnack(tmpDir, {
        id: `knack_${index}`,
        lessonCandidateId: `lesson_${index}`,
        status: 'candidate',
        summary: `candidate ${index} shared recall text`,
        trigger: { signalKinds: [], paths: [] },
        recall: {
          trigger: { keywords: ['shared', 'recall'] },
          applicableWhen: ['shared recall text'],
          doNotApplyWhen: [],
        },
        evidenceRefs: [],
        counterexamples: [],
        allowPromptInjection: true,
        writesHardToolRule: false,
        breakerReport: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    }

    const results = await new JsonlMemoryStore({ memoryDir: tmpDir }).search({
      text: 'shared recall text',
      metadata: { kinds: ['knack'] },
    });

    expect(results).toHaveLength(12);
  });

  it('injects cause/fix/docs in lesson summary and still scores planted symptoms', async () => {
    const planted = 'AssertionError: planted raw traceback boom';
    await writeFile(join(tmpDir, 'lessons.jsonl'), `${JSON.stringify({
      id: 'lesson_model',
      sourceSignalId: 'sig_1',
      lesson: `Treat tool error as a retry pattern: ${planted}`,
      cause: 'CompoundModel copies ones into the right block',
      fixPattern: 'Assign the child matrix into cright',
      contrast: 'ones drop structure; copy keeps it',
      symptomKeys: ['PLANTED_SYMPTOM_KEY', 'AssertionError'],
      symptom: planted,
      docRefs: [{ library: 'astropy', topic: 'modeling.separable' }],
      doNotApplyWhen: ['Right block is a shared view'],
      trigger: { signalKinds: ['tool_error'], paths: [] },
      applicableWhen: [],
      evidenceRefs: ['sig_1'],
      severity: 'medium',
      quality: 'high',
      status: 'observed',
      provenance: { taskId: 't', sessionRef: 's', signalId: 'sig_1' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })}\n`, 'utf-8');

    const results = await new JsonlMemoryStore({
      memoryDir: tmpDir,
      kinds: ['lesson'],
    }).search({
      text: 'AssertionError PLANTED_SYMPTOM_KEY',
      metadata: { kinds: ['lesson'] },
    });

    expect(results).toHaveLength(1);
    expect(results[0].item.summary).toContain('Cause: CompoundModel copies ones into the right block');
    expect(results[0].item.summary).toContain('Fix: Assign the child matrix into cright');
    expect(results[0].item.summary).toContain('Docs: astropy#modeling.separable');
    expect(results[0].item.summary).not.toContain(planted);
    expect(results[0].item.summary).not.toContain('Treat tool error');
    expect(results[0].item.summary).not.toContain('PLANTED_SYMPTOM_KEY');
    expect(results[0].item.metadata.symptom).toBe(planted);
    expect(results[0].score.keyword).toBeGreaterThan(0);
  });

  it('records knack injection once per task and run', async () => {
    await writeKnack(tmpDir, {
      id: 'knack_injected',
      lessonCandidateId: 'lesson_injected',
      status: 'validated',
      summary: 'Inject this knack',
      trigger: { signalKinds: [], paths: [] },
      recall: { trigger: {}, applicableWhen: [], doNotApplyWhen: [] },
      evidenceRefs: [],
      counterexamples: [],
      allowPromptInjection: true,
      writesHardToolRule: false,
      breakerReport: null,
      injectedCount: 2,
      lastInjectedTask: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const store = new JsonlMemoryStore({ memoryDir: tmpDir });

    await store.recordKnackInjections({ knackIds: ['knack_injected'], taskId: 'task_1', runId: 'run_1' });
    await store.recordKnackInjections({ knackIds: ['knack_injected'], taskId: 'task_1', runId: 'run_1' });

    const [knack] = (await readFile(join(tmpDir, 'knacks.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(knack).toMatchObject({ injectedCount: 3, lastInjectedTask: 'task_1' });
  });
});

async function writeKnack(memoryDir: string, knack: Knack): Promise<void> {
  await appendFile(join(memoryDir, 'knacks.jsonl'), JSON.stringify(knack) + '\n', 'utf-8');
}

async function writeDocFinding(memoryDir: string, finding: DocFinding): Promise<void> {
  await appendFile(join(memoryDir, 'doc-findings.jsonl'), JSON.stringify(finding) + '\n', 'utf-8');
}

async function writeOutcome(
  memoryDir: string,
  runId: string,
  wmSnapshot: Record<string, unknown>,
): Promise<void> {
  const runDir = join(memoryDir, 'runs', runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'outcome.json'), JSON.stringify({
    taskId: wmSnapshot.taskId,
    runId,
    status: 'success',
    userCorrectionCount: 0,
    toolErrorCount: 0,
    hashlineRejectionCount: 0,
    hashlineRecoveryCount: 0,
    repeatedToolCallCount: 0,
    lostnessTriggerCount: 0,
    finalSummary: 'done',
    evidenceRefs: [],
    wmSnapshot,
    createdAt: '2026-01-01T00:00:00.000Z',
  }, null, 2), 'utf-8');
}
