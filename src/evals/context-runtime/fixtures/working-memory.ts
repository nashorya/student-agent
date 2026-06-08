import type { TaskWorkingMemory } from '../../../memory/tasks/types.js';

export const FIXED_NOW = '2026-01-01T00:00:00.000Z';

export function workingMemory(overrides: Partial<TaskWorkingMemory> = {}): TaskWorkingMemory {
  return {
    taskId: 'task_context_eval',
    runId: 'run_context_eval',
    goal: 'Audit Context Runtime',
    phase: 'executing',
    currentStep: 'Build deterministic eval context',
    todos: [
      {
        id: 'todo_done',
        content: 'Completed invariant setup',
        status: 'done',
        evidenceRefs: ['todo_ref'],
        updatedAt: FIXED_NOW,
      },
      {
        id: 'todo_pending',
        content: 'Verify context runtime invariants',
        status: 'pending',
        updatedAt: FIXED_NOW,
      },
    ],
    readFiles: [{
      path: 'src/evals/context-runtime/read.ts',
      ranges: [],
      lastReadAt: FIXED_NOW,
    }],
    writeFiles: [{
      path: 'src/evals/context-runtime/write.ts',
      tool: 'hashline_edit',
      summary: 'Edited context runtime eval',
      writtenAt: FIXED_NOW,
    }],
    recentErrors: [],
    recentSignals: [],
    artifactRefs: [],
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

export function recentError(id: string, pattern: string): TaskWorkingMemory['recentErrors'][number] {
  return {
    id,
    source: 'tool',
    pattern,
    summary: pattern,
    createdAt: FIXED_NOW,
  };
}

export function recentSignal(
  id: string,
  kind: TaskWorkingMemory['recentSignals'][number]['kind'],
  summary = `${kind} signal`,
): TaskWorkingMemory['recentSignals'][number] {
  return {
    id,
    kind,
    summary,
    severity: kind === 'lostness_hard' ? 'high' : 'medium',
    createdAt: FIXED_NOW,
  };
}
