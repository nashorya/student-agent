export interface QueuedInput {
  value: string;
  alreadyDisplayed: boolean;
}

export interface InputQueue {
  waitForSubmit: () => Promise<QueuedInput>;
  enqueueSubmit: (value: string) => boolean;
  /** 当前排队等待处理的消息数量 */
  pendingCount: () => number;
}

export function createInputQueue(onQueued?: (value: string) => void): InputQueue {
  let resolveSubmit: ((value: QueuedInput) => void) | null = null;
  const pendingInputs: QueuedInput[] = [];

  return {
    waitForSubmit() {
      const queued = pendingInputs.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve) => {
        resolveSubmit = resolve;
      });
    },

    enqueueSubmit(value) {
      if (!value.trim()) return false;

      const activeResolve = resolveSubmit;
      if (activeResolve) {
        resolveSubmit = null;
        activeResolve({ value, alreadyDisplayed: false });
        return true;
      }

      pendingInputs.push({ value, alreadyDisplayed: true });
      onQueued?.(value);
      return true;
    },

    pendingCount() {
      return pendingInputs.length;
    },
  };
}
