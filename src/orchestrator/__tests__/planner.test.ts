import { describe, it, expect } from 'vitest';
import { Planner, detectWriteIntentConflicts, normalizeWritePath } from '../planner.js';

describe('Planner', () => {
  it('detectWriteIntentConflicts 检测文件和目录重叠', () => {
    const conflicts = detectWriteIntentConflicts([
      {
        id: 'a',
        title: 'A',
        prompt: 'A',
        writeIntent: ['src/core'],
      },
      {
        id: 'b',
        title: 'B',
        prompt: 'B',
        writeIntent: ['./src/core/file.ts'],
      },
    ]);

    expect(conflicts).toEqual([
      {
        firstTaskId: 'a',
        secondTaskId: 'b',
        path: 'src/core',
      },
    ]);
  });

  it('normalizeWritePath 标准化路径格式', () => {
    expect(normalizeWritePath('.\\src//core/')).toBe('src/core');
  });

  it('Planner 使用注入 generator 并附带冲突结果', async () => {
    const planner = new Planner({
      generate: async () => [
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
    });

    const plan = await planner.plan('do work');

    expect(plan.originalTask).toBe('do work');
    expect(plan.tasks).toHaveLength(2);
    expect(plan.conflicts).toHaveLength(0);
  });
});
