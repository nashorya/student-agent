import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface LoadEnvFileOptions {
  cwd?: string;
  filename?: string;
  override?: boolean;
}

export interface LoadedEnvFile {
  path: string;
  keys: string[];
}

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export async function loadEnvFile(options: LoadEnvFileOptions = {}): Promise<LoadedEnvFile | null> {
  const cwd = options.cwd ?? process.cwd();
  const filename = options.filename ?? '.env';
  const path = join(cwd, filename);

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (isFileMissingError(err)) {
      return null;
    }
    throw err;
  }

  const parsed = parseEnvFile(raw);
  const keys: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (!options.override && process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = value;
    keys.push(key);
  }

  return { path, keys };
}

export function parseEnvFile(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    result[parsed.key] = parsed.value;
  }
  return result;
}

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const normalized = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trimStart() : trimmed;
  const equalsIndex = normalized.indexOf('=');
  if (equalsIndex <= 0) {
    return null;
  }

  const key = normalized.slice(0, equalsIndex).trim();
  if (!ENV_KEY_PATTERN.test(key)) {
    return null;
  }

  const rawValue = normalized.slice(equalsIndex + 1).trim();
  return { key, value: parseEnvValue(rawValue) };
}

function parseEnvValue(value: string): string {
  if (value.length < 2) {
    return value;
  }

  const quote = value[0];
  if (quote !== '"' && quote !== "'") {
    return stripInlineComment(value);
  }

  const closingIndex = findClosingQuote(value, quote);
  if (closingIndex === -1) {
    return stripInlineComment(value);
  }

  const inner = value.slice(1, closingIndex);
  if (quote === "'") {
    return inner;
  }

  return inner
    .replaceAll('\\n', '\n')
    .replaceAll('\\r', '\r')
    .replaceAll('\\t', '\t')
    .replaceAll('\\"', '"')
    .replaceAll('\\\\', '\\');
}

function findClosingQuote(value: string, quote: string): number {
  for (let i = 1; i < value.length; i++) {
    if (value[i] !== quote) {
      continue;
    }
    if (quote === '"' && value[i - 1] === '\\') {
      continue;
    }
    return i;
  }
  return -1;
}

function stripInlineComment(value: string): string {
  const commentIndex = value.search(/\s#/);
  if (commentIndex === -1) {
    return value;
  }
  return value.slice(0, commentIndex).trimEnd();
}

function isFileMissingError(err: unknown): boolean {
  return (
    typeof err === 'object'
    && err !== null
    && 'code' in err
    && (err as { code?: unknown }).code === 'ENOENT'
  );
}
