import { describe, expect, it, vi } from 'vitest';
import { createInputQueue } from '../input-queue.js';

describe('createInputQueue', () => {
  it('等待中提交会立即唤醒，不标记为已显示', async () => {
    const onQueued = vi.fn();
    const queue = createInputQueue(onQueued);
    const pending = queue.waitForSubmit();

    expect(queue.enqueueSubmit('下一步')).toBe(true);

    await expect(pending).resolves.toEqual({
      value: '下一步',
      alreadyDisplayed: false,
    });
    expect(onQueued).not.toHaveBeenCalled();
  });

  it('运行中提交会 FIFO 排队并触发显示回调', async () => {
    const onQueued = vi.fn();
    const queue = createInputQueue(onQueued);

    expect(queue.pendingCount()).toBe(0);
    expect(queue.enqueueSubmit('第一条')).toBe(true);
    expect(queue.pendingCount()).toBe(1);
    expect(queue.enqueueSubmit('第二条')).toBe(true);
    expect(queue.pendingCount()).toBe(2);

    await expect(queue.waitForSubmit()).resolves.toEqual({
      value: '第一条',
      alreadyDisplayed: true,
    });
    expect(queue.pendingCount()).toBe(1);
    await expect(queue.waitForSubmit()).resolves.toEqual({
      value: '第二条',
      alreadyDisplayed: true,
    });
    expect(queue.pendingCount()).toBe(0);
    expect(onQueued).toHaveBeenNthCalledWith(1, '第一条');
    expect(onQueued).toHaveBeenNthCalledWith(2, '第二条');
  });

  it('空输入不入队也不显示', () => {
    const onQueued = vi.fn();
    const queue = createInputQueue(onQueued);

    expect(queue.enqueueSubmit('   ')).toBe(false);
    expect(onQueued).not.toHaveBeenCalled();
  });
});
