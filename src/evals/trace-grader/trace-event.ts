export interface NormalizedTraceEvent {
  type: string;
  toolName?: string;
  command?: string;
  filePath?: string;
  content?: string;
  message?: string;
  raw: unknown;
}

export function normalizeTraceEvent(raw: unknown): NormalizedTraceEvent {
  return {
    type: readString(raw, ['type', 'event', 'kind', 'name']) ?? '',
    toolName: readString(raw, [
      'toolName',
      'tool_name',
      'tool',
      'data.toolName',
      'payload.toolName',
    ]),
    command: readString(raw, [
      'command',
      'cmd',
      'args.command',
      'input.command',
      'payload.command',
    ]),
    filePath: readString(raw, [
      'filePath',
      'path',
      'args.path',
      'input.path',
      'payload.path',
    ]),
    content: readString(raw, [
      'content',
      'payload.content',
    ]),
    message: readString(raw, [
      'message',
      'text',
      'output',
      'payload.message',
    ]),
    raw,
  };
}

function readString(raw: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = readPath(raw, path);
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function readPath(raw: unknown, path: string): unknown {
  let current: unknown = raw;
  for (const key of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
