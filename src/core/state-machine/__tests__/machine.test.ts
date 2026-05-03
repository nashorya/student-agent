import { describe, it, expect, vi } from 'vitest';
import { createActor } from 'xstate';
import { studentAgentMachine } from '../machine.js';

function makeActor() {
  return createActor(studentAgentMachine);
}

describe('studentAgentMachine', () => {
  it('starts in idle state', () => {
    const actor = makeActor();
    actor.start();
    expect(actor.getSnapshot().value).toBe('idle');
    actor.stop();
  });

  it('transitions idle → planning on START_TASK', () => {
    const actor = makeActor();
    actor.start();
    actor.send({ type: 'START_TASK', input: 'refactor auth module' });
    expect(actor.getSnapshot().value).toBe('planning');
    expect(actor.getSnapshot().context.taskId).toMatch(/^task_\d+$/);
    actor.stop();
  });

  it('transitions planning → awaiting_confirmation on PLAN_READY', () => {
    const actor = makeActor();
    actor.start();
    actor.send({ type: 'START_TASK', input: 'test task' });
    actor.send({ type: 'PLAN_READY', plan: { id: 'p1', steps: ['step1'] } });
    expect(actor.getSnapshot().value).toBe('awaiting_confirmation');
    actor.stop();
  });

  it('transitions awaiting_confirmation → executing on USER_CONFIRMED', () => {
    const actor = makeActor();
    actor.start();
    actor.send({ type: 'START_TASK', input: 'test task' });
    actor.send({ type: 'PLAN_READY', plan: { id: 'p1', steps: [] } });
    actor.send({ type: 'USER_CONFIRMED' });
    expect(actor.getSnapshot().value).toBe('executing');
    actor.stop();
  });

  it('transitions awaiting_confirmation → idle on USER_REJECTED', () => {
    const actor = makeActor();
    actor.start();
    actor.send({ type: 'START_TASK', input: 'test task' });
    actor.send({ type: 'PLAN_READY', plan: { id: 'p1', steps: [] } });
    actor.send({ type: 'USER_REJECTED', reason: 'wrong plan' });
    expect(actor.getSnapshot().value).toBe('idle');
    actor.stop();
  });

  it('transitions executing → idle on EXECUTION_ROUND_COMPLETE', () => {
    const actor = makeActor();
    actor.start();
    actor.send({ type: 'START_TASK', input: 'test task' });
    actor.send({ type: 'PLAN_READY', plan: { id: 'p1', steps: [] } });
    actor.send({ type: 'USER_CONFIRMED' });
    actor.send({
      type: 'EXECUTION_ROUND_COMPLETE',
      toolCalls: [],
      timestamp: Date.now(),
    });
    expect(actor.getSnapshot().value).toBe('idle');
    actor.stop();
  });

  it('transitions executing → reflecting on EXECUTION_FAILED', () => {
    const actor = makeActor();
    actor.start();
    actor.send({ type: 'START_TASK', input: 'test task' });
    actor.send({ type: 'PLAN_READY', plan: { id: 'p1', steps: [] } });
    actor.send({ type: 'USER_CONFIRMED' });
    actor.send({ type: 'EXECUTION_FAILED', error: 'tool error' });
    // reflecting is now a compound state; we land in attempt_1 before the async stub resolves
    expect(actor.getSnapshot().value).toMatchObject({ reflecting: expect.any(String) });
    expect(actor.getSnapshot().context.failureReason).toBe('tool error');
    actor.stop();
  });

  it('transitions executing → cancelled on USER_INTERRUPT', () => {
    const actor = makeActor();
    actor.start();
    actor.send({ type: 'START_TASK', input: 'test task' });
    actor.send({ type: 'PLAN_READY', plan: { id: 'p1', steps: [] } });
    actor.send({ type: 'USER_CONFIRMED' });
    actor.send({ type: 'USER_INTERRUPT' });
    expect(actor.getSnapshot().value).toBe('cancelled');
    actor.stop();
  });

  it('auto-retries on timeout when timeoutCount < 2', async () => {
    vi.useFakeTimers();
    const actor = makeActor();
    actor.start();
    actor.send({ type: 'START_TASK', input: 'test task' });
    actor.send({ type: 'PLAN_READY', plan: { id: 'p1', steps: [] } });
    actor.send({ type: 'USER_CONFIRMED' });
    expect(actor.getSnapshot().value).toBe('executing');

    // Trigger 120s timeout
    await vi.advanceTimersByTimeAsync(120_001);

    // Should auto-retry back to executing (timeoutCount becomes 1, which is < 2)
    expect(actor.getSnapshot().value).toBe('executing');
    expect(actor.getSnapshot().context.timeoutCount).toBe(1);

    actor.stop();
    vi.useRealTimers();
  });

  it('transitions to reflecting after 2 timeouts', async () => {
    vi.useFakeTimers();
    const actor = makeActor();
    actor.start();
    actor.send({ type: 'START_TASK', input: 'test task' });
    actor.send({ type: 'PLAN_READY', plan: { id: 'p1', steps: [] } });
    actor.send({ type: 'USER_CONFIRMED' });

    // First timeout → retry (timeoutCount = 1)
    await vi.advanceTimersByTimeAsync(120_001);
    expect(actor.getSnapshot().value).toBe('executing');

    // Second timeout → stub actors run and exhaust all 3 attempts → asking_user
    await vi.advanceTimersByTimeAsync(120_001);
    expect(actor.getSnapshot().value).toBe('asking_user');
    expect(actor.getSnapshot().context.timeoutCount).toBe(2);

    actor.stop();
    vi.useRealTimers();
  });

  it('stores snapshotId in context on SNAPSHOT_CREATED while executing', () => {
    const actor = makeActor();
    actor.start();
    actor.send({ type: 'START_TASK', input: 'test task' });
    actor.send({ type: 'PLAN_READY', plan: { id: 'p1', steps: [] } });
    actor.send({ type: 'USER_CONFIRMED' });
    actor.send({ type: 'SNAPSHOT_CREATED', sha: 'a'.repeat(40) });
    expect(actor.getSnapshot().context.snapshotId).toBe('a'.repeat(40));
    actor.stop();
  });

  it('resets timeoutCount on new START_TASK', () => {
    const actor = makeActor();
    actor.start();

    // First task completes
    actor.send({ type: 'START_TASK', input: 'task 1' });
    actor.send({ type: 'PLAN_READY', plan: { id: 'p1', steps: [] } });
    actor.send({ type: 'USER_CONFIRMED' });
    actor.send({ type: 'EXECUTION_ROUND_COMPLETE', toolCalls: [], timestamp: Date.now() });

    // Second task starts
    actor.send({ type: 'START_TASK', input: 'task 2' });
    expect(actor.getSnapshot().context.timeoutCount).toBe(0);

    actor.stop();
  });
});
