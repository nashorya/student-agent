import { describe, expect, it, vi } from 'vitest';
import { RecallRouter } from '../recall-router.js';
import type {
  MemoryRecallResult,
  RecallQuery,
  RecallRouterInput,
  RecallScore,
  RecallableMemoryItem,
} from '../types.js';

describe('RecallRouter', () => {
  it('builds a recall query from turn context and groups search results', async () => {
    const search = vi.fn<[(RecallQuery)], Promise<MemoryRecallResult[]>>().mockResolvedValue([
      result(memoryItem('knack_1', 'knack', 'Retry Hashline edits after fresh reads'), {
        trigger: 2,
        keyword: 1,
      }),
      result(memoryItem('pref_1', 'preference', 'Prefer concise Chinese answers'), {
        metadata: 1,
      }),
      result(memoryItem('doc_1', 'doc_finding', 'Memory RAG should not find code locations'), {
        keyword: 2,
      }),
    ]);
    const router = new RecallRouter({ search });

    const bundle = await router.recall(input());

    expect(search).toHaveBeenCalledWith({
      text: [
        'Fix stale edit retry behavior',
        'Patch recall router',
        'user: please use Hashline for stale edits',
        'assistant: reading recall files',
      ].join('\n'),
      trigger: {
        signalKinds: ['tool_error', 'user_correction'],
        paths: ['src/App.tsx'],
        toolNames: ['hashline_edit'],
      },
    }, {
      tier: 'standard',
      goal: 'Fix stale edit retry behavior',
      currentStep: 'Patch recall router',
      now: expect.any(Date),
    });
    expect(bundle.knacks.map((item) => item.id)).toEqual(['knack_1']);
    expect(bundle.preferences.map((item) => item.id)).toEqual(['pref_1']);
    expect(bundle.docFindings.map((item) => item.id)).toEqual(['doc_1']);
    expect(bundle.knacks[0].reason).toBe('trigger_match+keyword_match');
    expect(bundle.diagnostics).toEqual({
      queryText: [
        'Fix stale edit retry behavior',
        'Patch recall router',
        'user: please use Hashline for stale edits',
        'assistant: reading recall files',
      ].join('\n'),
      triggerUsed: {
        signalKinds: ['tool_error', 'user_correction'],
        paths: ['src/App.tsx'],
        toolNames: ['hashline_edit'],
      },
      totalCandidates: 3,
      dropped: [],
      penalties: [],
    });
  });

  it('drops results when doNotApplyWhen matches the current goal or phase', async () => {
    const blocked = memoryItem('knack_blocked', 'knack', 'Do not use coding knacks for planning');
    blocked.recall.doNotApplyWhen = ['architecture planning'];
    const kept = memoryItem('knack_kept', 'knack', 'Use task-local memory for execution');
    const search = vi.fn<[(RecallQuery)], Promise<MemoryRecallResult[]>>().mockResolvedValue([
      result(blocked, { trigger: 2 }),
      result(kept, { trigger: 1 }),
    ]);
    const router = new RecallRouter({ search });

    const bundle = await router.recall(input({
      goal: 'Architecture planning for memory recall',
      phase: 'planning',
    }));

    expect(bundle.knacks.map((item) => item.id)).toEqual(['knack_kept']);
    expect(bundle.diagnostics.totalCandidates).toBe(2);
    expect(bundle.diagnostics.dropped).toEqual([
      {
        id: 'knack_blocked',
        reason: 'do_not_apply_when_matched:architecture planning',
      },
    ]);
  });

  it('groups working memory snapshots into historicalTaskSnapshots and runArchiveRefs', async () => {
    const snapshot = memoryItem(
      'wm_snapshot:run_old',
      'run_archive_ref',
      'Old task completed 4 todos, key files: recall-router.ts',
      'working_memory_snapshot',
    );
    const search = vi.fn<[(RecallQuery)], Promise<MemoryRecallResult[]>>().mockResolvedValue([]);
    const loadTaskSnapshots = vi.fn().mockResolvedValue([
      snapshot,
    ]);
    const router = new RecallRouter({ search, loadTaskSnapshots });

    const bundle = await router.recall(input({
      currentRunId: 'run_current',
      currentTaskId: 'task_current',
    }));

    expect(loadTaskSnapshots).toHaveBeenCalledWith({
      limit: 2,
      excludeRunIds: ['run_current'],
      excludeTaskIds: ['task_current'],
    });
    expect(bundle.historicalTaskSnapshots.map((item) => item.id)).toEqual(['wm_snapshot:run_old']);
    expect(bundle.historicalTaskSnapshots[0].subtype).toBe('working_memory_snapshot');
    expect(bundle.runArchiveRefs.map((item) => item.id)).toEqual(['wm_snapshot:run_old']);
  });

  it('does not inject historical task snapshots in minimal tier', async () => {
    const search = vi.fn<[(RecallQuery)], Promise<MemoryRecallResult[]>>().mockResolvedValue([]);
    const loadTaskSnapshots = vi.fn().mockResolvedValue([
      memoryItem('wm_snapshot:run_old', 'run_archive_ref', 'Old task', 'working_memory_snapshot'),
    ]);
    const router = new RecallRouter({ search, loadTaskSnapshots });

    const bundle = await router.recall(input({ tier: 'minimal' }));

    expect(loadTaskSnapshots).not.toHaveBeenCalled();
    expect(bundle.historicalTaskSnapshots).toEqual([]);
  });

  it('limits historical task snapshots by standard and heavy tiers', async () => {
    const search = vi.fn<[(RecallQuery)], Promise<MemoryRecallResult[]>>().mockResolvedValue([]);
    const snapshots = Array.from({ length: 5 }, (_, index) =>
      memoryItem(`wm_snapshot:run_${index}`, 'run_archive_ref', `Old task ${index}`, 'working_memory_snapshot'),
    );
    const loadTaskSnapshots = vi.fn().mockResolvedValue(snapshots);
    const router = new RecallRouter({ search, loadTaskSnapshots });

    const standard = await router.recall(input({ tier: 'standard' }));
    const heavy = await router.recall(input({ tier: 'heavy' }));

    expect(standard.historicalTaskSnapshots).toHaveLength(2);
    expect(heavy.historicalTaskSnapshots).toHaveLength(3);
  });

  it('penalizes hard rejected assumptions without dropping matching results', async () => {
    const search = vi.fn<[(RecallQuery)], Promise<MemoryRecallResult[]>>().mockResolvedValue([
      result(memoryItem('knack_blind_retry', 'knack', 'Blind retry stale edits after Hashline rejection'), {
        keyword: 1,
        total: 1,
      }),
    ]);
    const router = new RecallRouter({ search });

    const bundle = await router.recall(input({
      taskLedger: {
        confirmedFacts: [],
        rejectedAssumptions: [{
          id: 'rej_1',
          assumption: 'blind retry stale edits',
          reason: 'User asked for fresh reads before retrying',
          source: 'user_correction',
          severity: 'hard',
          addedAt: '2026-01-01T00:00:00.000Z',
        }],
        openQuestions: [],
      },
    }));

    expect(bundle.knacks.map((item) => item.id)).toEqual(['knack_blind_retry']);
    expect(bundle.knacks[0].score.total).toBe(0.3);
    expect(bundle.diagnostics.dropped).toEqual([]);
    expect(bundle.diagnostics.penalties).toEqual([{
      id: 'knack_blind_retry',
      reason: 'overlaps_rejected_assumption',
      rejectionId: 'rej_1',
      assumption: 'blind retry stale edits',
      severity: 'hard',
      multiplier: 0.3,
    }]);
  });

  it('penalizes soft rejected assumptions less than hard rejections', async () => {
    const search = vi.fn<[(RecallQuery)], Promise<MemoryRecallResult[]>>().mockResolvedValue([
      result(memoryItem('knack_tentative', 'knack', 'Assume generated docs are authoritative'), {
        keyword: 1,
        total: 1,
      }),
    ]);
    const router = new RecallRouter({ search });

    const bundle = await router.recall(input({
      taskLedger: {
        confirmedFacts: [],
        rejectedAssumptions: [{
          id: 'rej_soft',
          assumption: 'generated docs are authoritative',
          reason: 'Needs verification',
          source: 'tool_error',
          severity: 'soft',
          addedAt: '2026-01-01T00:00:00.000Z',
        }],
        openQuestions: [],
      },
    }));

    expect(bundle.knacks[0].score.total).toBe(0.6);
    expect(bundle.diagnostics.penalties).toMatchObject([{
      id: 'knack_tentative',
      severity: 'soft',
      multiplier: 0.6,
    }]);
  });
});

function input(overrides: Partial<RecallRouterInput> = {}): RecallRouterInput {
  return {
    taskId: 'task_1',
    phase: 'executing',
    goal: 'Fix stale edit retry behavior',
    currentStep: 'Patch recall router',
    nextTool: 'hashline_edit',
    currentFile: 'src/App.tsx',
    recentErrors: [{ source: 'hashline', pattern: 'stale_rejection' }],
    recentSignals: [
      { kind: 'tool_error', summary: 'Hashline stale rejection' },
      { kind: 'user_correction', summary: 'User asked to avoid blind retry' },
      { kind: 'tool_error', summary: 'Repeated tool error should dedupe trigger' },
    ],
    recentRawTurns: [
      { role: 'user', content: 'older turn should be omitted' },
      { role: 'user', content: 'please use Hashline for stale edits' },
      { role: 'assistant', content: 'reading recall files' },
    ],
    tier: 'standard',
    ...overrides,
  };
}

function memoryItem(
  id: string,
  kind: RecallableMemoryItem['kind'],
  summary: string,
  subtype?: string,
): RecallableMemoryItem {
  return {
    id,
    kind,
    subtype,
    summary,
    recall: {
      trigger: {},
      applicableWhen: ['Relevant to current coding agent task'],
      doNotApplyWhen: [],
    },
    metadata: {},
    payload: {},
  };
}

function result(
  item: RecallableMemoryItem,
  score: Partial<RecallScore> & { dimensions?: Partial<RecallScore['dimensions']> },
): MemoryRecallResult {
  const dimensions = {
    metadata: 0,
    trigger: 0,
    keyword: 0,
    recency: 0,
    relevance: 0,
    evidence: 0,
    ...score.dimensions,
  };
  return {
    item,
    score: {
      dimensions,
      metadata: 0,
      trigger: 0,
      keyword: 0,
      vector: 0,
      total: 1,
      ...score,
    },
  };
}
