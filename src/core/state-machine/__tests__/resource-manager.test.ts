import { describe, it, expect, beforeEach } from 'vitest';
import { resourceManager } from '../resource-manager.js';
import type { AssistantMessageEventStream } from '@mariozechner/pi-ai';

function makeFakeStream(): AssistantMessageEventStream {
  return {} as AssistantMessageEventStream;
}

describe('ResourceManager', () => {
  beforeEach(() => {
    resourceManager.reset();
  });

  it('registers and retrieves a stream', () => {
    const stream = makeFakeStream();
    resourceManager.registerStream('s1', stream);
    expect(resourceManager.getStream('s1')).toBe(stream);
  });

  it('returns undefined for unknown stream id', () => {
    expect(resourceManager.getStream('nonexistent')).toBeUndefined();
  });

  it('removes stream on closeStream', () => {
    const stream = makeFakeStream();
    resourceManager.registerStream('s1', stream);
    resourceManager.closeStream('s1');
    expect(resourceManager.getStream('s1')).toBeUndefined();
  });

  it('clears all streams on cleanup', async () => {
    resourceManager.registerStream('s1', makeFakeStream());
    resourceManager.registerStream('s2', makeFakeStream());
    await resourceManager.cleanup();
    expect(resourceManager.getStream('s1')).toBeUndefined();
    expect(resourceManager.getStream('s2')).toBeUndefined();
  });

  it('reset clears state for test isolation', () => {
    resourceManager.registerStream('s1', makeFakeStream());
    resourceManager.createAbortController('task1');
    resourceManager.reset();
    expect(resourceManager.getStream('s1')).toBeUndefined();
    expect(resourceManager.getAbortController('task1')).toBeUndefined();
  });

  it('creates and aborts task abort controllers', () => {
    const controller = resourceManager.createAbortController('task1');
    expect(resourceManager.getAbortController('task1')).toBe(controller);
    expect(resourceManager.getAbortSignal('task1')?.aborted).toBe(false);
    resourceManager.abort('task1');
    expect(resourceManager.getAbortSignal('task1')?.aborted).toBe(true);
  });
});
