import {
  createBashToolDefinition,
  createLocalBashOperations,
  defineTool,
  type BashOperations,
  type BashToolOptions,
} from '@mariozechner/pi-coding-agent';

export const DEFAULT_BASH_TIMEOUT_SECONDS = 120;

export interface StudentBashToolOptions extends Omit<BashToolOptions, 'operations'> {
  defaultTimeoutSeconds?: number;
  operations?: BashOperations;
}

export function createStudentBashToolDefinition(
  cwd: string,
  options: StudentBashToolOptions = {},
): ReturnType<typeof createBashToolDefinition> {
  const defaultTimeoutSeconds = options.defaultTimeoutSeconds ?? DEFAULT_BASH_TIMEOUT_SECONDS;
  const operations = withDefaultBashTimeout(
    options.operations ?? createLocalBashOperations({ shellPath: options.shellPath }),
    defaultTimeoutSeconds,
  );
  const definition = createBashToolDefinition(cwd, {
    ...options,
    operations,
  });

  return defineTool({
    name: definition.name,
    label: definition.label,
    description: [
      definition.description,
      `Student Agent applies a default timeout of ${defaultTimeoutSeconds} seconds when timeout is omitted.`,
    ].join(' '),
    promptSnippet: definition.promptSnippet,
    promptGuidelines: [
      ...(definition.promptGuidelines ?? []),
      'Use bash for tests, package scripts, short shell commands, and shell-only workflows.',
      'Do not use bash for ls/find/grep/rg/cat/head/tail when list_files, glob, search_files, read, or read_many can do the job.',
      `Bash commands time out after ${defaultTimeoutSeconds} seconds by default; set timeout explicitly for legitimate long-running checks.`,
      'Do not run persistent dev servers, watchers, or interactive commands with bash unless the user explicitly asked for that process to keep running.',
    ],
    parameters: definition.parameters,
    prepareArguments(args: unknown): { command: string; timeout?: number } {
      const normalized = normalizeBashArgs(args);
      return (definition.prepareArguments?.(normalized) ?? normalized) as { command: string; timeout?: number };
    },
    executionMode: definition.executionMode,
    renderShell: definition.renderShell,
    execute: definition.execute,
  });
}

function withDefaultBashTimeout(operations: BashOperations, defaultTimeoutSeconds: number): BashOperations {
  return {
    exec: (command, cwd, options) => operations.exec(command, cwd, {
      ...options,
      timeout: options.timeout ?? defaultTimeoutSeconds,
    }),
  };
}

function normalizeBashArgs(args: unknown): unknown {
  if (typeof args === 'string') {
    return { command: args };
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return args;
  }

  const next = { ...(args as Record<string, unknown>) };
  const command = pickString(next, ['command', 'cmd', 'script', 'shell']);
  if (command !== undefined) next.command = command;

  const timeout = pickNumber(next, ['timeout', 'timeout_seconds', 'timeoutSeconds']);
  if (timeout !== undefined) next.timeout = timeout;

  if (timeout === undefined) {
    const timeoutMs = pickNumber(next, ['timeout_ms', 'timeoutMs']);
    if (timeoutMs !== undefined) next.timeout = Math.max(1, Math.ceil(timeoutMs / 1000));
  }

  return next;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}
