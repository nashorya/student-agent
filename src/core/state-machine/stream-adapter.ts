import type { AssistantMessageEventStream, AssistantMessageEvent } from '@mariozechner/pi-ai';
import type { MachineEvent, ToolCall } from './types.js';

export class StreamAdapter {
  private buffer: ToolCall[] = [];

  constructor(
    private readonly xstateSend: (event: MachineEvent) => void,
    private readonly signal?: AbortSignal,
  ) {}

  async attachToStream(stream: AssistantMessageEventStream): Promise<void> {
    this.buffer = [];

    const iterator = stream[Symbol.asyncIterator]();

    try {
      while (true) {
        const raced = await this.nextOrAbort(iterator);

        if (raced.kind === 'abort') {
          this.buffer = [];
          void Promise.resolve(iterator.return?.()).catch(() => undefined);
          break;
        }

        if (raced.result.done) break;

        const event: AssistantMessageEvent = raced.result.value;

        if (event.type === 'toolcall_end') {
          this.buffer.push({
            id: event.toolCall.id,
            name: event.toolCall.name,
            input: event.toolCall.arguments as Record<string, unknown>,
          });
        } else if (event.type === 'done') {
          this.onRoundComplete();
          break;
        } else if (event.type === 'error') {
          this.buffer = [];
          break;
        }
      }
    } catch {
      // Stream interrupted — discard buffer, do not send event to XState
      this.buffer = [];
    }
  }

  private onRoundComplete(): void {
    this.xstateSend({
      type: 'EXECUTION_ROUND_COMPLETE',
      toolCalls: [...this.buffer],
      timestamp: Date.now(),
    });
    this.buffer = [];
  }

  private nextOrAbort(
    iterator: AsyncIterator<AssistantMessageEvent>,
  ): Promise<
    | { kind: 'value'; result: IteratorResult<AssistantMessageEvent> }
    | { kind: 'abort' }
  > {
    if (!this.signal) {
      return iterator.next().then((result) => ({ kind: 'value', result }));
    }
    if (this.signal.aborted) {
      return Promise.resolve({ kind: 'abort' });
    }

    return new Promise((resolve, reject) => {
      const onAbort = () => resolve({ kind: 'abort' });
      this.signal?.addEventListener('abort', onAbort, { once: true });
      iterator.next().then(
        (result) => {
          this.signal?.removeEventListener('abort', onAbort);
          resolve({ kind: 'value', result });
        },
        (err: unknown) => {
          this.signal?.removeEventListener('abort', onAbort);
          reject(err);
        },
      );
    });
  }
}
