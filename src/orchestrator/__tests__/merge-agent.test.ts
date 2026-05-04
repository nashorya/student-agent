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
});
