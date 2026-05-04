import { describe, it, expect, vi } from 'vitest';
import { PiSubAgentExecutor } from '../pi-subagent-executor.js';

describe('PiSubAgentExecutor', () => {
  it('为每个子任务创建独立 Student session 并执行 prompt', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const waitForIdle = vi.fn().mockResolvedValue(undefined);
    const createSession = vi.fn().mockResolvedValue({
      session: { prompt },
      agent: {
        waitForIdle,
        state: {
          messages: [
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'done' }],
            },
          ],
        },
      },
      piResult: {},
    });
    const worktreeManager = {
      create: vi.fn().mockResolvedValue({ path: '/tmp/worktree-a', branch: 'branch-a' }),
      collectPatch: vi.fn().mockResolvedValue('diff --git a/a.ts b/a.ts'),
      collectWrittenFiles: vi.fn().mockResolvedValue(['a.ts', 'new.ts']),
      cleanup: vi.fn().mockResolvedValue(undefined),
    };
    const executor = new PiSubAgentExecutor({
      cwd: process.cwd(),
      hooks: {},
      createSession,
      worktreeManager,
    });

    const result = await executor.execute({
      id: 'task_a',
      title: 'A',
      prompt: 'Do A',
      writeIntent: ['a.ts'],
    }, new AbortController().signal);

    expect(createSession).toHaveBeenCalledOnce();
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/tmp/worktree-a' }));
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining('子任务：A'));
    expect(waitForIdle).toHaveBeenCalledOnce();
    expect(worktreeManager.cleanup).toHaveBeenCalledOnce();
    expect(result).toEqual({
      status: 'success',
      summary: 'done',
      writtenFiles: ['a.ts', 'new.ts'],
      patch: 'diff --git a/a.ts b/a.ts',
    });
  });

  it('子任务执行失败时返回空 writtenFiles 并清理 worktree', async () => {
    const createSession = vi.fn().mockRejectedValue(new Error('boom'));
    const worktreeManager = {
      create: vi.fn().mockResolvedValue({ path: '/tmp/worktree-b', branch: 'branch-b' }),
      collectPatch: vi.fn(),
      collectWrittenFiles: vi.fn(),
      cleanup: vi.fn().mockResolvedValue(undefined),
    };
    const executor = new PiSubAgentExecutor({
      cwd: process.cwd(),
      hooks: {},
      createSession,
      worktreeManager,
    });

    const result = await executor.execute({
      id: 'task_b',
      title: 'B',
      prompt: 'Do B',
      writeIntent: ['b.ts'],
    }, new AbortController().signal);

    expect(result.status).toBe('failed');
    expect(result.writtenFiles).toEqual([]);
    expect(worktreeManager.cleanup).toHaveBeenCalledOnce();
  });
});
