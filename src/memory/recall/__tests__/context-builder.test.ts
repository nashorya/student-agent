import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TaskWorkingMemory } from '../../tasks/types.js';
import type { TaskLedgerInput } from '../../tasks/task-ledger.js';
import {
  ANTHROPIC_EXECUTION_OVERRIDE,
  ContextBuilder,
  EVAL_AUTONOMY_RULE,
  FULL_PI_SCHEMA,
  isStaticContextSection,
  partitionContextSections,
  PI_CONTRACT_SUMMARY,
} from '../context-builder.js';
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
      'piContractSummary',
      'taskSpec',
      'workingMemory',
      'recentErrors',
      'recentSignals',
      'knacks',
      'preferences',
      'docFindings',
    ]);
    expect(context.tier).toBe('standard');
    expect(context.sections[0].content).toBe(PI_CONTRACT_SUMMARY);
    expect(context.sections[1].content).toContain('Goal: Implement ContextBuilder');
    expect(context.sections[2].content).toContain('[pending] Add tests');
    expect(context.sections[2].content).not.toContain('Completed todo');
    expect(context.sections[3].content).toContain('Error(tool/edit_failed)');
    expect(context.sections[4].content).toContain('Signal(tool_error/medium)');
    expect(context.sections[5].content).toContain('Fresh read before retrying edits');
    expect(context.truncated).toEqual([]);
  });

  it('defaults to summary pi contract and does not render full pi schema', () => {
    const context = new ContextBuilder().build({
      workingMemory: workingMemory(),
      recallBundle: recallBundle(),
      tier: 'standard',
    });

    expect(context.sections.find((section) => section.name === 'piContractSummary')?.content)
      .toBe(PI_CONTRACT_SUMMARY);
    expect(context.sections.some((section) => section.name === 'piSchemaFull')).toBe(false);
    expect(context.sections.map((section) => section.content).join('\n')).not.toContain(FULL_PI_SCHEMA);
  });

  it('renders eval autonomy rule in eval mode while keeping pi schema summary-only', () => {
    const context = new ContextBuilder().build({
      workingMemory: workingMemory(),
      recallBundle: recallBundle(),
      tier: 'standard',
      runMode: 'eval',
    });

    expect(context.sections.map((section) => section.name).slice(0, 3)).toEqual([
      'evalAutonomyRule',
      'anthropicExecutionOverride',
      'piContractSummary',
    ]);
    expect(context.sections.find((section) => section.name === 'evalAutonomyRule')?.content)
      .toBe(EVAL_AUTONOMY_RULE);
    expect(EVAL_AUTONOMY_RULE).toContain(
      'If validation fails for reasons unrelated to your change',
    );
    expect(EVAL_AUTONOMY_RULE).toContain(
      'Do not retry the same failing validation approach more than twice.',
    );
    expect(EVAL_AUTONOMY_RULE).toContain(
      're-read the HARD CONSTRAINTS section',
    );
    expect(context.sections.find((section) => section.name === 'anthropicExecutionOverride')?.content)
      .toBe(ANTHROPIC_EXECUTION_OVERRIDE);
    expect(context.sections.some((section) => section.name === 'piSchemaFull')).toBe(false);
  });

  it('renders stable knack ids and citation instructions only in eval mode', () => {
    const bundle = recallBundle({
      knacks: [recalled('knack_6938', 'knack', 'Assign the replace result back')],
    });
    const evalContext = new ContextBuilder().build({
      workingMemory: workingMemory(),
      recallBundle: bundle,
      runMode: 'eval',
    });
    const interactiveContext = new ContextBuilder().build({
      workingMemory: workingMemory(),
      recallBundle: bundle,
      runMode: 'interactive',
    });

    expect(evalContext.sections.find((section) => section.name === 'knacks')?.content)
      .toContain('[recall:knack_6938] Assign the replace result back');
    expect(evalContext.sections.find((section) => section.name === 'knacks')?.content)
      .toContain('[[used_recall:<id>]]');
    expect(interactiveContext.sections.find((section) => section.name === 'knacks')?.content)
      .toBe('- Assign the replace result back');
  });

  it('renders full pi schema only when explicitly requested', () => {
    const context = new ContextBuilder().build({
      workingMemory: workingMemory(),
      recallBundle: recallBundle(),
      tier: 'standard',
      piSchemaRenderMode: 'full',
    });

    expect(context.sections.find((section) => section.name === 'piContractSummary')?.content)
      .toBe(PI_CONTRACT_SUMMARY);
    expect(context.sections.find((section) => section.name === 'piSchemaFull')?.content)
      .toBe(FULL_PI_SCHEMA);
  });

  it('supports disabling pi schema rendering entirely', () => {
    const context = new ContextBuilder().build({
      workingMemory: workingMemory(),
      recallBundle: recallBundle(),
      tier: 'standard',
      piSchemaRenderMode: 'none',
    });

    expect(context.sections.some((section) => section.name === 'piContractSummary')).toBe(false);
    expect(context.sections.some((section) => section.name === 'piSchemaFull')).toBe(false);
  });

  it('renders task ledger section between taskSpec and workingMemory', () => {
    const context = new ContextBuilder().build({
      workingMemory: workingMemory(),
      recallBundle: recallBundle(),
      taskLedger: ledgerInput(),
      tier: 'standard',
    });

    const names = context.sections.map((section) => section.name);
    expect(names.slice(0, 4)).toEqual(['piContractSummary', 'taskSpec', 'taskLedger', 'workingMemory']);
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

  it('renders hard constraints as a pinned L1 section after taskSpec', () => {
    const context = new ContextBuilder().build({
      workingMemory: workingMemory({
        hardConstraints: [
          'Only edit input.tex.',
          'Every replacement must come from the same synonyms.txt family.',
        ].join('\n'),
      }),
      recallBundle: recallBundle(),
      tier: 'standard',
    });

    const names = context.sections.map((section) => section.name);
    expect(names.slice(0, 4)).toEqual([
      'piContractSummary',
      'taskSpec',
      'hardConstraints',
      'workingMemory',
    ]);
    const hardConstraints = context.sections.find((section) => section.name === 'hardConstraints');
    expect(hardConstraints?.content).toContain('HARD CONSTRAINTS');
    expect(hardConstraints?.content).toContain('Only edit input.tex.');
    expect(hardConstraints?.content).toContain('same synonyms.txt family');
  });

  it('marks truncated hard constraints explicitly outside eval mode', () => {
    const context = new ContextBuilder().build({
      workingMemory: workingMemory({
        hardConstraints: `Keep this visible. ${'constraint detail '.repeat(1000)}`,
        todos: [],
        recentErrors: [],
        recentSignals: [],
      }),
      recallBundle: recallBundle(),
      tier: 'minimal',
      piSchemaRenderMode: 'none',
    });

    const hardConstraints = context.sections.find((section) => section.name === 'hardConstraints');
    expect(hardConstraints?.content).toContain('Keep this visible.');
    expect(hardConstraints?.content).toContain('[TRUNCATED at 300 tokens]');
    expect(context.truncated).toContain('hardConstraints');
    expect(hardConstraints?.estimatedTokens).toBeLessThanOrEqual(300);
  });

  it('renders over-budget task spec and hard constraints completely in eval mode', () => {
    const instruction = readFileSync(resolve(
      'evals/tasks/jspace-compaction-probe-01/instruction.md',
    ), 'utf8');
    const finalConstraint = instruction.trimEnd().split('\n').at(-1)!;
    const finalGoal = 'TASK SPEC TAIL MUST SURVIVE';
    expect(instruction.length).toBeGreaterThan(2800);
    const context = new ContextBuilder().build({
      workingMemory: workingMemory({
        goal: `${'long goal '.repeat(400)}${finalGoal}`,
        hardConstraints: instruction,
        todos: [],
        recentErrors: [],
        recentSignals: [],
      }),
      recallBundle: recallBundle(),
      tier: 'standard',
      runMode: 'eval',
      piSchemaRenderMode: 'none',
    });

    expect(context.sections.find((section) => section.name === 'taskSpec')?.content)
      .toContain(finalGoal);
    expect(context.sections.find((section) => section.name === 'hardConstraints')?.content)
      .toContain(finalConstraint);
    expect(context.truncated).not.toContain('taskSpec');
    expect(context.truncated).not.toContain('hardConstraints');
  });

  it('preserves protected eval sections even when the legacy total budget is exhausted', () => {
    const finalConstraint = 'LEGACY CONSTRAINT TAIL MUST SURVIVE';
    const finalGoal = 'LEGACY TASK SPEC TAIL MUST SURVIVE';
    const context = new ContextBuilder().build({
      workingMemory: workingMemory({
        goal: `${'long goal '.repeat(100)}${finalGoal}`,
        hardConstraints: `${'constraint detail '.repeat(100)}${finalConstraint}`,
      }),
      recallBundle: recallBundle(),
      maxTokenBudget: 1,
      runMode: 'eval',
      piSchemaRenderMode: 'none',
    });

    expect(context.sections.find((section) => section.name === 'taskSpec')?.content)
      .toContain(finalGoal);
    expect(context.sections.find((section) => section.name === 'hardConstraints')?.content)
      .toContain(finalConstraint);
    expect(context.truncated).not.toContain('taskSpec');
    expect(context.truncated).not.toContain('hardConstraints');
  });

  it('omits rather than silently slicing a non-eval section when no marker can fit', () => {
    const context = new ContextBuilder().build({
      workingMemory: workingMemory({ hardConstraints: 'constraint'.repeat(100) }),
      recallBundle: recallBundle(),
      maxTokenBudget: 1,
      piSchemaRenderMode: 'none',
    });

    expect(context.sections).toEqual([]);
    expect(context.truncated).toEqual(expect.arrayContaining(['taskSpec', 'hardConstraints']));
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
      'piContractSummary',
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
      'piContractSummary',
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
      workingMemory: workingMemory({
        hardConstraints: 'Legacy hard constraint',
      }),
      recallBundle: recallBundle({
        knacks: [recalled('knack_1', 'knack', 'k'.repeat(300))],
        preferences: [recalled('pref_1', 'preference', 'p'.repeat(300))],
      }),
      maxTokenBudget: 60,
      piSchemaRenderMode: 'none',
    });

    expect(context.sections.map((section) => section.name)).toEqual([
      'taskSpec',
      'hardConstraints',
      'workingMemory',
      'recentErrors',
    ]);
    expect(context.totalEstimatedTokens).toBeLessThanOrEqual(60);
    expect(context.truncated).toContain('recentSignals');
    expect(context.truncated).toContain('knacks');
  });

  it('partitions static prefix before dynamic without dropping sections (C-2)', () => {
    const context = new ContextBuilder().build({
      workingMemory: workingMemory({
        hardConstraints: 'Only edit target.ts',
      }),
      recallBundle: recallBundle({
        knacks: [recalled('knack_1', 'knack', 'Fresh read before edit')],
      }),
      runMode: 'eval',
    });
    const names = context.sections.map((section) => section.name);
    const { staticSections, dynamicSections } = partitionContextSections(context.sections);
    // a) no section lost — partition is a split, not a filter drop
    expect([...staticSections, ...dynamicSections].map((s) => s.name).sort())
      .toEqual([...names].sort());
    expect(staticSections.every((s) => isStaticContextSection(s.name))).toBe(true);
    expect(dynamicSections.every((s) => !isStaticContextSection(s.name))).toBe(true);
    // b) eval protected sections still present with own budgets
    expect(names).toContain('taskSpec');
    expect(names).toContain('hardConstraints');
    expect(names).toContain('evalAutonomyRule');
    // static group precedes dynamic group in priority order
    const lastStatic = Math.max(
      ...staticSections.map((s) => names.indexOf(s.name)),
    );
    const firstDynamic = Math.min(
      ...dynamicSections.map((s) => names.indexOf(s.name)),
    );
    expect(lastStatic).toBeLessThan(firstDynamic);
  });

  it('renders static section content byte-stable across two builds (C-2)', () => {
    const input = {
      workingMemory: workingMemory({ hardConstraints: 'Keep constraints pinned.' }),
      recallBundle: recallBundle({
        knacks: [recalled('knack_1', 'knack', 'dynamic knack text')],
      }),
      runMode: 'eval' as const,
      tier: 'standard' as const,
    };
    const a = new ContextBuilder().build(input);
    const b = new ContextBuilder().build(input);
    const staticA = partitionContextSections(a.sections).staticSections
      .map((s) => s.content).join('\0');
    const staticB = partitionContextSections(b.sections).staticSections
      .map((s) => s.content).join('\0');
    expect(staticA).toBe(staticB);
    expect(staticA.length).toBeGreaterThan(0);
  });
});

function workingMemory(overrides: Partial<TaskWorkingMemory> = {}): TaskWorkingMemory {
  return {
    taskId: 'task_1',
    runId: 'run_1',
    goal: 'Implement ContextBuilder',
    hardConstraints: '',
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
