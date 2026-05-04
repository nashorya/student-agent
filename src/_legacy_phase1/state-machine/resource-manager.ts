import type { AssistantMessageEventStream } from '@mariozechner/pi-ai';

class ResourceManager {
  private streams = new Map<string, AssistantMessageEventStream>();
  private abortControllers = new Map<string, AbortController>();

  registerStream(id: string, stream: AssistantMessageEventStream): void {
    this.streams.set(id, stream);
  }

  getStream(id: string): AssistantMessageEventStream | undefined {
    return this.streams.get(id);
  }

  closeStream(id: string): void {
    this.streams.delete(id);
  }

  createAbortController(id: string): AbortController {
    const controller = new AbortController();
    this.abortControllers.set(id, controller);
    return controller;
  }

  getAbortController(id: string): AbortController | undefined {
    return this.abortControllers.get(id);
  }

  getAbortSignal(id: string): AbortSignal | undefined {
    return this.abortControllers.get(id)?.signal;
  }

  abort(id: string): void {
    this.abortControllers.get(id)?.abort();
  }

  async cleanup(): Promise<void> {
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.streams.clear();
    this.abortControllers.clear();
  }

  reset(): void {
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.streams.clear();
    this.abortControllers.clear();
  }
}

export const resourceManager = new ResourceManager();
