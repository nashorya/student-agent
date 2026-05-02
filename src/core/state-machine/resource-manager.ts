import type { AssistantMessageEventStream } from '@mariozechner/pi-ai';

class ResourceManager {
  private streams = new Map<string, AssistantMessageEventStream>();

  registerStream(id: string, stream: AssistantMessageEventStream): void {
    this.streams.set(id, stream);
  }

  getStream(id: string): AssistantMessageEventStream | undefined {
    return this.streams.get(id);
  }

  closeStream(id: string): void {
    this.streams.delete(id);
  }

  async cleanup(): Promise<void> {
    this.streams.clear();
  }

  reset(): void {
    this.streams.clear();
  }
}

export const resourceManager = new ResourceManager();
