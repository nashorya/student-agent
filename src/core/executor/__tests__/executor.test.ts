import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Executor } from '../executor.js';
import type { SnapshotManager } from '../snapshot.js';
import type { ConfirmationProvider, ExecutorTool, ToolResult } from '../types.js';
import { ToolExecutionError } from '../types.js';

const makeSnapshotManager = (sha = 'abc123') => ({
  create: vi.fn().mockResolvedValue(sha),
  restore: vi.fn().mockResolvedValue(undefined),
}) as unknown as SnapshotManager;

const makeConfirmation = (result = true) => ({
  confirm: vi.fn().mockResolvedValue(result),
}) as unknown as ConfirmationProvider;

const makeTool = (name: string, output: unknown = 'ok') => ({
  name,
  run: vi.fn().mockResolvedValue(output),
} as unknown as ExecutorTool);

describe('Executor', () => {
  let snapshotManager: ReturnType<typeof makeSnapshotManager>;
  let confirmationProvider: ReturnType<typeof makeConfirmation>;

  beforeEach(() => {
    snapshotManager = makeSnapshotManager();
    confirmationProvider = makeConfirmation();
  });

  it('low-risk tool happy path: runs tool, creates snapshot, calls onSnapshot, returns result', async () => {
    const tool = makeTool('read_file', 'ok');
    const onSnapshot = vi.fn();
    const executor = new Executor({
      snapshotManager,
      confirmationProvider,
      tools: new Map([['read_file', tool]]),
      onSnapshot,
    });

    const results = await executor.executeRound([
      { id: '1', name: 'read_file', input: { path: '/foo' } },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ toolName: 'read_file', output: 'ok', rolledBack: false });
    expect(snapshotManager.create).toHaveBeenCalledOnce();
    expect(onSnapshot).toHaveBeenCalledWith('abc123');
    expect(confirmationProvider.confirm).not.toHaveBeenCalled();
  });

  it('low-risk tool: run() throws → restore called, rolledBack: true, ToolExecutionError thrown', async () => {
    const tool = makeTool('read_file');
    (tool.run as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('oops'));

    const capturedResults: ToolResult[] = [];
    const snapshotWithSpy = makeSnapshotManager('abc123');

    const executor = new Executor({
      snapshotManager: snapshotWithSpy,
      confirmationProvider,
      tools: new Map([['read_file', tool]]),
      onSnapshot: () => {
        // spy hook — results will be inspected via the thrown error's cause
      },
    });

    let thrownError: unknown;

    try {
      await executor.executeRound([{ id: '1', name: 'read_file', input: {} }]);
    } catch (e) {
      thrownError = e;
      if (e instanceof ToolExecutionError) {
        capturedResults.push({ toolName: 'read_file', output: null, rolledBack: e.rolledBack });
      }
    }

    expect(snapshotWithSpy.restore).toHaveBeenCalledWith('abc123');
    expect(thrownError).toBeInstanceOf(ToolExecutionError);
    expect((thrownError as ToolExecutionError).rolledBack).toBe(true);
    expect(capturedResults).toHaveLength(1);
    expect(capturedResults[0]).toMatchObject({ rolledBack: true, output: null });
  });

  it('low-risk tool: run() throws AND restore() throws → ToolExecutionError with rolledBack: false and restoreError set', async () => {
    const tool = makeTool('read_file');
    (tool.run as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('run error'));
    (snapshotManager.restore as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('restore error'));

    const executor = new Executor({
      snapshotManager,
      confirmationProvider,
      tools: new Map([['read_file', tool]]),
    });

    const capturedResults: ToolResult[] = [];
    let thrownError: unknown;

    try {
      await executor.executeRound([{ id: '1', name: 'read_file', input: {} }]);
    } catch (e) {
      thrownError = e;
      if (e instanceof ToolExecutionError) {
        capturedResults.push({ toolName: 'read_file', output: null, rolledBack: e.rolledBack });
      }
    }

    expect(thrownError).toBeInstanceOf(ToolExecutionError);
    expect((thrownError as ToolExecutionError).rolledBack).toBe(false);
    expect((thrownError as ToolExecutionError).restoreError).toBeDefined();
    expect(capturedResults).toHaveLength(1);
    expect(capturedResults[0]).toMatchObject({ rolledBack: false, output: null });
  });

  it('high-risk tool: confirm returns false → tool NOT run, result output: skipped-by-user', async () => {
    confirmationProvider = makeConfirmation(false);
    const tool = makeTool('delete_file');
    const executor = new Executor({
      snapshotManager,
      confirmationProvider,
      tools: new Map([['delete_file', tool]]),
    });

    const results = await executor.executeRound([
      { id: '1', name: 'delete_file', input: { path: '/foo' } },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ toolName: 'delete_file', output: 'skipped-by-user', rolledBack: false });
    expect(tool.run).not.toHaveBeenCalled();
    expect(snapshotManager.create).not.toHaveBeenCalled();
  });

  it('high-risk tool: confirm returns true → full execution flow', async () => {
    const tool = makeTool('delete_file', 'ok');
    const executor = new Executor({
      snapshotManager,
      confirmationProvider,
      tools: new Map([['delete_file', tool]]),
    });

    const results = await executor.executeRound([
      { id: '1', name: 'delete_file', input: { path: '/foo' } },
    ]);

    expect(confirmationProvider.confirm).toHaveBeenCalledOnce();
    expect(tool.run).toHaveBeenCalledOnce();
    expect(snapshotManager.create).toHaveBeenCalledOnce();
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ toolName: 'delete_file', output: 'ok', rolledBack: false });
  });

  it('onSnapshot callback called with sha from snapshotManager.create()', async () => {
    const customSnapshot = makeSnapshotManager('sha-xyz');
    const tool = makeTool('read_file');
    const onSnapshot = vi.fn();
    const executor = new Executor({
      snapshotManager: customSnapshot,
      confirmationProvider,
      tools: new Map([['read_file', tool]]),
      onSnapshot,
    });

    await executor.executeRound([{ id: '1', name: 'read_file', input: {} }]);

    expect(onSnapshot).toHaveBeenCalledWith('sha-xyz');
  });

  it('tool not found → result output: tool-not-found, execution continues to next tool', async () => {
    const tool = makeTool('read_file', 'ok');
    const executor = new Executor({
      snapshotManager,
      confirmationProvider,
      tools: new Map([['read_file', tool]]),
    });

    const results = await executor.executeRound([
      { id: '1', name: 'unknown_tool', input: {} },
      { id: '2', name: 'read_file', input: {} },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ toolName: 'unknown_tool', output: 'tool-not-found', rolledBack: false });
    expect(results[1]).toEqual({ toolName: 'read_file', output: 'ok', rolledBack: false });
    expect(tool.run).toHaveBeenCalledOnce();
  });
});
