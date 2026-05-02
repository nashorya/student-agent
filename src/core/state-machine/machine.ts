import { setup, assign } from 'xstate';
import type { MachineContext, MachineEvent } from './types.js';

export const studentAgentMachine = setup({
  types: {
    context: {} as MachineContext,
    events: {} as MachineEvent,
  },
  actions: {
    restoreSnapshotOnTimeout: ({ context }) => {
      // Placeholder — full implementation in Executor (stage 1, step 2)
      console.log('[timeout] would restore snapshot:', context.snapshotId);
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
