import type { RunToolResult } from './types.js';

export async function runToolboxTool(_options: {
  filePath: string;
  args?: Record<string, unknown>;
  timeoutMs?: number;
  maxChars?: number;
}): Promise<RunToolResult> {
  throw new Error('runToolboxTool not implemented');
}
