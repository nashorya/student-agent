import type { AssistantMessageEventStream, AssistantMessageEvent } from '@mariozechner/pi-ai';
import type { MachineEvent, ToolCall } from './types.js';

export class StreamAdapter {
  private buffer: ToolCall[] = [];
  private roundTimer: ReturnType<typeof setTimeout> | null = null;
  private isTimedOut = false;

  constructor(private readonly xstateSend: (event: MachineEvent) => void) {}

  async attachToStream(stream: AssistantMessageEventStream): Promise<void> {
    this.isTimedOut = false;
    this.buffer = [];

    // Timeout promise races against each stream event. When it resolves, we stop.
    let resolveTimeout!: () => void;
    const timeoutPromise = new Promise<void>((resolve) => {
      resolveTimeout = resolve;
      this.roundTimer = setTimeout(() => {
        this.isTimedOut = true;
        resolve();
      }, 120_000);
    });

    const iterator = stream[Symbol.asyncIterator]();

    try {
      while (true) {
        const raced = await Promise.race([
          iterator.next().then((r) => ({ kind: 'value' as const, result: r })),
          timeoutPromise.then(() => ({ kind: 'timeout' as const })),
        ]);

        if (raced.kind === 'timeout' || raced.result.done) break;

        const event: AssistantMessageEvent = raced.result.value;

        if (event.type === 'toolcall_end') {
          this.buffer.push({
            id: event.toolCall.id,
            name: event.toolCall.name,
            input: event.toolCall.arguments as Record<string, unknown>,
          });
        } else if (event.type === 'done' || event.type === 'error') {
          this.onRoundComplete();
          break;
        }
      }
    } catch {
      // Stream interrupted — discard buffer, do not send event to XState
    } finally {
      this.clearTimer();
      // Resolve timeout promise to avoid dangling callbacks if we exited normally
      resolveTimeout();
    }
  }

  private onRoundComplete(): void {
    if (this.isTimedOut) return;

    this.clearTimer();
    this.xstateSend({
      type: 'EXECUTION_ROUND_COMPLETE',
      toolCalls: [...this.buffer],
      timestamp: Date.now(),
    });
    this.buffer = [];
  }

  private clearTimer(): void {
    if (this.roundTimer !== null) {
      clearTimeout(this.roundTimer);
      this.roundTimer = null;
    }
  }
}
