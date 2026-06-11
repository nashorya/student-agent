import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it } from 'vitest';
import { emitProtectedEvent, drainProtectedEvents } from '../../../core/hashline/index.js';
import { TasksManager } from '../../tasks/manager.js';
import { createSignalPipeline } from '../signal-pipeline.js';
import { readRecentSignals } from '../signal-store.js';
import type { PostToolCallContext } from '../../../core/pi-bridge/types.js';

const baseCtx: PostToolCallContext = {
  toolName: 'edit',
  toolCallId: 'call_1',
  args: {},
  isError: false,
  resultText: '',
};

describe('Signal Pipeline', () => {
  let memoryDir: string;
  let tasksManager: TasksManager;

  beforeEach(async () => {
    drainProtectedEvents();
    TasksManager.resetInstance();
    tasksManager = TasksManager.getInstance(':memory:');
    memoryDir = await mkdtemp(join(tmpdir(), 'student-agent-signals-'));
  });

  it('creates a signal for tool errors and writes active task recentErrors', async () => {
    const task = await tasksManager.createTask('测试任务', ['Phase 1']);
    const pipeline = createSignalPipeline({ memoryDir, tasksManager });

    await pipeline.processAfterToolCall({
      ...baseCtx,
      isError: true,
      resultText: 'oldText must match exactly\nmore details',
    });

    const signals = await readRecentSignals(10, memoryDir);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      kind: 'tool_error',
      severity: 'medium',
      summary: 'oldText must match exactly\nmore details',
      toolName: 'edit',
      toolCallId: 'call_1',
      pattern: 'oldText must match exactly',
      evidenceRef: 'call_1',
    });

    const updated = await tasksManager.getTask(task.id);
    expect(updated?.working_memory.recentErrors).toContainEqual(expect.objectContaining({
      source: 'tool',
      summary: 'oldText must match exactly\nmore details',
    }));
  });

  it('creates a signal for ToolGuard blocks from protected events', async () => {
    const task = await tasksManager.createTask('测试任务', ['Phase 1']);
    const pipeline = createSignalPipeline({ memoryDir, tasksManager });
    emitProtectedEvent({
      source: 'toolguard',
      type: 'block',
      ruleName: 'empty_bash',
      blocked: true,
    });

    await pipeline.processAfterToolCall(baseCtx);

    const signals = await readRecentSignals(10, memoryDir);
    expect(signals[0]).toMatchObject({
      kind: 'toolguard_block',
      severity: 'medium',
      summary: 'ToolGuard blocked: empty_bash',
      ruleName: 'empty_bash',
    });
    const updated = await tasksManager.getTask(task.id);
    expect(updated?.working_memory.recentErrors[0]).toMatchObject({
      source: 'toolguard',
      summary: 'ToolGuard blocked: empty_bash',
    });
  });

  it('reports drained protected events to an observer', async () => {
    const observed: Array<{ ruleName?: string }> = [];
    const pipeline = createSignalPipeline({
      memoryDir,
      tasksManager,
      onProtectedEvents: (events) => observed.push(...events),
    });
    emitProtectedEvent({
      source: 'toolguard',
      type: 'block',
      ruleName: 'verify_retry',
      blocked: true,
    });

    await pipeline.processAfterToolCall(baseCtx);

    expect(observed).toContainEqual(expect.objectContaining({
      ruleName: 'verify_retry',
    }));
  });

  it('creates a high severity signal for Hashline stale rejections', async () => {
    const pipeline = createSignalPipeline({ memoryDir, tasksManager });
    emitProtectedEvent({
      source: 'hashline',
      type: 'stale_rejection',
      path: 'src/App.tsx',
      evidenceRef: 'hash123',
      blocked: true,
    });

    await pipeline.processAfterToolCall(baseCtx);

    const signals = await readRecentSignals(10, memoryDir);
    expect(signals[0]).toMatchObject({
      kind: 'hashline_rejection',
      severity: 'high',
      summary: 'Hashline stale rejection: src/App.tsx',
      path: 'src/App.tsx',
      evidenceRef: 'hash123',
    });
  });

  it('does not write a signal when there is no tool error or protected event', async () => {
    const pipeline = createSignalPipeline({ memoryDir, tasksManager });

    await pipeline.processAfterToolCall(baseCtx);

    expect(await readRecentSignals(10, memoryDir)).toEqual([]);
  });

  it('appends signals to signals.jsonl', async () => {
    const pipeline = createSignalPipeline({ memoryDir, tasksManager });

    await pipeline.processAfterToolCall({ ...baseCtx, isError: true, resultText: 'first error' });
    await pipeline.processAfterToolCall({ ...baseCtx, toolCallId: 'call_2', isError: true, resultText: 'second error' });

    const file = await readFile(join(memoryDir, 'signals.jsonl'), 'utf-8');
    expect(file.trim().split('\n')).toHaveLength(2);
  });

  it('maps signal severities by kind', async () => {
    const pipeline = createSignalPipeline({ memoryDir, tasksManager });
    emitProtectedEvent({ source: 'toolguard', type: 'block', ruleName: 'broad_glob', blocked: true });
    emitProtectedEvent({ source: 'hashline', type: 'stale_rejection', path: 'a.ts', blocked: true });
    emitProtectedEvent({ source: 'hashline', type: 'recovery_success', path: 'b.ts' });

    await pipeline.processAfterToolCall({ ...baseCtx, isError: true, resultText: 'tool failed' });

    const severities = Object.fromEntries((await readRecentSignals(10, memoryDir)).map((signal) => [signal.kind, signal.severity]));
    expect(severities.tool_error).toBe('medium');
    expect(severities.toolguard_block).toBe('medium');
    expect(severities.hashline_rejection).toBe('high');
    expect(severities.hashline_recovery).toBe('low');
  });

  it('respects working memory recentErrors cap', async () => {
    const task = await tasksManager.createTask('测试任务', ['Phase 1']);
    const pipeline = createSignalPipeline({ memoryDir, tasksManager });

    for (let i = 1; i <= 6; i++) {
      await pipeline.processAfterToolCall({
        ...baseCtx,
        toolCallId: `call_${i}`,
        isError: true,
        resultText: `error ${i}`,
      });
    }

    const updated = await tasksManager.getTask(task.id);
    expect(updated?.working_memory.recentErrors.map((error) => error.summary)).toEqual([
      'error 2',
      'error 3',
      'error 4',
      'error 5',
      'error 6',
    ]);
  });
});
