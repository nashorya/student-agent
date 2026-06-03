import {
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  defineTool,
} from '@mariozechner/pi-coding-agent';

type RecordValue = Record<string, unknown>;

export function createStudentReadToolDefinition(cwd: string): ReturnType<typeof createReadToolDefinition> {
  const base = createReadToolDefinition(cwd);
  return defineTool({
    ...base,
    description: [
      base.description,
      'Student Agent accepts common aliases such as file_path, start_line, end_line, and max_lines.',
    ].join(' '),
    promptGuidelines: [
      'Use list_files, glob, or search_files to discover candidates; use read only after you know the exact file.',
      'Use read_many when you need several explicit small files.',
      'Prefer offset/limit for focused ranges instead of reading a whole large file.',
      'Accepted aliases: file_path/path, start_line/offset, end_line, max_lines/limit.',
    ],
    prepareArguments(args: unknown) {
      return normalizeReadArgs(args) as never;
    },
  });
}

export function createStudentEditToolDefinition(cwd: string): ReturnType<typeof createEditToolDefinition> {
  const base = createEditToolDefinition(cwd);
  return defineTool({
    ...base,
    description: [
      base.description,
      'Student Agent normalizes common aliases such as file_path, old_text, new_text, replacements, and changes before execution.',
    ].join(' '),
    promptGuidelines: [
      'Use edit only for small, exact, freshly-read replacements in one file.',
      'When changing multiple disjoint places in one file, send one edit call with multiple edits[] entries.',
      'Use apply_patch for structural edits, repeated edits, multi-file changes, moves, deletes, and large JSX/TSX/JSON blocks.',
      'Accepted aliases: file_path/path, old_text/oldText, new_text/newText, replacements/changes/edits.',
    ],
    prepareArguments(args: unknown) {
      const normalized = normalizeEditArgs(args);
      return (base.prepareArguments?.(normalized) ?? normalized) as never;
    },
    async execute(toolCallId, input, signal, onUpdate, ctx) {
      try {
        return await base.execute(toolCallId, input as never, signal, onUpdate, ctx);
      } catch (err) {
        throw enhanceEditError(err);
      }
    },
  });
}

export function createStudentWriteToolDefinition(cwd: string): ReturnType<typeof createWriteToolDefinition> {
  const base = createWriteToolDefinition(cwd);
  return defineTool({
    ...base,
    description: [
      base.description,
      'Student Agent accepts common aliases such as file_path, contents, text, and data.',
    ].join(' '),
    promptGuidelines: [
      'Use write for new files or intentional full-file rewrites only.',
      'Use apply_patch for normal modifications to existing files.',
      'Accepted aliases: file_path/path and contents/text/data/content.',
    ],
    prepareArguments(args: unknown) {
      return normalizeWriteArgs(args) as never;
    },
  });
}

function normalizeReadArgs(args: unknown): unknown {
  if (typeof args === 'string') {
    return { path: args };
  }
  if (!isRecord(args)) {
    return args;
  }

  const next = { ...args };
  const path = pickString(next, ['path', 'file_path', 'filepath', 'filename', 'file', 'target']);
  if (path !== undefined) next.path = path;

  const offset = pickNumber(next, ['offset', 'start_line', 'startLine', 'line', 'from']);
  if (offset !== undefined) next.offset = offset;

  const explicitLimit = pickNumber(next, ['limit', 'max_lines', 'maxLines', 'line_count', 'lineCount', 'lines']);
  const endLine = pickNumber(next, ['end_line', 'endLine', 'to']);
  if (explicitLimit !== undefined) {
    next.limit = explicitLimit;
  } else if (offset !== undefined && endLine !== undefined && endLine >= offset) {
    next.limit = endLine - offset + 1;
  }

  return next;
}

function normalizeEditArgs(args: unknown): unknown {
  if (!isRecord(args)) {
    return args;
  }

  const next = { ...args };
  const path = pickString(next, ['path', 'file_path', 'filepath', 'filename', 'file', 'target']);
  if (path !== undefined) next.path = path;

  const edits = normalizeEditList(next);
  if (edits.length > 0) {
    next.edits = edits;
  } else {
    const oldText = pickString(next, ['oldText', 'old_text', 'old', 'find', 'search']);
    const newText = pickString(next, ['newText', 'new_text', 'new', 'replace', 'replacement']);
    if (oldText !== undefined) next.oldText = oldText;
    if (newText !== undefined) next.newText = newText;
  }

  return next;
}

function normalizeWriteArgs(args: unknown): unknown {
  if (!isRecord(args)) {
    return args;
  }

  const next = { ...args };
  const path = pickString(next, ['path', 'file_path', 'filepath', 'filename', 'file', 'target']);
  if (path !== undefined) next.path = path;

  const content = pickString(next, ['content', 'contents', 'text', 'data', 'body']);
  if (content !== undefined) next.content = content;

  return next;
}

function normalizeEditList(args: RecordValue): Array<{ oldText: string; newText: string }> {
  const raw = args.edits ?? args.replacements ?? args.changes;
  const parsed = typeof raw === 'string' ? parseJsonArray(raw) : raw;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((item) => {
    if (!isRecord(item)) return [];
    const oldText = pickString(item, ['oldText', 'old_text', 'old', 'find', 'search']);
    const newText = pickString(item, ['newText', 'new_text', 'new', 'replace', 'replacement']);
    return oldText !== undefined && newText !== undefined ? [{ oldText, newText }] : [];
  });
}

function parseJsonArray(value: string): unknown {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function enhanceEditError(err: unknown): Error {
  const original = err instanceof Error ? err : new Error(String(err));
  const message = original.message;
  if (!/old ?text|edits\[\d+\]|exact text|must match exactly|occurrences/u.test(message)) {
    return original;
  }

  return new Error([
    message,
    '',
    'Student Agent edit hint:',
    '- Re-read the smallest surrounding range before retrying.',
    '- Use a shorter unique oldText anchor for one small change.',
    '- Use apply_patch for structural edits, large blocks, or multiple nearby changes.',
  ].join('\n'), { cause: original });
}

function pickString(record: RecordValue, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function pickNumber(record: RecordValue, keys: string[]): number | undefined {
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

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
