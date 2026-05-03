import { setup, assign } from 'xstate';
import type { MachineContext, MachineEvent } from './types.js';
import { SnapshotManager } from '../executor/index.js';

export function createStudentAgentMachine(snapshotManager: SnapshotManager) {
  return setup({
    types: {
      context: {} as MachineContext,
      events: {} as MachineEvent,
    },
    actions: {
      restoreSnapshotOnTimeout: ({ context }) => {
        if (!context.snapshotId) return;
        // XState actions are synchronous; fire-and-forget the async restore
        void (async () => {
          try {
            await snapshotManager.restore(context.snapshotId!);
          } catch (err) {
            console.error('[state-machine] restoreSnapshotOnTimeout failed:', err);
          }
        })();
      },
      incrementTimeoutCount: assign({
        timeoutCount: ({ context }) => context.timeoutCount + 1,
      }),
      setFailureReason: assign({
        failureReason: ({ event }) =>
          event.type === 'EXECUTION_FAILED' ? event.error : null,
      }),
    },
  }).createMachine({
    id: 'studentAgent',
    initial: 'idle',
    context: {
      taskId: null,
      currentAttempt: 0,
      snapshotId: null,
      failureReason: null,
      isHighRiskOperation: false,
      timeoutCount: 0,
    },
    states: {
      idle: {
        on: {
          START_TASK: {
            target: 'planning',
            actions: assign({
              taskId: () => `task_${Date.now()}`,
              currentAttempt: 0,
              timeoutCount: 0,
              snapshotId: null,
              failureReason: null,
            }),
          },
        },
      },
      planning: {
        on: {
          PLAN_READY: 'awaiting_confirmation',
        },
      },
      awaiting_confirmation: {
        on: {
          USER_CONFIRMED: 'executing',
          USER_REJECTED: 'idle',
        },
      },
      executing: {
        after: {
          120000: 'execution_timeout',
        },
        on: {
          EXECUTION_ROUND_COMPLETE: {
            target: 'idle',
            actions: assign({ currentAttempt: ({ context }) => context.currentAttempt + 1 }),
          },
          EXECUTION_FAILED: {
            target: 'reflecting',
            actions: 'setFailureReason',
          },
          USER_INTERRUPT: 'cancelled',
        },
      },
      execution_timeout: {
        entry: ['restoreSnapshotOnTimeout', 'incrementTimeoutCount'],
        always: [
          {
            guard: ({ context }) => context.timeoutCount < 2,
            target: 'executing',
          },
          {
            target: 'reflecting',
          },
        ],
      },
      reflecting: {
        // Placeholder — stage 1, step 3 (failure escalation ladder)
      },
      asking_user: {
        // Placeholder — stage 1, step 4 (questions.json)
      },
      completed: {
        type: 'final',
      },
      cancelled: {
        type: 'final',
      },
      failed: {
        type: 'final',
      },
    },
  });
}

// Backward-compatible singleton for tests and simple usage
export const studentAgentMachine = createStudentAgentMachine(new SnapshotManager(process.cwd()));
