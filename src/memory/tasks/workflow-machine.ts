import { createActor, setup, type ActorRefFrom } from 'xstate';
import type { TaskWorkflowStatus } from './types.js';

export type WorkflowMachineStatus =
  | 'planning'
  | 'awaiting_plan_approval'
  | 'executing'
  | 'retrying'
  | 'blocked'
  | 'failed'
  | 'visual_review'
  | 'user_review'
  | 'revision_requested'
  | 'accepted'
  | 'completed'
  | 'cancelled';

export type WorkflowEvent =
  | { type: 'PLAN' }
  | { type: 'AWAIT_APPROVAL' }
  | { type: 'APPROVE' }
  | { type: 'EXECUTE' }
  | { type: 'COMPLETE_PHASE'; target?: 'visual_review' | 'user_review' | 'completed' }
  | { type: 'RETRY' }
  | { type: 'BLOCK' }
  | { type: 'REQUEST_REVISION' }
  | { type: 'ACCEPT' }
  | { type: 'COMPLETE' }
  | { type: 'CANCEL' }
  | { type: 'FAIL' }
  | { type: 'UNBLOCK' };

const cancelTransition = { CANCEL: { target: 'cancelled' } };

export const workflowMachine = setup({
  types: {} as {
    context: Record<string, never>;
    events: WorkflowEvent;
  },
}).createMachine({
  id: 'taskWorkflow',
  initial: 'awaiting_plan_approval',
  context: {},
  states: {
    planning: {
      on: {
        EXECUTE: { target: 'executing' },
        AWAIT_APPROVAL: { target: 'awaiting_plan_approval' },
        ...cancelTransition,
      },
    },
    awaiting_plan_approval: {
      on: {
        EXECUTE: { target: 'executing' },
        APPROVE: { target: 'executing' },
        PLAN: { target: 'planning' },
        ...cancelTransition,
      },
    },
    executing: {
      on: {
        RETRY: { target: 'retrying' },
        BLOCK: { target: 'blocked' },
        FAIL: { target: 'failed' },
        COMPLETE_PHASE: [
          {
            guard: ({ event }) => event.target === 'visual_review',
            target: 'visual_review',
          },
          {
            guard: ({ event }) => event.target === 'completed',
            target: 'completed',
          },
          { target: 'user_review' },
        ],
        ...cancelTransition,
      },
    },
    retrying: {
      on: {
        EXECUTE: { target: 'executing' },
        ...cancelTransition,
      },
    },
    blocked: {
      on: {
        EXECUTE: { target: 'executing' },
        UNBLOCK: { target: 'executing' },
        ...cancelTransition,
      },
    },
    failed: {
      on: {
        ...cancelTransition,
      },
    },
    visual_review: {
      on: {
        REQUEST_REVISION: { target: 'revision_requested' },
        ACCEPT: { target: 'accepted' },
        ...cancelTransition,
      },
    },
    user_review: {
      on: {
        REQUEST_REVISION: { target: 'revision_requested' },
        ACCEPT: { target: 'accepted' },
        ...cancelTransition,
      },
    },
    revision_requested: {
      on: {
        EXECUTE: { target: 'executing' },
        ...cancelTransition,
      },
    },
    accepted: {
      on: {
        COMPLETE: { target: 'completed' },
        ...cancelTransition,
      },
    },
    completed: {
      type: 'final',
    },
    cancelled: {
      type: 'final',
    },
  },
});

export type WorkflowActor = ActorRefFrom<typeof workflowMachine>;

export function isWorkflowMachineStatus(status: TaskWorkflowStatus): status is WorkflowMachineStatus {
  return [
    'planning',
    'awaiting_plan_approval',
    'executing',
    'retrying',
    'blocked',
    'failed',
    'visual_review',
    'user_review',
    'revision_requested',
    'accepted',
    'completed',
    'cancelled',
  ].includes(status);
}

export function createWorkflowActor(
  status: WorkflowMachineStatus,
  options: { logger?: (...args: unknown[]) => void } = {},
): WorkflowActor {
  const actor = createActor(workflowMachine, {
    ...options,
    snapshot: workflowMachine.resolveState({ value: status, context: {} }),
  });
  actor.start();
  return actor;
}

/** Map a TaskWorkflowStatus string to the event needed to transition TO that status. */
export function workflowStatusToEvent(targetStatus: TaskWorkflowStatus): WorkflowEvent | null {
  switch (targetStatus) {
    case 'planning':
      return { type: 'PLAN' };
    case 'awaiting_plan_approval':
      return { type: 'AWAIT_APPROVAL' };
    case 'executing':
      return { type: 'EXECUTE' };
    case 'retrying':
      return { type: 'RETRY' };
    case 'blocked':
      return { type: 'BLOCK' };
    case 'failed':
      return { type: 'FAIL' };
    case 'visual_review':
      return { type: 'COMPLETE_PHASE', target: 'visual_review' };
    case 'user_review':
      return { type: 'COMPLETE_PHASE', target: 'user_review' };
    case 'revision_requested':
      return { type: 'REQUEST_REVISION' };
    case 'accepted':
      return { type: 'ACCEPT' };
    case 'completed':
      return { type: 'COMPLETE' };
    case 'cancelled':
      return { type: 'CANCEL' };
    default:
      return null;
  }
}
