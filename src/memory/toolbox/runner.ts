import { pathToFileURL } from 'node:url';
import { stat } from 'node:fs/promises';
import type { RunToolResult, ToolboxModule } from './types.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_CHARS = 8_000;
const TRUNCATION_NOTE = '\n\n[truncated: output exceeded maxChars]';

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function serializeResult(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function applyTruncation(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, maxChars) + TRUNCATION_NOTE,
    truncated: true,
  };
}

/** Dynamic import with mtime cache-buster so updates take effect immediately. */
export async function importToolboxModule(filePath: string): Promise<unknown> {
  const mtime = (await stat(filePath)).mtimeMs;
  const url = `${pathToFileURL(filePath).href}?v=${mtime}`;
  return import(url);
}

export function getDefaultExport(mod: unknown): unknown {
  if (mod && typeof mod === 'object' && 'default' in mod) {
    return (mod as { default: unknown }).default;
  }
  return undefined;
}

export function validateToolboxModule(exported: unknown, expectedName?: string): ToolboxModule {
  if (!exported || typeof exported !== 'object') {
    throw new Error('Tool default export must be an object');
  }
  const tool = exported as Partial<ToolboxModule>;
  if (typeof tool.name !== 'string' || tool.name.length === 0) {
    throw new Error('Tool default export must include a non-empty name');
  }
  if (typeof tool.run !== 'function') {
    throw new Error('Tool default export must include a run function');
  }
  if (expectedName !== undefined && tool.name !== expectedName) {
    throw new Error(
      `Tool name mismatch: filename stem is "${expectedName}" but export default.name is "${tool.name}"`,
    );
  }
  return tool as ToolboxModule;
}

export async function runToolboxTool(options: {
  filePath: string;
  args?: Record<string, unknown>;
  timeoutMs?: number;
  maxChars?: number;
}): Promise<RunToolResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const args = options.args ?? {};

  let tool: ToolboxModule;
  try {
    const mod = await importToolboxModule(options.filePath);
    tool = validateToolboxModule(getDefaultExport(mod));
  } catch (err) {
    const msg = errorMessage(err);
    return { text: msg, error: msg, truncated: false, timedOut: false };
  }

  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      reject(new Error(`Tool timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const value = await Promise.race([
      Promise.resolve().then(() => tool.run(args)),
      timeoutPromise,
    ]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    const serialized = serializeResult(value);
    const { text, truncated } = applyTruncation(serialized, maxChars);
    return { text, truncated, timedOut: false };
  } catch (err) {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    const msg = errorMessage(err);
    if (timedOut) {
      return { text: msg, error: msg, truncated: false, timedOut: true };
    }
    return { text: msg, error: msg, truncated: false, timedOut: false };
  }
}
