import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TasksManager } from '../../memory/tasks/manager.js';
import { beginNonInteractiveContextTask } from '../non-interactive-context.js';
import {
  MAX_ZERO_EDIT_CONTINUATION_ROUNDS,
  ZERO_EDIT_CONTINUATION_PROMPT,
  ZeroEditContinuation,
} from '../zero-edit-continuation.js';

describe('ZeroEditContinuation', () => {
  let memoryDir: string | undefined;

  afterEach(async () => {
    TasksManager.resetInstance();
    if (memoryDir) await rm(memoryDir, { recursive: true, force: true });
    memoryDir = undefined;
  });

  it('sends continuation prompts while hard constraints exist and no files were written', async () => {
    memoryDir = await mkdtemp(join(tmpdir(), 'zero-edit-continuation-'));
    const task = await beginNonInteractiveContextTask({
      memoryDir,
      instruction: 'Only edit input.tex.',
    });
    const prompt = vi.fn(async () => undefined);
    const waitForIdle = vi.fn(async () => undefined);

    const rounds = await new ZeroEditContinuation({
      session: { prompt },
      agent: { waitForIdle },
      memoryDir,
      taskId: task.id,
    }).run(task.working_memory.hardConstraints);

    expect(rounds).toBe(MAX_ZERO_EDIT_CONTINUATION_ROUNDS);
    expect(prompt).toHaveBeenCalledTimes(MAX_ZERO_EDIT_CONTINUATION_ROUNDS);
    expect(prompt).toHaveBeenNthCalledWith(1, ZERO_EDIT_CONTINUATION_PROMPT);
    expect(waitForIdle).toHaveBeenCalledTimes(MAX_ZERO_EDIT_CONTINUATION_ROUNDS);
  });

  it('does not send a continuation prompt without hard constraints', async () => {
    memoryDir = await mkdtemp(join(tmpdir(), 'zero-edit-continuation-'));
    const task = await beginNonInteractiveContextTask({
      memoryDir,
      instruction: 'Do a task.',
    });
    const prompt = vi.fn(async () => undefined);
    const waitForIdle = vi.fn(async () => undefined);

    const rounds = await new ZeroEditContinuation({
      session: { prompt },
      agent: { waitForIdle },
      memoryDir,
      taskId: task.id,
    }).run('   ');

    expect(rounds).toBe(0);
    expect(prompt).not.toHaveBeenCalled();
    expect(waitForIdle).not.toHaveBeenCalled();
  });

  it('stops once the working memory records a written file', async () => {
    memoryDir = await mkdtemp(join(tmpdir(), 'zero-edit-continuation-'));
    const task = await beginNonInteractiveContextTask({
      memoryDir,
      instruction: 'Only edit input.tex.',
    });
    const manager = TasksManager.getInstance(memoryDir);
    const prompt = vi.fn(async () => {
      await manager.trackFileWrite(task.id, 'input.tex');
    });
    const waitForIdle = vi.fn(async () => undefined);

    const rounds = await new ZeroEditContinuation({
      session: { prompt },
      agent: { waitForIdle },
      memoryDir,
      taskId: task.id,
    }).run(task.working_memory.hardConstraints);

    expect(rounds).toBe(1);
    expect(prompt).toHaveBeenCalledOnce();
    expect(waitForIdle).toHaveBeenCalledOnce();
  });

  it('does not prompt when a written file is already recorded', async () => {
    memoryDir = await mkdtemp(join(tmpdir(), 'zero-edit-continuation-'));
    const task = await beginNonInteractiveContextTask({
      memoryDir,
      instruction: 'Only edit input.tex.',
    });
    await TasksManager.getInstance(memoryDir).trackFileWrite(task.id, 'input.tex');
    const prompt = vi.fn(async () => undefined);
    const waitForIdle = vi.fn(async () => undefined);

    const rounds = await new ZeroEditContinuation({
      session: { prompt },
      agent: { waitForIdle },
      memoryDir,
      taskId: task.id,
    }).run(task.working_memory.hardConstraints);

    expect(rounds).toBe(0);
    expect(prompt).not.toHaveBeenCalled();
    expect(waitForIdle).not.toHaveBeenCalled();
  });
});
