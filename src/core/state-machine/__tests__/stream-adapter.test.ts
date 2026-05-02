import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamAdapter } from '../stream-adapter.js';
import type { MachineEvent } from '../types.js';
import type { AssistantMessageEvent } from '@mariozechner/pi-ai';

function createMockStream(events: AssistantMessageEvent[]): AsyncIterable<AssistantMessageEvent> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index < events.length) {
            return { value: events[index++], done: false };
          }
          return { value: undefined as never, done: true };
        },
      };
    },
  };
}

function makeDoneEvent(): AssistantMessageEvent {
  return {
    type: 'done',
    reason: 'stop',
    message: {
      role: 'assistant',
      content: [],
      stopReason: 'stop',
      usage: { input: 0, output: 0 },
    },
  };
}

function makeToolcallEndEvent(id: string, name: string): AssistantMessageEvent {
  return {
    type: 'toolcall_end',
    contentIndex: 0,
    toolCall: {
      type: 'toolCall',
      id,
      name,
      arguments: { key: 'value' },
    },
    partial: {
      role: 'assistant',
      content: [],
      stopReason: 'toolUse',
      usage: { input: 0, output: 0 },
    },
  };
}

describe('StreamAdapter', () => {
  let sentEvents: MachineEvent[];
  let adapter: StreamAdapter;

  beforeEach(() => {
    sentEvents = [];
    adapter = new StreamAdapter((event) => sentEvents.push(event));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends EXECUTION_ROUND_COMPLETE with buffered tool calls on done', async () => {
    const stream = createMockStream([
      makeToolcallEndEvent('tc1', 'read_file'),
      makeToolcallEndEvent('tc2', 'write_file'),
      makeDoneEvent(),
    ]);

    await adapter.attachToStream(stream as never);

    expect(sentEvents).toHaveLength(1);
    const event = sentEvents[0];
    expect(event.type).toBe('EXECUTION_ROUND_COMPLETE');
    if (event.type === 'EXECUTION_ROUND_COMPLETE') {
      expect(event.toolCalls).toHaveLength(2);
      expect(event.toolCalls[0]).toMatchObject({ id: 'tc1', name: 'read_file' });
      expect(event.toolCalls[1]).toMatchObject({ id: 'tc2', name: 'write_file' });
      expect(event.timestamp).toBeGreaterThan(0);
    }
  });

  it('sends EXECUTION_ROUND_COMPLETE with empty tool calls when no tool calls in round', async () => {
    const stream = createMockStream([makeDoneEvent()]);

    await adapter.attachToStream(stream as never);

    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0].type).toBe('EXECUTION_ROUND_COMPLETE');
    if (sentEvents[0].type === 'EXECUTION_ROUND_COMPLETE') {
      expect(sentEvents[0].toolCalls).toHaveLength(0);
    }
  });

  it('does not send any event after 120s timeout', async () => {
    vi.useFakeTimers();

    // Stream whose next() resolves only after 200s — past the 120s timeout
    const slowStream: AsyncIterable<AssistantMessageEvent> = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<AssistantMessageEvent>> {
            return new Promise((resolve) =>
              setTimeout(() => resolve({ value: makeDoneEvent(), done: false }), 200_000),
            );
          },
        };
      },
    };

    const attachPromise = adapter.attachToStream(slowStream as never);

    // Advance past the 120s timeout — fires our timer, not the stream's 200s timer
    await vi.advanceTimersByTimeAsync(120_001);
    await attachPromise;

    expect(sentEvents).toHaveLength(0);
  });

  it('does not send event when stream throws an error', async () => {
    const errorStream: AsyncIterable<AssistantMessageEvent> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<AssistantMessageEvent>> {
            throw new Error('Network error');
          },
        };
      },
    };

    await adapter.attachToStream(errorStream as never);

    expect(sentEvents).toHaveLength(0);
  });

  it('can be reused for multiple rounds', async () => {
    const stream1 = createMockStream([makeToolcallEndEvent('tc1', 'tool_a'), makeDoneEvent()]);
    const stream2 = createMockStream([makeToolcallEndEvent('tc2', 'tool_b'), makeDoneEvent()]);

    await adapter.attachToStream(stream1 as never);
    await adapter.attachToStream(stream2 as never);

    expect(sentEvents).toHaveLength(2);
    if (sentEvents[0].type === 'EXECUTION_ROUND_COMPLETE') {
      expect(sentEvents[0].toolCalls[0].name).toBe('tool_a');
    }
    if (sentEvents[1].type === 'EXECUTION_ROUND_COMPLETE') {
      expect(sentEvents[1].toolCalls[0].name).toBe('tool_b');
    }
  });
});
