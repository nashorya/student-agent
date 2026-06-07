import { describe, expect, it } from 'vitest';
import { getNextSnapshot } from 'xstate';
import {
  createWorkflowActor,
  workflowMachine,
  workflowStatusToEvent,
} from '../workflow-machine.js';

describe('workflowMachine', () => {
  it('transitions awaiting plan approval to executing', () => {
    const actor = createWorkflowActor('awaiting_plan_approval');

    actor.send({ type: 'EXECUTE' });

    expect(actor.getSnapshot().value).toBe('executing');
  });

  it('transitions executing to retrying and back to executing', () => {
    const actor = createWorkflowActor('executing');

    actor.send({ type: 'RETRY' });
    expect(actor.getSnapshot().value).toBe('retrying');

    actor.send({ type: 'EXECUTE' });
    expect(actor.getSnapshot().value).toBe('executing');
  });

  it('transitions executing through review acceptance to completed', () => {
    const actor = createWorkflowActor('executing');

    actor.send({ type: 'COMPLETE_PHASE' });
    expect(actor.getSnapshot().value).toBe('user_review');

    actor.send({ type: 'ACCEPT' });
    expect(actor.getSnapshot().value).toBe('accepted');

    actor.send({ type: 'COMPLETE' });
    expect(actor.getSnapshot().value).toBe('completed');
  });

  it('ignores invalid transition from completed to executing', () => {
    const snapshot = workflowMachine.resolveState({ value: 'completed', context: {} });

    const next = getNextSnapshot(workflowMachine, snapshot, { type: 'EXECUTE' });

    expect(next.value).toBe('completed');
  });

  it('ignores invalid transition from awaiting plan approval to retrying', () => {
    const actor = createWorkflowActor('awaiting_plan_approval');

    actor.send({ type: 'RETRY' });

    expect(actor.getSnapshot().value).toBe('awaiting_plan_approval');
  });

  it('cancels from active workflow states', () => {
    for (const status of ['executing', 'planning', 'retrying'] as const) {
      const actor = createWorkflowActor(status);

      actor.send({ type: 'CANCEL' });

      expect(actor.getSnapshot().value).toBe('cancelled');
    }
  });

  it('rehydrates an actor from retrying and transitions to executing', () => {
    const actor = createWorkflowActor('retrying');

    actor.send({ type: 'EXECUTE' });

    expect(actor.getSnapshot().value).toBe('executing');
  });

  it('maps target workflow statuses to transition events', () => {
    expect(workflowStatusToEvent('executing')).toEqual({ type: 'EXECUTE' });
    expect(workflowStatusToEvent('visual_review')).toEqual({
      type: 'COMPLETE_PHASE',
      target: 'visual_review',
    });
    expect(workflowStatusToEvent('user_review')).toEqual({
      type: 'COMPLETE_PHASE',
      target: 'user_review',
    });
    expect(workflowStatusToEvent('technical_verification')).toBeNull();
  });
});
