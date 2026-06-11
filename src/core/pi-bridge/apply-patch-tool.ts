import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { Type } from '@mariozechner/pi-ai';
import { defineTool } from '@mariozechner/pi-coding-agent';
import type { TasksManager } from '../../memory/tasks/manager.js';

interface ApplyPatchInput {
  input: string;
}

type PatchOperation =
  | { type: 'add'; path: string; lines: string[] }
  | { type: 'delete'; path: string }
  | { type: 'update'; path: string; moveTo?: string; hunks: PatchHunk[] };

interface PatchHunk {
  oldLines: string[];
  newLines: string[];
}

interface SplitFile {
  lines: string[];
  trailingNewline: boolean;
}

const applyPatchSchema = Type.Object({
  input: Type.String({
    description: [
      'Patch text using OpenClaw/Claude-style marker lines.',
      'Example: *** Begin Patch, *** Update File: src/file.ts, @@, -old, +new, *** End Patch.',
      'Paths in marker lines are relative to the project root.',
    ].join(' '),
  }),
});

export function createApplyPatchToolDefinition(
  cwd: string,
  options: { tasksManager?: TasksManager } = {},
) {
  return defineTool({
    name: 'apply_patch',
    label: 'apply_patch',
    description: 'Apply marker-based patches to files without relying on edit oldText exact replacement.',
    promptSnippet: 'Apply multi-file patches with an input string containing *** Update File, *** Add File, and *** Delete File marker lines',
    promptGuidelines: [
      'Use apply_patch for multi-file edits, large structural changes, moves, deletes, and repeated edits that would make edit oldText fragile.',
      'Use edit only for small single-location replacements with a freshly read, stable oldText.',
      'In apply_patch, put paths in marker lines relative to the project root.',
    ],
    parameters: applyPatchSchema,
    prepareArguments(args: unknown): ApplyPatchInput {
      if (isRecord(args) && typeof args.input === 'string') {
        return { input: args.input };
      }
      if (isRecord(args) && typeof args.patchText === 'string') {
        return { input: args.patchText };
      }
      if (isRecord(args) && typeof args.patch === 'string') {
        return { input: args.patch };
      }
      return { input: '' };
    },
    async execute(_toolCallId, params: ApplyPatchInput) {
      const operations = parsePatch(params.input);
      const applied = await applyOperations(cwd, operations);
      await trackPatchedFiles(options.tasksManager, operations);
      return {
        content: [{ type: 'text', text: `Applied patch: ${applied.join(', ')}` }],
        details: { applied },
      };
    },
  });
}

async function trackPatchedFiles(
  tasksManager: TasksManager | undefined,
  operations: PatchOperation[],
): Promise<void> {
  if (!tasksManager) return;
  try {
    const active = await tasksManager.getActive();
    if (!active) return;
    for (const operation of operations) {
      const path = operation.type === 'update' && operation.moveTo
        ? operation.moveTo
        : operation.path;
      await tasksManager.trackFileWrite(active.id, path);
    }
  } catch {
    // Working-memory tracking is best-effort and must not fail a valid patch.
  }
}

function parsePatch(patchText: string): PatchOperation[] {
  const lines = patchText.replace(/\r\n/g, '\n').split('\n');
  let index = skipBlank(lines, 0);
  if (lines[index] !== '*** Begin Patch') {
    throw new Error('input must start with "*** Begin Patch"');
  }
  index++;

  const operations: PatchOperation[] = [];
  while (index < lines.length) {
    index = skipBlank(lines, index);
    const line = lines[index];
    if (line === '*** End Patch') return operations;
    if (!line) break;

    const addMatch = line.match(/^\*\*\* Add File: (.+)$/);
    if (addMatch) {
      const { block, nextIndex } = collectBlock(lines, index + 1);
      operations.push({ type: 'add', path: addMatch[1].trim(), lines: parseAddedLines(block) });
      index = nextIndex;
      continue;
    }

    const deleteMatch = line.match(/^\*\*\* Delete File: (.+)$/);
    if (deleteMatch) {
      operations.push({ type: 'delete', path: deleteMatch[1].trim() });
      index++;
      continue;
    }

    const updateMatch = line.match(/^\*\*\* Update File: (.+)$/);
    if (updateMatch) {
      const { block, nextIndex } = collectBlock(lines, index + 1);
      const { moveTo, hunkLines } = parseMove(block);
      operations.push({
        type: 'update',
        path: updateMatch[1].trim(),
        moveTo,
        hunks: parseHunks(hunkLines),
      });
      index = nextIndex;
      continue;
    }

    throw new Error(`Unsupported patch marker: ${line}`);
  }

  throw new Error('input must end with "*** End Patch"');
}

function skipBlank(lines: string[], start: number): number {
  let index = start;
  while (lines[index] === '') index++;
  return index;
}

function collectBlock(lines: string[], start: number): { block: string[]; nextIndex: number } {
  const block: string[] = [];
  let index = start;
  while (index < lines.length && !isTopLevelMarker(lines[index])) {
    block.push(lines[index]);
    index++;
  }
  return { block, nextIndex: index };
}

function isTopLevelMarker(line: string): boolean {
  return line === '*** End Patch'
    || line.startsWith('*** Add File: ')
    || line.startsWith('*** Delete File: ')
    || line.startsWith('*** Update File: ');
}

function parseAddedLines(lines: string[]): string[] {
  return lines.map((line) => {
    if (!line.startsWith('+')) {
      throw new Error(`Add File lines must start with "+": ${line}`);
    }
    return line.slice(1);
  });
}

function parseMove(lines: string[]): { moveTo?: string; hunkLines: string[] } {
  const [first, ...rest] = lines;
  const match = first?.match(/^\*\*\* Move to: (.+)$/);
  if (!match) return { hunkLines: lines };
  return { moveTo: match[1].trim(), hunkLines: rest };
}

function parseHunks(lines: string[]): PatchHunk[] {
  const hunks: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current.length > 0) hunks.push(current);
      current = [];
      continue;
    }
    if (line === '\\ No newline at end of file') continue;
    if (!line) continue;
    current.push(line);
  }
  if (current.length > 0) hunks.push(current);

  return hunks.map(parseHunk);
}

function parseHunk(lines: string[]): PatchHunk {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith(' ')) {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    } else if (line.startsWith('-')) {
      oldLines.push(line.slice(1));
    } else if (line.startsWith('+')) {
      newLines.push(line.slice(1));
    } else {
      throw new Error(`Patch hunk lines must start with " ", "+", or "-": ${line}`);
    }
  }
  if (oldLines.length === 0 && newLines.length === 0) {
    throw new Error('Empty patch hunk');
  }
  return { oldLines, newLines };
}

async function applyOperations(cwd: string, operations: PatchOperation[]): Promise<string[]> {
  const applied: string[] = [];
  for (const operation of operations) {
    if (operation.type === 'add') {
      const target = resolveProjectPath(cwd, operation.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, operation.lines.join('\n') + (operation.lines.length > 0 ? '\n' : ''), 'utf8');
      applied.push(`add ${operation.path}`);
      continue;
    }

    if (operation.type === 'delete') {
      await rm(resolveProjectPath(cwd, operation.path), { force: false });
      applied.push(`delete ${operation.path}`);
      continue;
    }

    const source = resolveProjectPath(cwd, operation.path);
    const original = await readFile(source, 'utf8');
    const next = applyHunks(original, operation.hunks);
    await writeFile(source, next, 'utf8');
    if (operation.moveTo) {
      const destination = resolveProjectPath(cwd, operation.moveTo);
      await mkdir(dirname(destination), { recursive: true });
      await rename(source, destination);
      applied.push(`update ${operation.path} -> ${operation.moveTo}`);
    } else {
      applied.push(`update ${operation.path}`);
    }
  }
  return applied;
}

function applyHunks(content: string, hunks: PatchHunk[]): string {
  const split = splitFile(content);
  let cursor = 0;

  for (const hunk of hunks) {
    const matchIndex = findSubsequence(split.lines, hunk.oldLines, cursor);
    if (matchIndex < 0) {
      throw new Error(`Patch hunk did not match current file content near line ${cursor + 1}`);
    }
    split.lines.splice(matchIndex, hunk.oldLines.length, ...hunk.newLines);
    cursor = matchIndex + hunk.newLines.length;
  }

  return joinFile(split);
}

function splitFile(content: string): SplitFile {
  const trailingNewline = content.endsWith('\n');
  const body = trailingNewline ? content.slice(0, -1) : content;
  return {
    lines: body ? body.split('\n') : [],
    trailingNewline,
  };
}

function joinFile(file: SplitFile): string {
  const body = file.lines.join('\n');
  return body + (file.trailingNewline ? '\n' : '');
}

function findSubsequence(lines: string[], needle: string[], start: number): number {
  if (needle.length === 0) return start;
  for (let index = start; index <= lines.length - needle.length; index++) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset++) {
      if (lines[index + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return index;
  }
  return -1;
}

function resolveProjectPath(cwd: string, path: string): string {
  const absolute = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  const rel = relative(cwd, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path escapes project root: ${path}`);
  }
  return absolute;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
