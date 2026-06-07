import {
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  defineTool,
} from '@mariozechner/pi-coding-agent';
import type { SnapshotStore, Filesystem } from '@oh-my-pi/hashline';
import { MismatchError } from '@oh-my-pi/hashline';
import { emitProtectedEvent } from '../hashline/index.js';

type RecordValue = Record<string, unknown>;

/**
 * Hashline anchor format appended to read output.
 * Format: ¶<path>#<tag>
 * The agent uses this tag in subsequent edit calls to validate staleness.
 */
const HASHLINE_ANCHOR_PREFIX = '¶';

/**
 * Regex to detect a hashline anchor in edit arguments.
 * Matches ¶path#tag anywhere in the argument values.
 */
const HASHLINE_ANCHOR_RE = /¶([^\s#]+)#([a-f0-9]{4,})/;

// ---------------------------------------------------------------------------
// Read tool
// ---------------------------------------------------------------------------

export interface ReadToolHashlineOptions {
  /** SnapshotStore for recording file reads and generating hashline tags. */
  store?: SnapshotStore;
}

export function createStudentReadToolDefinition(
  cwd: string,
  hashlineOptions?: ReadToolHashlineOptions,
): ReturnType<typeof createReadToolDefinition> {
  const base = createReadToolDefinition(cwd);
  const store = hashlineOptions?.store;

  if (!store) {
    // No hashline — return the same wrapper as before, just with aliases.
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

  // With hashline: wrap execute to record the file content and append anchor.
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
    async execute(toolCallId, input, signal, onUpdate, ctx) {
      const result = await base.execute(toolCallId, input as never, signal, onUpdate, ctx);

      // Record file content in the snapshot store and append the anchor tag.
      const filePath = (input as RecordValue).path as string | undefined;
      if (typeof filePath === 'string' && filePath.length > 0) {
        const textContent = result.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map((c) => c.text)
          .join('\n');
        if (textContent.length > 0) {
          try {
            const tag = store.record(filePath, textContent);
            const anchorLine = `${HASHLINE_ANCHOR_PREFIX}${filePath}#${tag}`;
            result.content.push({ type: 'text' as const, text: `\n${anchorLine}` });
          } catch {
            // Recording failed — best-effort, don't break the read.
          }
        }
      }

      return result;
    },
  });
}

// ---------------------------------------------------------------------------
// Edit tool
// ---------------------------------------------------------------------------

export interface EditToolHashlineOptions {
  /** SnapshotStore for verifying hashline tags. */
  store?: SnapshotStore;
  /** Filesystem implementation for Patcher to read/write files. */
  fs?: Filesystem;
}

export function createStudentEditToolDefinition(
  cwd: string,
  hashlineOptions?: EditToolHashlineOptions,
): ReturnType<typeof createEditToolDefinition> {
  const base = createEditToolDefinition(cwd);
  const store = hashlineOptions?.store;
  const fs = hashlineOptions?.fs;

  if (!store || !fs) {
    // No hashline — return the same wrapper as before with error enhancement.
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

  // With hashline: wrap execute to check tags when a hashline anchor is detected.
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
      // Check if the arguments contain a hashline anchor (¶path#tag).
      const anchor = extractHashlineAnchor(input);

      if (anchor) {
        // Validate tag staleness and delegate to hashline-aware execution.
        return await executeWithHashline(store, fs, base, anchor, toolCallId, input, signal, onUpdate, ctx);
      }

      // No explicit anchor — but if the store has a snapshot for this file,
      // perform an automatic stale check using the head (latest) snapshot.
      // This prevents edits from silently bypassing hashline when the agent
      // omits the anchor tag from its edit arguments.
      const editPath = extractEditPath(input);
      if (editPath) {
        const headSnapshot = store.head(editPath);
        if (headSnapshot) {
          // Store has a recorded read for this file → auto-validate.
          const implicitAnchor: HashlineAnchor = { path: editPath, tag: headSnapshot.hash };
          return await executeWithHashline(store, fs, base, implicitAnchor, toolCallId, input, signal, onUpdate, ctx);
        }
      }

      // No snapshot exists for this file — first edit without prior read.
      // Fall through to base edit (backward compatible).
      try {
        return await base.execute(toolCallId, input as never, signal, onUpdate, ctx);
      } catch (err) {
        throw enhanceEditError(err);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Write tool (unchanged)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Hashline edit execution
// ---------------------------------------------------------------------------

interface HashlineAnchor {
  path: string;
  tag: string;
}

/**
 * Extract the file path from edit arguments.
 * Used for automatic stale-check when no explicit anchor is present.
 */
function extractEditPath(input: unknown): string | null {
  if (!isRecord(input)) return null;
  const path = pickString(input as RecordValue, ['path', 'file_path', 'filepath', 'filename', 'file', 'target']);
  return path && path.length > 0 ? path : null;
}

/**
 * Extract a hashline anchor (¶path#tag) from edit arguments.
 * Searches through string values in the arguments for the anchor pattern.
 */
function extractHashlineAnchor(input: unknown): HashlineAnchor | null {
  if (!isRecord(input)) return null;

  // Check all string fields for an anchor pattern.
  for (const value of Object.values(input)) {
    if (typeof value !== 'string') continue;
    const match = value.match(HASHLINE_ANCHOR_RE);
    if (match) {
      return { path: match[1], tag: match[2] };
    }
  }

  // Check nested edits arrays.
  const edits = (input as RecordValue).edits ?? (input as RecordValue).replacements ?? (input as RecordValue).changes;
  if (Array.isArray(edits)) {
    for (const edit of edits) {
      if (!isRecord(edit)) continue;
      for (const value of Object.values(edit)) {
        if (typeof value !== 'string') continue;
        const match = value.match(HASHLINE_ANCHOR_RE);
        if (match) {
          return { path: match[1], tag: match[2] };
        }
      }
    }
  }

  return null;
}

/**
 * Execute an edit using the hashline Patcher when a tag anchor is present.
 *
 * Flow:
 *  1. Read current file content via Patcher's filesystem.
 *  2. Construct a PatchSection with the anchor tag.
 *  3. Prepare (validates tag + applies edits in memory).
 *  4. If tag matches: commit and return success.
 *  5. If 3-way merge recovery succeeded: emit recovery_success event, commit.
 *  6. If tag stale and recovery failed: emit stale_rejection event, throw.
 */
async function executeWithHashline(
  store: SnapshotStore,
  fs: Filesystem,
  base: ReturnType<typeof createEditToolDefinition>,
  anchor: HashlineAnchor,
  toolCallId: string,
  input: unknown,
  signal: AbortSignal | undefined,
  onUpdate: unknown,
  ctx: unknown,
): Promise<ReturnType<typeof base.execute>> {
  // Validate that the snapshot store has a record for this tag.
  const snapshot = store.byHash(anchor.path, anchor.tag);

  if (!snapshot) {
    // No recorded snapshot for this tag — the tag is unrecognised.
    // This could mean the anchor was fabricated or from a prior session.
    emitProtectedEvent({
      source: 'hashline',
      type: 'stale_rejection',
      path: anchor.path,
      evidenceRef: anchor.tag,
      blocked: true,
      provenance: { reason: 'unrecognised_tag', tag: anchor.tag },
    });

    throw new Error(
      `Hashline: tag ${anchor.tag} for ${anchor.path} is not recognised. ` +
      `Re-read the file to get a fresh anchor before editing.`,
    );
  }

  // Check staleness: compare the current file content hash against the tag.
  try {
    const currentContent = await fs.readText(anchor.path);
    const currentTag = store.record(anchor.path, currentContent);

    if (currentTag !== anchor.tag) {
      // Tag is stale — file has changed since the read.
      // Attempt 3-way merge recovery by reading the snapshot's content
      // and checking if the edit can still apply to the current version.
      // For now: emit stale_rejection and throw with actionable guidance.
      // A future iteration will use Patcher.prepare/commit for full recovery.
      emitProtectedEvent({
        source: 'hashline',
        type: 'stale_rejection',
        path: anchor.path,
        evidenceRef: anchor.tag,
        blocked: true,
        provenance: {
          reason: 'stale_tag',
          expectedFileHash: anchor.tag,
          actualFileHash: currentTag,
        },
      });

      throw new Error(
        `Hashline: ${anchor.path} has changed since last read (tag ${anchor.tag} is stale, ` +
        `current is ${currentTag}). Re-read the file before editing.`,
      );
    }

    // Tag matches — proceed with the base edit.
    const result = await base.execute(toolCallId, input as never, signal, onUpdate as never, ctx as never);

    // After successful edit, record the updated file content in the snapshot store.
    try {
      const newContent = await fs.readText(anchor.path);
      store.record(anchor.path, newContent);
    } catch {
      // Best-effort: if we can't re-read the file, don't break the edit.
    }

    return result;
  } catch (err: unknown) {
    // Re-throw our own stale-rejection errors.
    if (err instanceof Error && err.message.startsWith('Hashline:')) {
      throw err;
    }

    // Handle MismatchError from hashline if it propagates up.
    if (err instanceof MismatchError) {
      emitProtectedEvent({
        source: 'hashline',
        type: 'stale_rejection',
        path: anchor.path,
        evidenceRef: anchor.tag,
        blocked: true,
        provenance: {
          reason: 'mismatch_error',
          expectedFileHash: err.expectedFileHash,
          actualFileHash: err.actualFileHash,
          hashRecognized: err.hashRecognized,
        },
      });

      const enhancedMessage = [
        err.displayMessage,
        '',
        'Hashline: the file has changed since you last read it (stale tag).',
        'Re-read the file to get a fresh anchor before editing.',
      ].join('\n');

      throw new Error(enhancedMessage, { cause: err });
    }

    throw enhanceEditError(err);
  }
}

// ---------------------------------------------------------------------------
// Argument normalization helpers
// ---------------------------------------------------------------------------

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