import { describe, expect, it } from 'vitest';
import { ContextBuilder } from '../../memory/recall/context-builder.js';
import { workingMemory } from './fixtures/working-memory.js';
import { taskLedger } from './fixtures/task-ledger.js';
import { recalled, recallBundle } from './fixtures/recall-items.js';

describe('Context Runtime Eval: context rebuild invariant', () => {
  it('rebuilds L1 from current inputs without inheriting prior prompt content', () => {
    const builder = new ContextBuilder();
    const first = builder.build({
      workingMemory: workingMemory({
        goal: 'Goal A',
        currentStep: 'Step A',
        todos: [{ id: 'todo_a', content: 'Todo A', status: 'pending', updatedAt: '2026-01-01T00:00:00.000Z' }],
        recentErrors: [],
        recentSignals: [],
      }),
      taskLedger: taskLedger({
        confirmedFacts: [{ id: 'fact_a', content: 'Fact A', source: 'user', confidence: 'confirmed', addedAt: '2026-01-01T00:00:00.000Z' }],
        rejectedAssumptions: [],
        openQuestions: [],
      }),
      recallBundle: recallBundle({
        knacks: [recalled('knack_a', 'knack', 'Recall A')],
      }),
      tier: 'standard',
    });
    const second = builder.build({
      workingMemory: workingMemory({
        goal: 'Goal B',
        currentStep: 'Step B',
        todos: [{ id: 'todo_b', content: 'Todo B', status: 'pending', updatedAt: '2026-01-01T00:00:00.000Z' }],
        recentErrors: [],
        recentSignals: [],
      }),
      taskLedger: taskLedger({
        confirmedFacts: [{ id: 'fact_b', content: 'Fact B', source: 'user', confidence: 'confirmed', addedAt: '2026-01-01T00:00:00.000Z' }],
        rejectedAssumptions: [],
        openQuestions: [],
      }),
      recallBundle: recallBundle({
        knacks: [recalled('knack_b', 'knack', 'Recall B')],
      }),
      tier: 'standard',
    });

    const firstPrompt = first.sections.map((section) => section.content).join('\n');
    const secondPrompt = second.sections.map((section) => section.content).join('\n');
    expect(firstPrompt).toContain('Goal A');
    expect(secondPrompt).toContain('Goal B');
    expect(secondPrompt).toContain('Todo B');
    expect(secondPrompt).toContain('Fact B');
    expect(secondPrompt).toContain('Recall B');
    expect(secondPrompt).not.toContain('Goal A');
    expect(secondPrompt).not.toContain('Todo A');
    expect(secondPrompt).not.toContain('Fact A');
    expect(secondPrompt).not.toContain('Recall A');
  });
});
