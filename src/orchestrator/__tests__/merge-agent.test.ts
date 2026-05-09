import { describe, it, expect } from 'vitest';
import { MergeAgent } from '../merge-agent.js';

describe('MergeAgent', () => {
  it('汇总子代理结果', () => {
    const summary = new MergeAgent().summarize([
      {
        taskId: 'a',
        status: 'success',
        summary: 'done',
        writtenFiles: [],
      },
      {
        taskId: 'b',
        status: 'failed',
        summary: 'failed',
        writtenFiles: [],
      },
    ]);

    expect(summary.successful).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.summaries).toEqual(['a: done', 'b: failed']);
  });

  it('作为同步器发现运行时写入冲突并阻止合并', () => {
    const merge = new MergeAgent().synchronize({
      tasks: [
        { id: 'a', title: 'A', prompt: 'A', writeIntent: [] },
        { id: 'b', title: 'B', prompt: 'B', writeIntent: [] },
      ],
      results: [
        { taskId: 'a', status: 'success', summary: 'a', writtenFiles: ['shared.ts'], patch: 'patch-a' },
        { taskId: 'b', status: 'success', summary: 'b', writtenFiles: ['shared.ts'], patch: 'patch-b' },
      ],
    });

    expect(merge.status).toBe('blocked');
    expect(merge.conflicts[0]).toMatchObject({ path: 'shared.ts', kind: 'write-write' });
  });
});
