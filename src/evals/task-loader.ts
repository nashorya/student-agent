import { access, readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { EvalMode, EvalTaskDefinition } from './types.js';

const DEFAULT_TIMEOUT_SECONDS = 300;

interface RawTaskToml {
  id?: unknown;
  title?: unknown;
  mode?: unknown;
  tags?: unknown;
  timeout_seconds?: unknown;
  expected_files?: unknown;
}

export async function loadEvalTasks(tasksRoot = resolve(process.cwd(), 'evals/tasks')): Promise<EvalTaskDefinition[]> {
  const entries = await readdir(tasksRoot, { withFileTypes: true });
  const taskDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(tasksRoot, entry.name))
    .sort();

  const tasks = await Promise.all(taskDirs.map(loadEvalTask));
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) {
      throw new Error(`Duplicate eval task id: ${task.id}`);
    }
    ids.add(task.id);
  }
  return tasks;
}

export async function loadEvalTask(taskDir: string): Promise<EvalTaskDefinition> {
  const instructionPath = join(taskDir, 'instruction.md');
  const tomlPath = join(taskDir, 'task.toml');
  const environmentDir = join(taskDir, 'environment');
  const testScriptPath = join(taskDir, 'tests/test.sh');
  const solutionScriptPath = join(taskDir, 'solution/solve.sh');

  const [instruction, rawToml] = await Promise.all([
    readFile(instructionPath, 'utf8'),
    readFile(tomlPath, 'utf8'),
  ]);
  if (!instruction.trim()) {
    throw new Error(`${instructionPath} must not be empty`);
  }

  await assertDirectory(environmentDir);
  await assertFile(testScriptPath);
  const hasSolution = await fileExists(solutionScriptPath);
  const parsed = parseTaskToml(rawToml);
  return normalizeTask(taskDir, parsed, {
    instructionPath,
    environmentDir,
    testScriptPath,
    solutionScriptPath: hasSolution ? solutionScriptPath : undefined,
  });
}

export function parseTaskToml(raw: string): RawTaskToml {
  const result: Record<string, unknown> = {};
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;
    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!match) {
      throw new Error(`Unsupported task.toml line: ${rawLine}`);
    }
    result[match[1]] = parseTomlValue(match[2].trim());
  }
  return result;
}

function normalizeTask(
  taskDir: string,
  raw: RawTaskToml,
  paths: Pick<EvalTaskDefinition, 'instructionPath' | 'environmentDir' | 'testScriptPath' | 'solutionScriptPath'>,
): EvalTaskDefinition {
  const id = requireString(raw.id, 'id');
  const title = requireString(raw.title, 'title');
  const mode = normalizeMode(raw.mode);
  const timeoutSeconds = normalizePositiveInteger(raw.timeout_seconds, DEFAULT_TIMEOUT_SECONDS, 'timeout_seconds');
  const tags = normalizeStringArray(raw.tags, 'tags');
  const expectedFiles = normalizeStringArray(raw.expected_files, 'expected_files');

  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(id)) {
    throw new Error(`Invalid eval task id "${id}". Use lowercase letters, numbers, _ or -.`);
  }
  return {
    id,
    title,
    mode,
    tags,
    timeoutSeconds,
    expectedFiles,
    taskDir,
    ...paths,
  };
}

function parseTomlValue(value: string): unknown {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    const body = value.slice(1, -1).trim();
    if (!body) return [];
    return splitTomlArray(body).map((item) => parseTomlValue(item.trim()));
  }
  if (/^\d+$/u.test(value)) {
    return Number.parseInt(value, 10);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Unsupported task.toml value: ${value}`);
}

function splitTomlArray(body: string): string[] {
  const values: string[] = [];
  let current = '';
  let inString = false;
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char === '"' && body[index - 1] !== '\\') {
      inString = !inString;
    }
    if (char === ',' && !inString) {
      values.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) values.push(current);
  return values;
}

function stripTomlComment(line: string): string {
  let inString = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"' && line[index - 1] !== '\\') {
      inString = !inString;
    }
    if (char === '#' && !inString) {
      return line.slice(0, index);
    }
  }
  return line;
}

function requireString(value: unknown, key: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`task.toml field "${key}" must be a non-empty string`);
  }
  return value;
}

function normalizeMode(value: unknown): EvalMode {
  const mode = value ?? 'direct';
  if (mode === 'direct' || mode === 'task') return mode;
  throw new Error('task.toml field "mode" must be "direct" or "task"');
}

function normalizeStringArray(value: unknown, key: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`task.toml field "${key}" must be an array of strings`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function normalizePositiveInteger(value: unknown, fallback: number, key: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`task.toml field "${key}" must be a positive integer`);
  }
  return value;
}

async function assertFile(path: string): Promise<void> {
  const info = await stat(path);
  if (!info.isFile()) {
    throw new Error(`${path} must be a file`);
  }
}

async function assertDirectory(path: string): Promise<void> {
  const info = await stat(path);
  if (!info.isDirectory()) {
    throw new Error(`${path} must be a directory`);
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
