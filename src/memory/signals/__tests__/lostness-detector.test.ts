import { describe, expect, it } from 'vitest';
import type { TaskWorkingMemory } from '../../tasks/types.js';
import { detectLostness } from '../lostness-detector.js';
import type { Signal } from '../types.js';

describe('detectLostness', () => {
  it('triggers hard lostness for repeated user corrections in the same context', () => {
    const result = detectLostness({
      workingMemory: workingMemory(),
      recentSignals: [
        signal('sig_1', 'user_correction', {
          path: 'src/App.tsx',
          summary: 'User corrected the target file',
        }),
        signal('sig_2', 'user_correction', {
          path: 'src/App.tsx',
          summary: 'User corrected the target file again',
        }),
      ],
      turnSnapshots: [],
    });

    expect(result).toMatchObject({
      triggered: true,
      severity: 'hard',
      reasons: ['repeated_user_correction_same_context'],
      signal: {
        kind: 'lostness_hard',
        severity: 'high',
      },
    });
    expect(result.signal?.summary).toContain('repeated_user_correction_same_context');
  });

  it('triggers soft lostness when tool thrashing and stagnation both occur', () => {
    const result = detectLostness({
      workingMemory: workingMemory(),
      recentSignals: [
        signal('sig_1', 'tool_error', { toolName: 'edit', pattern: 'a' }),
        signal('sig_2', 'tool_error', { toolName: 'read', pattern: 'b' }),
        signal('sig_3', 'tool_error', { toolName: 'edit', pattern: 'c' }),
        signal('sig_4', 'hashline_recovery', {}),
        signal('sig_5', 'tool_error', { toolName: 'edit', pattern: 'd' }),
      ],
      turnSnapshots: Array.from({ length: 5 }, (_, index) => ({
        turnIndex: index + 1,
        completedTodos: 1,
        writeFileCount: 2,
        phase: 'executing',
        hasUserAdvance: false,
      })),
    });

    expect(result.triggered).toBe(true);
    expect(result.severity).toBe('soft');
    expect(result.reasons).toEqual([
      'tool_thrashing:edit',
      'stagnation:no_progress_5_turns',
    ]);
    expect(result.signal).toMatchObject({
      kind: 'lostness_soft',
      severity: 'medium',
    });
  });

  it('does not trigger when hard and soft thresholds are not met', () => {
    const result = detectLostness({
      workingMemory: workingMemory(),
      recentSignals: [
        signal('sig_1', 'tool_error', { toolName: 'edit', pattern: 'a' }),
        signal('sig_2', 'user_correction', { path: 'src/App.tsx' }),
      ],
      turnSnapshots: [
        {
          turnIndex: 1,
          completedTodos: 1,
          writeFileCount: 1,
          phase: 'executing',
          hasUserAdvance: false,
        },
        {
          turnIndex: 2,
          completedTodos: 2,
          writeFileCount: 2,
          phase: 'verifying',
          hasUserAdvance: true,
        },
      ],
    });

    expect(result).toEqual({
      triggered: false,
      severity: 'none',
      reasons: [],
    });
  });
});

function signal(
  id: string,
  kind: Signal['kind'],
  overrides: Partial<Signal>,
): Signal {
  return {
    id,
    kind,
    severity: 'medium',
    summary: `${kind} summary`,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function workingMemory(): TaskWorkingMemory {
  return {
    taskId: 'task_1',
    runId: 'run_1',
    goal: 'Fix current coding task',
    phase: 'executing',
    currentStep: 'Patch files',
    todos: [],
    readFiles: [],
    writeFiles: [],
    recentErrors: [],
    recentSignals: [],
    artifactRefs: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
