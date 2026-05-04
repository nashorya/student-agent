import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createActor } from 'xstate';
import { createStudentAgentMachine, studentAgentMachine } from '../machine.js';
import type { SnapshotManager } from '../../executor/index.js';
import { resourceManager } from '../resource-manager.js';

function makeActor() {
  return createActor(studentAgentMachine);
}

async function waitForMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('studentAgentMachine', () => {
  beforeEach(() => {
    resourceManager.reset();
  });

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

  it('transitions executing → idle on EXECUTION_ROUND_COMPLETE', async () => {
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
    await waitForMicrotasks();
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
    expect(actor.getSnapshot().value).toBe('restoring');
    expect(actor.getSnapshot().context.failureReason).toBe('tool error');
    actor.stop();
  });

  it('transitions executing → cancelled on USER_INTERRUPT', async () => {
    const actor = makeActor();
    actor.start();
    actor.send({ type: 'START_TASK', input: 'test task' });
    actor.send({ type: 'PLAN_READY', plan: { id: 'p1', steps: [] } });
    actor.send({ type: 'USER_CONFIRMED' });
    actor.send({ type: 'USER_INTERRUPT' });
    expect(actor.getSnapshot().value).toBe('restoring_to_cancelled');
    await waitForMicrotasks();
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

  it('retries twice, then enters restoring before failure escalation after 3 timeouts', async () => {
    vi.useFakeTimers();
    let restoreCalls = 0;
    const restore = vi.fn(() => {
      restoreCalls += 1;
      if (restoreCalls < 3) return Promise.resolve();
      return new Promise<void>(() => undefined);
    });
    const machine = createStudentAgentMachine(
      { restore } as unknown as SnapshotManager,
      { executor: { executeRound: vi.fn().mockResolvedValue([]) } },
    );
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: 'START_TASK', input: 'test task' });
    actor.send({ type: 'PLAN_READY', plan: { id: 'p1', steps: [] } });
    actor.send({ type: 'USER_CONFIRMED' });
    actor.send({ type: 'SNAPSHOT_CREATED', sha: 'snapshot_1' });

    // First timeout → retry (timeoutCount = 1)
    await vi.advanceTimersByTimeAsync(120_001);
    expect(actor.getSnapshot().value).toBe('executing');

    // Second timeout → retry again because the architecture allows timeout_count <= 2
    await vi.advanceTimersByTimeAsync(120_001);
    expect(actor.getSnapshot().value).toBe('executing');
    expect(actor.getSnapshot().context.timeoutCount).toBe(2);

    // Third timeout → holds in restoring before failure escalation
    await vi.advanceTimersByTimeAsync(120_001);
    expect(actor.getSnapshot().value).toBe('restoring');
    expect(actor.getSnapshot().context.timeoutCount).toBe(3);

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

  it('resets timeoutCount on new START_TASK', async () => {
    const actor = makeActor();
    actor.start();

    // First task completes
    actor.send({ type: 'START_TASK', input: 'task 1' });
    actor.send({ type: 'PLAN_READY', plan: { id: 'p1', steps: [] } });
    actor.send({ type: 'USER_CONFIRMED' });
    actor.send({ type: 'EXECUTION_ROUND_COMPLETE', toolCalls: [], timestamp: Date.now() });
    await waitForMicrotasks();

    // Second task starts
    actor.send({ type: 'START_TASK', input: 'task 2' });
    expect(actor.getSnapshot().context.timeoutCount).toBe(0);

    actor.stop();
  });

  it('calls executor for tool calls before completing the round', async () => {
    const executeRound = vi.fn().mockResolvedValue([]);
    const machine = createStudentAgentMachine(
      { restore: vi.fn().mockResolvedValue(undefined) } as unknown as SnapshotManager,
      { executor: { executeRound } },
    );
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: 'START_TASK', input: 'test task' });
    actor.send({ type: 'PLAN_READY', plan: { id: 'p1', steps: [] } });
    actor.send({ type: 'USER_CONFIRMED' });
    actor.send({
      type: 'EXECUTION_ROUND_COMPLETE',
      toolCalls: [{ id: 'tc1', name: 'read_file', input: {} }],
      timestamp: Date.now(),
    });

    expect(actor.getSnapshot().value).toBe('executing_tools');
    await waitForMicrotasks();
    expect(executeRound).toHaveBeenCalledWith(
      [{ id: 'tc1', name: 'read_file', input: {} }],
      expect.any(AbortSignal),
    );
    expect(actor.getSnapshot().value).toBe('idle');
    actor.stop();
  });

  it('waits for restore to finish before retrying after timeout', async () => {
    vi.useFakeTimers();
    let resolveRestore!: () => void;
    const restore = vi.fn(
      () => new Promise<void>((resolve) => {
        resolveRestore = resolve;
      }),
    );
    const machine = createStudentAgentMachine(
      { restore } as unknown as SnapshotManager,
      { executor: { executeRound: vi.fn().mockResolvedValue([]) } },
    );
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: 'START_TASK', input: 'test task' });
    actor.send({ type: 'PLAN_READY', plan: { id: 'p1', steps: [] } });
    actor.send({ type: 'USER_CONFIRMED' });
    actor.send({ type: 'SNAPSHOT_CREATED', sha: 'snapshot_1' });

    await vi.advanceTimersByTimeAsync(120_001);
    expect(actor.getSnapshot().value).toBe('restoring');
    expect(restore).toHaveBeenCalledWith('snapshot_1');

    resolveRestore();
    await vi.advanceTimersByTimeAsync(0);
    expect(actor.getSnapshot().value).toBe('executing');
    actor.stop();
    vi.useRealTimers();
  });
});
