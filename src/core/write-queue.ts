import PQueue from 'p-queue';

/**
 * 进程级单例写入队列。
 * 所有 memory/ 文件和 SQLite 的写操作必须通过此队列串行执行，
 * 防止并发写入导致的锁竞争和数据损坏。
 *
 * 读操作不受限制，可并发。
 */
export class WriteQueue {
  private static instance: WriteQueue | null = null;
  private readonly queue: PQueue;

  private constructor() {
    this.queue = new PQueue({ concurrency: 1 });
  }

  static getInstance(): WriteQueue {
    if (!WriteQueue.instance) {
      WriteQueue.instance = new WriteQueue();
    }
    return WriteQueue.instance;
  }

  /** 仅测试用：重置单例 */
  static resetInstance(): void {
    WriteQueue.instance = null;
  }

  /**
   * 将一个写操作提交到队列中串行执行。
   * 返回一个 Promise，在该操作执行完毕后 resolve（或 reject）。
   * 单个任务失败不会阻塞后续任务。
   */
  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return this.queue.add(fn) as Promise<T>;
  }

  /** 当前等待执行的任务数 */
  get pending(): number {
    return this.queue.pending;
  }

  /** 当前队列中的总任务数（等待 + 正在执行） */
  get size(): number {
    return this.queue.size;
  }

  /** 等待队列清空（所有任务执行完毕） */
  async onIdle(): Promise<void> {
    return this.queue.onIdle();
  }
}
