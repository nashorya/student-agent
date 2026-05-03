import { describe, it, expect, beforeEach } from 'vitest';
import { WriteQueue } from '../write-queue.js';

describe('WriteQueue', () => {
  beforeEach(() => {
    WriteQueue.resetInstance();
  });

  it('getInstance 返回同一实例（单例）', () => {
    const a = WriteQueue.getInstance();
    const b = WriteQueue.getInstance();
    expect(a).toBe(b);
  });

  it('resetInstance 后返回新实例', () => {
    const a = WriteQueue.getInstance();
    WriteQueue.resetInstance();
    const b = WriteQueue.getInstance();
    expect(a).not.toBe(b);
  });

  it('enqueue 的任务严格串行执行', async () => {
    const queue = WriteQueue.getInstance();
    const order: number[] = [];

    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    // 任务 1：耗时 50ms
    const p1 = queue.enqueue(async () => {
      order.push(1);
      await delay(50);
      order.push(2);
    });

    // 任务 2：立即提交，但必须等任务 1 完成
    const p2 = queue.enqueue(async () => {
      order.push(3);
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('enqueue 正确传递返回值', async () => {
    const queue = WriteQueue.getInstance();
    const result = await queue.enqueue(async () => 42);
    expect(result).toBe(42);
  });

  it('单个任务失败不阻塞后续任务', async () => {
    const queue = WriteQueue.getInstance();
    const results: string[] = [];

    // 任务 1：成功
    await queue.enqueue(async () => {
      results.push('task1-ok');
    });

    // 任务 2：失败
    const p2 = queue.enqueue(async () => {
      throw new Error('task2 boom');
    });
    await expect(p2).rejects.toThrow('task2 boom');

    // 任务 3：仍能执行
    await queue.enqueue(async () => {
      results.push('task3-ok');
    });

    expect(results).toEqual(['task1-ok', 'task3-ok']);
  });

  it('pending 和 size 正确反映队列状态', async () => {
    const queue = WriteQueue.getInstance();

    // 空队列
    expect(queue.pending).toBe(0);
    expect(queue.size).toBe(0);

    let resolve1: (() => void) | undefined;
    const blocker = new Promise<void>((r) => { resolve1 = r; });

    // 任务 1：阻塞中
    const p1 = queue.enqueue(() => blocker);
    // 任务 2：排队中
    const p2 = queue.enqueue(async () => 'done');

    // 需要一个 microtask 让 p-queue 内部调度完成
    await new Promise<void>((r) => setTimeout(r, 10));

    expect(queue.pending).toBe(1); // 任务 1 正在执行
    expect(queue.size).toBe(1);    // 任务 2 在等待

    resolve1!();
    await Promise.all([p1, p2]);

    expect(queue.pending).toBe(0);
    expect(queue.size).toBe(0);
  });

  it('onIdle 在队列清空后 resolve', async () => {
    const queue = WriteQueue.getInstance();
    let done = false;

    queue.enqueue(async () => {
      await new Promise<void>((r) => setTimeout(r, 30));
      done = true;
    });

    await queue.onIdle();
    expect(done).toBe(true);
  });

  it('多个并发 enqueue 全部串行完成', async () => {
    const queue = WriteQueue.getInstance();
    const timestamps: number[] = [];

    const tasks = Array.from({ length: 5 }, (_, i) =>
      queue.enqueue(async () => {
        timestamps.push(Date.now());
        await new Promise<void>((r) => setTimeout(r, 10));
        return i;
      }),
    );

    const results = await Promise.all(tasks);
    expect(results).toEqual([0, 1, 2, 3, 4]);

    // 每个任务的开始时间应该递增（串行）
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });
});
