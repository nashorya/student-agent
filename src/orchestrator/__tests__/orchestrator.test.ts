import { describe, it, expect, vi } from 'vitest';
import { SubAgentOrchestrator, type SubAgentExecutor } from '../orchestrator.js';
import type { TaskPlan } from '../planner.js';

function makePlan(overrides: Partial<TaskPlan> = {}): TaskPlan {
  return {
    id: 'plan_1',
    originalTask: 'test',
    tasks: [
      {
        id: 'a',
        title: 'A',
        prompt: 'A',
        writeIntent: ['a.ts'],
      },
      {
        id: 'b',
        title: 'B',
        prompt: 'B',
        writeIntent: ['b.ts'],
      },
    ],
    conflicts: [],
    ...overrides,
  };
}

describe('SubAgentOrchestrator', () => {
  it('默认关闭时跳过所有子任务', async () => {
    const executor: SubAgentExecutor = {
      execute: vi.fn(),
    };
    const orchestrator = new SubAgentOrchestrator(executor);

    const result = await orchestrator.run(makePlan());

    expect(result.status).toBe('disabled');
    expect(result.results).toHaveLength(2);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('存在 Write Intent 冲突时阻止执行', async () => {
    const executor: SubAgentExecutor = {
      execute: vi.fn(),
    };
    const orchestrator = new SubAgentOrchestrator(executor, { enabled: true });

    const result = await orchestrator.run(makePlan({
      tasks: [
        {
          id: 'a',
          title: 'A',
          prompt: 'A',
          writeIntent: ['src'],
        },
        {
          id: 'b',
          title: 'B',
          prompt: 'B',
          writeIntent: ['src/file.ts'],
        },
      ],
    }));

    expect(result.status).toBe('blocked_conflicts');
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('存在读写锁冲突时阻止并发执行', async () => {
    const executor: SubAgentExecutor = {
      execute: vi.fn(),
    };
    const orchestrator = new SubAgentOrchestrator(executor, { enabled: true });

    const result = await orchestrator.run(makePlan({
      tasks: [
        {
          id: 'reader',
          title: 'Reader',
          prompt: 'Read shared state',
          readIntent: ['src/shared.ts'],
          writeIntent: [],
        },
        {
          id: 'writer',
          title: 'Writer',
          prompt: 'Write shared state',
          writeIntent: ['src/shared.ts'],
        },
      ],
    }));

    expect(result.status).toBe('blocked_conflicts');
    expect(result.conflicts[0]).toMatchObject({ kind: 'read-write', path: 'src/shared.ts' });
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('遵守 maxConcurrency 限制', async () => {
    let active = 0;
    let maxActive = 0;
    const executor: SubAgentExecutor = {
      execute: async (task) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
        return {
          status: 'success',
          summary: task.title,
          writtenFiles: task.writeIntent,
        };
      },
    };
    const orchestrator = new SubAgentOrchestrator(executor, {
      enabled: true,
      maxConcurrency: 1,
    });

    const result = await orchestrator.run(makePlan());

    expect(result.status).toBe('completed');
    expect(maxActive).toBe(1);
    expect(result.merge?.status).toBe('merged');
  });

  it('运行时未声明写入触发 state_conflict 并回滚该子任务', async () => {
    const rollbackTask = vi.fn().mockResolvedValue(undefined);
    const executor: SubAgentExecutor = {
      execute: async () => ({
        status: 'success',
        summary: 'done',
        writtenFiles: ['unexpected.ts'],
      }),
    };
    const orchestrator = new SubAgentOrchestrator(executor, {
      enabled: true,
      rollbackTask,
    });

    const result = await orchestrator.run(makePlan({
      tasks: [
        {
          id: 'a',
          title: 'A',
          prompt: 'A',
          writeIntent: ['expected.ts'],
        },
      ],
    }));

    expect(result.status).toBe('completed_with_errors');
    expect(result.results[0].status).toBe('state_conflict');
    expect(result.results[0].error).toContain('未声明路径');
    expect(rollbackTask).toHaveBeenCalledOnce();
  });

  it('运行时多个子任务写入同一文件时双方都标记 state_conflict', async () => {
    const executor: SubAgentExecutor = {
      execute: async (task) => ({
        status: 'success',
        summary: 'done',
        writtenFiles: task.id === 'a' ? ['shared.ts'] : ['shared.ts'],
      }),
    };
    const orchestrator = new SubAgentOrchestrator(executor, { enabled: true });

    const result = await orchestrator.run(makePlan({
      tasks: [
        {
          id: 'a',
          title: 'A',
          prompt: 'A',
          writeIntent: [],
        },
        {
          id: 'b',
          title: 'B',
          prompt: 'B',
          writeIntent: [],
        },
      ],
    }));

    expect(result.status).toBe('completed_with_errors');
    expect(result.results.map((item) => item.status)).toEqual(['state_conflict', 'state_conflict']);
  });
});
