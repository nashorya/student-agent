import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WriteQueue } from '../../../core/write-queue.js';
import { RunArchiveWriter } from '../run-archive-writer.js';
import type { RunEvent, TaskOutcome } from '../types.js';

describe('RunArchiveWriter', () => {
  let memoryDir: string;
  let writer: RunArchiveWriter;

  beforeEach(async () => {
    memoryDir = await mkdtemp(join(tmpdir(), 'run-archive-test-'));
    WriteQueue.resetInstance();
    writer = new RunArchiveWriter({ memoryDir });
  });

  afterEach(async () => {
    WriteQueue.resetInstance();
    await rm(memoryDir, { recursive: true, force: true });
  });

  it('creates the run directory on startRun', async () => {
    await writer.startRun('task_1', 'run_1');

    const info = await stat(join(memoryDir, 'runs', 'run_1'));
    expect(info.isDirectory()).toBe(true);
  });

  it('appends events to events.jsonl', async () => {
    await writer.appendEvent('run_1', event('tool_call', 'Read file', { toolName: 'read' }));
    await writer.appendEvent('run_1', event('tool_error', 'Read failed', {
      toolName: 'read',
      metadata: { evidenceRef: 'call_1' },
    }));

    const raw = await readFile(join(memoryDir, 'runs', 'run_1', 'events.jsonl'), 'utf-8');
    const lines = raw.trim().split('\n').map((line) => JSON.parse(line) as RunEvent);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ kind: 'tool_call', summary: 'Read file' });
    expect(lines[1]).toMatchObject({ kind: 'tool_error', metadata: { evidenceRef: 'call_1' } });
  });

  it('finalizes a run by counting events and writing outcome.json', async () => {
    await writer.appendEvent('run_1', event('tool_call', 'Read file', { toolName: 'read' }));
    await writer.appendEvent('run_1', event('tool_call', 'Read again', { toolName: 'read' }));
    await writer.appendEvent('run_1', event('tool_call', 'Edit file', { toolName: 'edit' }));
    await writer.appendEvent('run_1', event('tool_error', 'Edit failed', {
      toolName: 'edit',
      metadata: { evidenceRef: 'call_2' },
    }));
    await writer.appendEvent('run_1', event('hashline_rejection', 'Stale hash', {
      path: 'src/App.tsx',
      metadata: { evidenceRef: ['hash_1', 'hash_2'] },
    }));
    await writer.appendEvent('run_1', event('hashline_recovery', 'Recovered hash', {
      path: 'src/App.tsx',
      metadata: { evidenceRef: 'hash_1' },
    }));
    await writer.appendEvent('run_1', event('user_correction', 'Wrong assumption'));
    await writer.appendEvent('run_1', event('lostness_soft', 'No progress'));

    const outcome = await writer.finalizeRun('run_1', {
      taskId: 'task_1',
      status: 'partial',
      userAccepted: false,
      finalSummary: 'Implemented most of the task',
    });

    expect(outcome).toMatchObject({
      taskId: 'task_1',
      runId: 'run_1',
      status: 'partial',
      userAccepted: false,
      userCorrectionCount: 1,
      toolErrorCount: 1,
      hashlineRejectionCount: 1,
      hashlineRecoveryCount: 1,
      repeatedToolCallCount: 1,
      lostnessTriggerCount: 1,
      finalSummary: 'Implemented most of the task',
      evidenceRefs: ['call_2', 'hash_1', 'hash_2'],
    });
    expect(outcome.createdAt).toEqual(expect.any(String));

    const persisted = JSON.parse(
      await readFile(join(memoryDir, 'runs', 'run_1', 'outcome.json'), 'utf-8'),
    ) as TaskOutcome;
    expect(persisted).toEqual(outcome);
  });

  it('persists a working memory snapshot when finalizing a run', async () => {
    const wmSnapshot = {
      taskId: 'task_1',
      runId: 'run_1',
      goal: 'Archive WM snapshot',
      phase: 'executing',
      finalStep: 'Persist outcome',
      completedTodos: [],
      completedTodoCount: 0,
      readFiles: [],
      writtenFiles: [],
      keyFiles: [],
      keySignalSummaries: [],
      errorPatterns: [],
      evidenceRefs: ['runs/run_1/events.jsonl', 'runs/run_1/outcome.json'],
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    const outcome = await writer.finalizeRun('run_1', {
      taskId: 'task_1',
      status: 'success',
      finalSummary: 'Done',
      wmSnapshot,
    });

    expect(outcome.wmSnapshot).toEqual(wmSnapshot);
    const persisted = JSON.parse(
      await readFile(join(memoryDir, 'runs', 'run_1', 'outcome.json'), 'utf-8'),
    ) as TaskOutcome;
    expect(persisted.wmSnapshot).toEqual(wmSnapshot);
  });
});

function event(
  kind: RunEvent['kind'],
  summary: string,
  overrides: Partial<RunEvent> = {},
): RunEvent {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    kind,
    summary,
    ...overrides,
  };
}
