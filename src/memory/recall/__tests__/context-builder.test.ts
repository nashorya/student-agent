import { describe, expect, it } from 'vitest';
import type { TaskWorkingMemory } from '../../tasks/types.js';
import type { TaskLedgerInput } from '../../tasks/task-ledger.js';
import { ContextBuilder } from '../context-builder.js';
import type { RecallBundle, RecallScore, RecalledItem } from '../types.js';

describe('ContextBuilder', () => {
  it('builds sections in priority order from pinned and recalled context', () => {
    const context = new ContextBuilder().build({
      workingMemory: workingMemory(),
      recallBundle: recallBundle({
        knacks: [recalled('knack_1', 'knack', 'Fresh read before retrying edits')],
        preferences: [recalled('pref_1', 'preference', 'Prefer concise Chinese responses')],
        docFindings: [recalled('doc_1', 'doc_finding', 'Hashline rejects stale anchors')],
      }),
      taskLedger: {
        confirmedFacts: [],
        rejectedAssumptions: [],
        openQuestions: [],
      },
    });

    expect(context.sections.map((section) => section.name)).toEqual([
      'taskSpec',
      'workingMemory',
      'recentErrors',
      'recentSignals',
      'knacks',
      'preferences',
      'docFindings',
    ]);
    expect(context.tier).toBe('standard');
    expect(context.sections[0].content).toContain('Goal: Implement ContextBuilder');
    expect(context.sections[1].content).toContain('[pending] Add tests');
    expect(context.sections[1].content).not.toContain('Completed todo');
    expect(context.sections[2].content).toContain('Error(tool/edit_failed)');
    expect(context.sections[3].content).toContain('Signal(tool_error/medium)');
    expect(context.sections[4].content).toContain('Fresh read before retrying edits');
    expect(context.truncated).toEqual([]);
  });

  it('renders task ledger section between taskSpec and workingMemory', () => {
    const context = new ContextBuilder().build({
      workingMemory: workingMemory(),
      recallBundle: recallBundle(),
      taskLedger: ledgerInput(),
      tier: 'standard',
    });

    const names = context.sections.map((section) => section.name);
    expect(names.slice(0, 3)).toEqual(['taskSpec', 'taskLedger', 'workingMemory']);
    const ledger = context.sections.find((section) => section.name === 'taskLedger');
    expect(ledger?.content).toContain('## Task Ledger');
    expect(ledger?.content).toContain('### Confirmed Facts');
    expect(ledger?.content).toContain('- [confirmed] Use knacks naming (source: user)');
    expect(ledger?.content).toContain('### Rejected Assumptions — DO NOT revisit these assumptions');
    expect(ledger?.content).toContain('[HARD] Rename knacks back to strategy genes -- reason: User requested knacks');
    expect(ledger?.content).toContain('[soft] Assume generated docs are authoritative -- reason: Needs verification');
    expect(ledger?.content).toContain('### Open Questions');
    expect(ledger?.content).toContain('- Should we add UI tests? (context: Frontend behavior changed)');
    expect(ledger?.content).not.toContain('removed rejection');
    expect(ledger?.content).not.toContain('resolved question');
  });

  it('does not render task ledger section when it is empty', () => {
    const context = new ContextBuilder().build({
      workingMemory: workingMemory(),
      recallBundle: recallBundle(),
      taskLedger: {
        confirmedFacts: [],
        rejectedAssumptions: [],
        openQuestions: [],
      },
      tier: 'standard',
    });

    expect(context.sections.some((section) => section.name === 'taskLedger')).toBe(false);
  });

  it('omits retrieved context sections in minimal tier while keeping pinned context', () => {
    const context = new ContextBuilder().build({
      workingMemory: workingMemory(),
      recallBundle: recallBundle({
        knacks: [recalled('knack_1', 'knack', 'k'.repeat(300))],
        preferences: [recalled('pref_1', 'preference', 'Prefer concise Chinese responses')],
        docFindings: [recalled('doc_1', 'doc_finding', 'd'.repeat(300))],
      }),
      tier: 'minimal',
    });

    expect(context.sections.map((section) => section.name)).toEqual([
      'taskSpec',
      'workingMemory',
      'recentErrors',
      'recentSignals',
      'preferences',
    ]);
    expect(context.sections.some((section) => section.name === 'knacks')).toBe(false);
    expect(context.sections.some((section) => section.name === 'docFindings')).toBe(false);
    expect(context.sections.find((section) => section.name === 'taskSpec')?.content)
      .toContain('Implement ContextBuilder');
  });

  it('uses larger section budgets in heavy tier', () => {
    const heavyText = 'heavy-context '.repeat(1400);
    const standard = new ContextBuilder().build({
      workingMemory: workingMemory({
        todos: [],
        recentErrors: [],
        recentSignals: [],
      }),
      recallBundle: recallBundle({
        knacks: [recalled('knack_1', 'knack', heavyText)],
      }),
      tier: 'standard',
    });
    const heavy = new ContextBuilder().build({
      workingMemory: workingMemory({
        todos: [],
        recentErrors: [],
        recentSignals: [],
      }),
      recallBundle: recallBundle({
        knacks: [recalled('knack_1', 'knack', heavyText)],
      }),
      tier: 'heavy',
    });

    const standardKnacks = standard.sections.find((section) => section.name === 'knacks');
    const heavyKnacks = heavy.sections.find((section) => section.name === 'knacks');
    expect(standardKnacks?.estimatedTokens).toBeLessThan(heavyKnacks?.estimatedTokens ?? 0);
    expect(standard.truncated).toContain('knacks');
    expect(heavy.truncated).toContain('knacks');
  });

  it('truncates each section independently without stealing budget from later sections', () => {
    const context = new ContextBuilder().build({
      workingMemory: workingMemory({
        todos: [],
        recentErrors: [],
        recentSignals: [],
      }),
      recallBundle: recallBundle({
        knacks: [recalled('knack_1', 'knack', 'k'.repeat(10000))],
        preferences: [recalled('pref_1', 'preference', 'short preference')],
        docFindings: [recalled('doc_1', 'doc_finding', 'short doc finding')],
      }),
      tier: 'standard',
    });

    expect(context.truncated).toContain('knacks');
    expect(context.sections.find((section) => section.name === 'preferences')?.content)
      .toContain('short preference');
    expect(context.sections.find((section) => section.name === 'docFindings')?.content)
      .toContain('short doc finding');
  });

  it('renders historical task snapshots as recentTasks between recent context and knacks', () => {
    const context = new ContextBuilder().build({
      workingMemory: workingMemory(),
      recallBundle: recallBundle({
        historicalTaskSnapshots: [
          recalled(
            'wm_snapshot:run_old',
            'run_archive_ref',
            '[30min ago] 修复 eval 测试 — completed 4 todos, key files: intent-classifier.ts, recall-router.ts',
            'working_memory_snapshot',
          ),
        ],
        knacks: [recalled('knack_1', 'knack', 'Fresh read before retrying edits')],
      }),
      tier: 'standard',
    });

    const names = context.sections.map((section) => section.name);
    expect(names).toEqual([
      'taskSpec',
      'workingMemory',
      'recentErrors',
      'recentSignals',
      'recentTasks',
      'knacks',
    ]);
    expect(names.indexOf('recentTasks')).toBeGreaterThan(names.indexOf('recentSignals'));
    expect(names.indexOf('recentTasks')).toBeLessThan(names.indexOf('knacks'));
    expect(context.sections.find((section) => section.name === 'recentTasks')?.content)
      .toContain('修复 eval 测试');
  });

  it('preserves legacy maxTokenBudget behavior when tier is not provided', () => {
    const context = new ContextBuilder().build({
      workingMemory: workingMemory(),
      recallBundle: recallBundle({
        knacks: [recalled('knack_1', 'knack', 'k'.repeat(300))],
        preferences: [recalled('pref_1', 'preference', 'p'.repeat(300))],
      }),
      maxTokenBudget: 35,
    });

    expect(context.sections.map((section) => section.name)).toEqual([
      'taskSpec',
      'workingMemory',
      'recentErrors',
    ]);
    expect(context.totalEstimatedTokens).toBeLessThanOrEqual(35);
    expect(context.truncated).toContain('recentErrors');
    expect(context.truncated).toContain('recentSignals');
    expect(context.truncated).toContain('knacks');
  });
});

function workingMemory(overrides: Partial<TaskWorkingMemory> = {}): TaskWorkingMemory {
  return {
    taskId: 'task_1',
    runId: 'run_1',
    goal: 'Implement ContextBuilder',
    phase: 'executing',
    currentStep: 'Build L1 prompt sections',
    todos: [
      {
        id: 'todo_1',
        content: 'Add tests',
        status: 'pending',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'todo_2',
        content: 'Completed todo',
        status: 'done',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    readFiles: [],
    writeFiles: [],
    recentErrors: [
      {
        id: 'err_1',
        source: 'tool',
        pattern: 'edit_failed',
        summary: 'Patch failed',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    recentSignals: [
      {
        id: 'sig_1',
        kind: 'tool_error',
        summary: 'Need recovery context',
        severity: 'medium',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    artifactRefs: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function recallBundle(overrides: Partial<RecallBundle> = {}): RecallBundle {
  return {
    knacks: [],
    preferences: [],
    docFindings: [],
    historicalTaskSnapshots: [],
    artifactRefs: [],
    runArchiveRefs: [],
    diagnostics: {
      queryText: '',
      triggerUsed: {},
      totalCandidates: 0,
      dropped: [],
      penalties: [],
    },
    ...overrides,
  };
}

function ledgerInput(): TaskLedgerInput {
  return {
    confirmedFacts: [{
      id: 'fact_1',
      content: 'Use knacks naming',
      source: 'user',
      confidence: 'confirmed',
      addedAt: '2026-01-01T00:00:00.000Z',
    }],
    rejectedAssumptions: [
      {
        id: 'rej_1',
        assumption: 'Rename knacks back to strategy genes',
        reason: 'User requested knacks',
        source: 'explicit',
        severity: 'hard',
        addedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'rej_2',
        assumption: 'Assume generated docs are authoritative',
        reason: 'Needs verification',
        source: 'tool_error',
        severity: 'soft',
        addedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    openQuestions: [{
      id: 'q_1',
      question: 'Should we add UI tests?',
      context: 'Frontend behavior changed',
      status: 'open',
      addedAt: '2026-01-01T00:00:00.000Z',
    }],
  };
}

function recalled(
  id: string,
  kind: RecalledItem['kind'],
  summary: string,
  subtype?: string,
): RecalledItem {
  return {
    id,
    kind,
    subtype,
    summary,
    reason: 'test',
    score: score(),
  };
}

function score(): RecallScore {
  return {
    dimensions: {
      metadata: 0,
      trigger: 1,
      keyword: 0,
      recency: 0,
      relevance: 0,
      evidence: 0,
    },
    metadata: 0,
    trigger: 1,
    keyword: 0,
    vector: 0,
    total: 1,
  };
}
