import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Type } from '../pi-compat/index.js';
import { defineTool } from '@earendil-works/pi-coding-agent';

type RecordValue = Record<string, unknown>;

type EntryKind = 'file' | 'directory';
type ListType = EntryKind | 'any';

interface DiscoveryEntry {
  path: string;
  kind: EntryKind;
}

interface SearchMatch {
  path: string;
  line: number;
  preview: string;
}

interface ReadManyFileDetail {
  path: string;
  bytes: number;
  truncated: boolean;
  skipped?: 'binary';
}

interface RipgrepRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type RipgrepRunner = (
  args: string[],
  options: { cwd: string; timeoutMs: number; maxBuffer: number; signal?: AbortSignal },
) => Promise<RipgrepRunResult>;

export interface StudentSearchFilesToolOptions {
  runRipgrep?: RipgrepRunner;
}

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.pi', 'logs', 'dist', 'build', 'coverage']);
const DEFAULT_LIST_MAX_ENTRIES = 200;
const DEFAULT_GLOB_MAX_MATCHES = 200;
const DEFAULT_SEARCH_MAX_MATCHES = 100;
const DEFAULT_SEARCH_MAX_CHARS = 20_000;
const DEFAULT_READ_MANY_MAX_FILES = 10;
const DEFAULT_READ_MANY_MAX_CHARS_PER_FILE = 8_000;
const DEFAULT_READ_MANY_MAX_TOTAL_CHARS = 30_000;
const MAX_LIST_ENTRIES = 1_000;
const MAX_GLOB_MATCHES = 1_000;
const MAX_SEARCH_MATCHES = 1_000;
const MAX_SEARCH_CHARS = 60_000;
const MAX_READ_MANY_CHARS_PER_FILE = 30_000;
const MAX_READ_MANY_TOTAL_CHARS = 80_000;
const RIPGREP_TIMEOUT_MS = 15_000;
const BINARY_SNIFF_BYTES = 8_000;

const listFilesSchema = Type.Object({
  path: Type.Optional(Type.String({ description: 'Directory to list. Defaults to the project root.' })),
  recursive: Type.Optional(Type.Boolean({ description: 'Whether to recurse into subdirectories. Default: false.' })),
  maxEntries: Type.Optional(Type.Number({ description: 'Maximum entries to return. Default: 200.' })),
  includeHidden: Type.Optional(Type.Boolean({ description: 'Include hidden files other than always-ignored directories. Default: false.' })),
  type: Type.Optional(Type.String({ description: 'Filter by entry type: any, file, or directory. Default: any.' })),
});

const globSchema = Type.Object({
  pattern: Type.String({ description: 'File path glob such as *.ts, **/*.json, or src/**/*.test.ts.' }),
  path: Type.Optional(Type.String({ description: 'Directory to search in. Defaults to the project root.' })),
  maxMatches: Type.Optional(Type.Number({ description: 'Maximum matching paths to return. Default: 200.' })),
});

const searchFilesSchema = Type.Object({
  query: Type.String({ description: 'Literal text to search for in files.' }),
  path: Type.Optional(Type.String({ description: 'Directory or file to search. Defaults to the project root.' })),
  glob: Type.Optional(Type.String({ description: 'Optional file path glob filter such as **/*.ts.' })),
  caseSensitive: Type.Optional(Type.Boolean({ description: 'Use case-sensitive matching. Default: false.' })),
  contextLines: Type.Optional(Type.Number({ description: 'Number of lines before and after each match. Default: 0.' })),
  maxMatches: Type.Optional(Type.Number({ description: 'Maximum matches to return. Default: 100.' })),
  maxChars: Type.Optional(Type.Number({ description: 'Maximum output characters. Default: 20000.' })),
});

const readManySchema = Type.Object({
  paths: Type.Array(Type.String({ description: 'Explicit file path to read. Glob patterns are rejected.' }), {
    description: 'Explicit file paths to read. Maximum 10 files.',
  }),
  maxCharsPerFile: Type.Optional(Type.Number({ description: 'Maximum characters per file. Default: 8000.' })),
  maxTotalChars: Type.Optional(Type.Number({ description: 'Maximum total characters. Default: 30000.' })),
});

export function createStudentListFilesToolDefinition(cwd: string) {
  return defineTool({
    name: 'list_files',
    label: 'list_files',
    description: 'List project files and directories without reading file contents. Use instead of bash ls/find for directory discovery.',
    promptSnippet: 'List files/directories in the project without reading contents',
    promptGuidelines: [
      'Use list_files for directory discovery instead of bash ls or find.',
      'Use glob when you know a path pattern; use search_files when you need to search file contents.',
      'Output is capped and ignores .git, node_modules, .pi, logs, dist, build, and coverage.',
    ],
    parameters: listFilesSchema,
    prepareArguments(args: unknown): { path?: string; recursive?: boolean; maxEntries?: number; includeHidden?: boolean; type?: string } {
      if (typeof args === 'string') return { path: args };
      if (!isRecord(args)) return {};
      return {
        path: pickString(args, ['path', 'root', 'dir', 'directory', 'folder']),
        recursive: pickBoolean(args, ['recursive', 'recurse']),
        maxEntries: pickNumber(args, ['maxEntries', 'max_entries', 'maxResults', 'max_results', 'limit']),
        includeHidden: pickBoolean(args, ['includeHidden', 'include_hidden', 'hidden']),
        type: pickString(args, ['type', 'kind', 'entryType', 'entry_type']),
      };
    },
    async execute(_toolCallId, params: { path?: string; recursive?: boolean; maxEntries?: number; includeHidden?: boolean; type?: string }) {
      const root = await getProjectRoot(cwd);
      const directory = await resolveExistingProjectPath(root, params.path ?? '.');
      await assertDirectory(directory, params.path ?? '.');
      rejectIgnoredPath(root, directory);

      const maxEntries = clampInteger(params.maxEntries, DEFAULT_LIST_MAX_ENTRIES, 1, MAX_LIST_ENTRIES);
      const type = normalizeListType(params.type);
      const entries = await collectEntries(root, directory, {
        recursive: params.recursive ?? false,
        includeHidden: params.includeHidden ?? false,
        maxEntries,
        includeDirectories: type === 'any' || type === 'directory',
        includeFiles: type === 'any' || type === 'file',
      });
      const truncated = entries.truncated;
      const lines = entries.items.map((entry) => `${entry.kind} ${entry.path}${entry.kind === 'directory' ? '/' : ''}`);
      const notices = truncated ? [`${maxEntries} entries limit reached. Narrow path or increase maxEntries.`] : [];
      const text = formatListOutput(lines, 'No files found.', notices);
      return {
        content: [{ type: 'text', text }],
        details: {
          path: toProjectPath(root, directory),
          entries: entries.items,
          count: entries.items.length,
          truncated,
        },
      };
    },
  });
}

export function createStudentGlobToolDefinition(cwd: string) {
  return defineTool({
    name: 'glob',
    label: 'glob',
    description: 'Find files by path glob without reading file contents. Use instead of bash find for filename/path discovery.',
    promptSnippet: 'Find files by glob pattern without reading contents',
    promptGuidelines: [
      'Use glob for filename or path patterns instead of bash find.',
      'Use search_files to search file contents.',
      'Use read or read_many after glob returns exact paths.',
    ],
    parameters: globSchema,
    prepareArguments(args: unknown): { pattern: string; path?: string; maxMatches?: number } {
      if (!isRecord(args)) return { pattern: typeof args === 'string' ? args : '' };
      return {
        pattern: pickString(args, ['pattern', 'glob', 'query', 'match']) ?? '',
        path: pickString(args, ['path', 'root', 'dir', 'directory', 'folder']),
        maxMatches: pickNumber(args, ['maxMatches', 'max_matches', 'maxResults', 'max_results', 'limit']),
      };
    },
    async execute(_toolCallId, params: { pattern: string; path?: string; maxMatches?: number }) {
      if (!params.pattern.trim()) {
        throw new Error('glob requires a pattern. Use list_files for plain directory listing.');
      }
      const root = await getProjectRoot(cwd);
      const searchRoot = await resolveExistingProjectPath(root, params.path ?? '.');
      await assertDirectory(searchRoot, params.path ?? '.');
      rejectIgnoredPath(root, searchRoot);

      const maxMatches = clampInteger(params.maxMatches, DEFAULT_GLOB_MAX_MATCHES, 1, MAX_GLOB_MATCHES);
      const pattern = toPosix(params.pattern.trim());
      const matcher = createGlobMatcher(pattern);
      const entries = await collectEntries(root, searchRoot, {
        recursive: true,
        includeHidden: false,
        maxEntries: maxMatches,
        includeDirectories: false,
        includeFiles: true,
        filter: (entry) => matcher(entry.path, relativeToSearchRoot(searchRoot, join(root, entry.path))),
      });
      const notices = entries.truncated ? [`${maxMatches} matches limit reached. Narrow the glob or path.`] : [];
      const lines = entries.items.map((entry) => entry.path);
      return {
        content: [{ type: 'text', text: formatListOutput(lines, 'No files matched the glob pattern.', notices) }],
        details: {
          pattern,
          path: toProjectPath(root, searchRoot),
          matches: lines,
          count: lines.length,
          truncated: entries.truncated,
        },
      };
    },
  });
}

export function createStudentSearchFilesToolDefinition(cwd: string, options: StudentSearchFilesToolOptions = {}) {
  return defineTool({
    name: 'search_files',
    label: 'search_files',
    description: 'Search project file contents for literal text. Use instead of bash grep/rg for code and text discovery.',
    promptSnippet: 'Search file contents with safe output limits',
    promptGuidelines: [
      'Use search_files for content search instead of bash grep, rg, cat, head, or tail.',
      'Use glob for path patterns and read/read_many after search_files returns exact paths.',
      'Search is literal text by default and skips binary or ignored files.',
    ],
    parameters: searchFilesSchema,
    prepareArguments(args: unknown): {
      query: string;
      path?: string;
      glob?: string;
      caseSensitive?: boolean;
      contextLines?: number;
      maxMatches?: number;
      maxChars?: number;
    } {
      if (!isRecord(args)) return { query: typeof args === 'string' ? args : '' };
      return {
        query: pickString(args, ['query', 'search', 'text', 'pattern']) ?? '',
        path: pickString(args, ['path', 'root', 'dir', 'directory', 'folder', 'file']),
        glob: pickString(args, ['glob', 'fileGlob', 'file_glob', 'include']),
        caseSensitive: pickBoolean(args, ['caseSensitive', 'case_sensitive']),
        contextLines: pickNumber(args, ['contextLines', 'context_lines', 'context']),
        maxMatches: pickNumber(args, ['maxMatches', 'max_matches', 'maxResults', 'max_results', 'limit']),
        maxChars: pickNumber(args, ['maxChars', 'max_chars']),
      };
    },
    async execute(
      _toolCallId,
      params: {
        query: string;
        path?: string;
        glob?: string;
        caseSensitive?: boolean;
        contextLines?: number;
        maxMatches?: number;
        maxChars?: number;
      },
      signal?: AbortSignal,
    ) {
      if (!params.query) {
        throw new Error('search_files requires query text. Use list_files or glob for path discovery.');
      }
      const root = await getProjectRoot(cwd);
      const searchPath = await resolveExistingProjectPath(root, params.path ?? '.');
      rejectIgnoredPath(root, searchPath);
      const maxMatches = clampInteger(params.maxMatches, DEFAULT_SEARCH_MAX_MATCHES, 1, MAX_SEARCH_MATCHES);
      const maxChars = clampInteger(params.maxChars, DEFAULT_SEARCH_MAX_CHARS, 1, MAX_SEARCH_CHARS);
      const contextLines = clampInteger(params.contextLines, 0, 0, 5);
      const glob = params.glob?.trim() ? toPosix(params.glob.trim()) : undefined;
      const runRipgrep = options.runRipgrep ?? defaultRunRipgrep;

      let matches: SearchMatch[];
      let source: 'rg' | 'js';
      try {
        matches = await searchWithRipgrep(root, searchPath, params.query, {
          caseSensitive: params.caseSensitive ?? false,
          glob,
          maxMatches,
          runRipgrep,
          signal,
        });
        source = 'rg';
      } catch (err) {
        if (!isCommandMissingError(err)) {
          throw enhanceSearchError(err);
        }
        matches = await searchWithJs(root, searchPath, params.query, {
          caseSensitive: params.caseSensitive ?? false,
          glob,
          maxMatches,
        });
        source = 'js';
      }

      const formatted = await formatSearchMatches(root, matches, contextLines, maxChars);
      return {
        content: [{ type: 'text', text: formatted.text }],
        details: {
          source,
          query: params.query,
          path: toProjectPath(root, searchPath),
          glob,
          matches: matches.slice(0, maxMatches),
          count: matches.length,
          truncated: formatted.truncated,
        },
      };
    },
  });
}

export function createStudentReadManyToolDefinition(cwd: string) {
  return defineTool({
    name: 'read_many',
    label: 'read_many',
    description: 'Read multiple explicit small files. Use after list_files/glob/search_files returns exact paths; rejects globs and directories.',
    promptSnippet: 'Read several explicit files with output limits',
    promptGuidelines: [
      'Use read_many only with explicit file paths, not glob patterns or directories.',
      'Use glob or search_files first when you need to discover files.',
      'Use read for a focused range in one large file.',
    ],
    parameters: readManySchema,
    prepareArguments(args: unknown): { paths: string[]; maxCharsPerFile?: number; maxTotalChars?: number } {
      if (typeof args === 'string') return { paths: [args] };
      if (!isRecord(args)) return { paths: [] };
      return {
        paths: pickStringArray(args, ['paths', 'files', 'file_paths', 'filePaths', 'path']) ?? [],
        maxCharsPerFile: pickNumber(args, ['maxCharsPerFile', 'max_chars_per_file', 'maxFileChars', 'max_file_chars']),
        maxTotalChars: pickNumber(args, ['maxTotalChars', 'max_total_chars', 'maxChars', 'max_chars']),
      };
    },
    async execute(_toolCallId, params: { paths: string[]; maxCharsPerFile?: number; maxTotalChars?: number }) {
      if (!Array.isArray(params.paths) || params.paths.length === 0) {
        throw new Error('read_many requires explicit paths[]. Use glob/search_files first to discover files.');
      }
      if (params.paths.length > DEFAULT_READ_MANY_MAX_FILES) {
        throw new Error(`read_many accepts at most ${DEFAULT_READ_MANY_MAX_FILES} explicit file paths. Use fewer paths or read focused ranges.`);
      }

      const root = await getProjectRoot(cwd);
      const maxCharsPerFile = clampInteger(
        params.maxCharsPerFile,
        DEFAULT_READ_MANY_MAX_CHARS_PER_FILE,
        1,
        MAX_READ_MANY_CHARS_PER_FILE,
      );
      const maxTotalChars = clampInteger(params.maxTotalChars, DEFAULT_READ_MANY_MAX_TOTAL_CHARS, 1, MAX_READ_MANY_TOTAL_CHARS);
      const sections: string[] = [];
      const details: ReadManyFileDetail[] = [];
      let remaining = maxTotalChars;
      let totalTruncated = false;

      for (const rawPath of params.paths) {
        if (looksLikeGlob(rawPath)) {
          throw new Error(`read_many accepts explicit file paths only, not glob patterns: ${rawPath}. Use glob first, then pass returned paths.`);
        }
        const filePath = await resolveExistingProjectPath(root, rawPath);
        rejectIgnoredPath(root, filePath);
        const fileStat = await stat(filePath);
        if (fileStat.isDirectory()) {
          throw new Error(`read_many cannot read directories: ${rawPath}. Use list_files or glob first.`);
        }

        const relativePath = toProjectPath(root, filePath);
        const { buffer, truncated } = await readFilePrefix(filePath, Math.min(maxCharsPerFile, remaining));
        if (isLikelyBinary(buffer)) {
          details.push({ path: relativePath, bytes: fileStat.size, truncated: false, skipped: 'binary' });
          sections.push(`--- ${relativePath} ---\n[Skipped binary file]`);
          continue;
        }
        const text = buffer.toString('utf8');
        const fileTruncated = truncated || fileStat.size > Buffer.byteLength(text);
        details.push({ path: relativePath, bytes: fileStat.size, truncated: fileTruncated });
        sections.push(`--- ${relativePath} ---\n${text.trimEnd()}`);
        remaining -= text.length;
        if (remaining <= 0) {
          totalTruncated = true;
          break;
        }
      }

      const notices = totalTruncated ? [`${maxTotalChars} total character limit reached. Read fewer files or use focused read ranges.`] : [];
      const text = formatListOutput(sections, 'No readable files returned.', notices);
      return {
        content: [{ type: 'text', text }],
        details: {
          files: details,
          count: details.length,
          truncated: totalTruncated || details.some((file) => file.truncated),
        },
      };
    },
  });
}

async function getProjectRoot(cwd: string): Promise<string> {
  return realpath(resolve(cwd));
}

async function resolveExistingProjectPath(projectRoot: string, inputPath: string): Promise<string> {
  const syntactic = isAbsolute(inputPath) ? resolve(inputPath) : resolve(projectRoot, inputPath || '.');
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(syntactic);
  } catch {
    throw new Error(`Path not found: ${inputPath}. Use list_files or glob to find valid project paths.`);
  }
  const rel = relative(projectRoot, resolvedPath);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return resolvedPath;
  }
  throw new Error(`Path escapes project root: ${inputPath}. Use paths inside the project workspace.`);
}

async function assertDirectory(path: string, displayPath: string): Promise<void> {
  const fileStat = await stat(path);
  if (!fileStat.isDirectory()) {
    throw new Error(`Not a directory: ${displayPath}. Use read/read_many for files or search_files for content search.`);
  }
}

function rejectIgnoredPath(projectRoot: string, path: string): void {
  const rel = toProjectPath(projectRoot, path);
  if (isIgnoredRelative(rel)) {
    throw new Error(`Path is ignored by Student Agent discovery tools: ${rel}. Narrow the request to project source files.`);
  }
}

async function collectEntries(
  projectRoot: string,
  startDirectory: string,
  options: {
    recursive: boolean;
    includeHidden: boolean;
    maxEntries: number;
    includeDirectories: boolean;
    includeFiles: boolean;
    filter?: (entry: DiscoveryEntry) => boolean;
  },
): Promise<{ items: DiscoveryEntry[]; truncated: boolean }> {
  const items: DiscoveryEntry[] = [];
  let truncated = false;

  async function visit(directory: string): Promise<void> {
    if (items.length >= options.maxEntries) {
      truncated = true;
      return;
    }
    const dirents = await readdir(directory, { withFileTypes: true });
    dirents.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    for (const dirent of dirents) {
      if (items.length >= options.maxEntries) {
        truncated = true;
        return;
      }
      if (!options.includeHidden && dirent.name.startsWith('.')) continue;
      const absolutePath = join(directory, dirent.name);
      const rel = toProjectPath(projectRoot, absolutePath);
      if (isIgnoredRelative(rel)) continue;
      if (dirent.isDirectory()) {
        const entry: DiscoveryEntry = { path: rel, kind: 'directory' };
        if (options.includeDirectories && (!options.filter || options.filter(entry))) {
          items.push(entry);
        }
        if (options.recursive) {
          await visit(absolutePath);
        }
        continue;
      }
      if (dirent.isFile()) {
        const entry: DiscoveryEntry = { path: rel, kind: 'file' };
        if (options.includeFiles && (!options.filter || options.filter(entry))) {
          items.push(entry);
        }
      }
    }
  }

  await visit(startDirectory);
  return { items, truncated };
}

async function searchWithRipgrep(
  projectRoot: string,
  searchPath: string,
  query: string,
  options: {
    caseSensitive: boolean;
    glob?: string;
    maxMatches: number;
    runRipgrep: RipgrepRunner;
    signal?: AbortSignal;
  },
): Promise<SearchMatch[]> {
  const args = [
    '--json',
    '--line-number',
    '--color=never',
    '--fixed-strings',
    '--max-count',
    String(options.maxMatches),
    '--max-filesize',
    '1M',
    ...ignoredGlobArgs(),
  ];
  if (!options.caseSensitive) args.push('--ignore-case');
  if (options.glob) args.push('--glob', options.glob);
  args.push('--', query, searchPath);

  const result = await options.runRipgrep(args, {
    cwd: projectRoot,
    timeoutMs: RIPGREP_TIMEOUT_MS,
    maxBuffer: Math.max(DEFAULT_SEARCH_MAX_CHARS * 4, 1_000_000),
    signal: options.signal,
  });
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(result.stderr || `rg exited with code ${result.exitCode}`);
  }
  return parseRipgrepJson(projectRoot, result.stdout).slice(0, options.maxMatches);
}

function ignoredGlobArgs(): string[] {
  return [...IGNORED_DIRS].flatMap((dir) => ['--glob', `!${dir}/**`]);
}

function parseRipgrepJson(projectRoot: string, stdout: string): SearchMatch[] {
  const matches: SearchMatch[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(event) || event.type !== 'match' || !isRecord(event.data)) continue;
    const data = event.data;
    const pathText = isRecord(data.path) && typeof data.path.text === 'string' ? data.path.text : undefined;
    const lineNumber = typeof data.line_number === 'number' ? data.line_number : undefined;
    const preview = isRecord(data.lines) && typeof data.lines.text === 'string' ? data.lines.text.replace(/\r?\n$/, '') : '';
    if (!pathText || lineNumber === undefined) continue;
    const absolutePath = isAbsolute(pathText) ? pathText : resolve(projectRoot, pathText);
    const rel = toProjectPath(projectRoot, absolutePath);
    if (isIgnoredRelative(rel)) continue;
    matches.push({ path: rel, line: lineNumber, preview });
  }
  return matches;
}

async function searchWithJs(
  projectRoot: string,
  searchPath: string,
  query: string,
  options: { caseSensitive: boolean; glob?: string; maxMatches: number },
): Promise<SearchMatch[]> {
  const matcher = options.glob ? createGlobMatcher(options.glob) : undefined;
  const queryText = options.caseSensitive ? query : query.toLowerCase();
  const rootStat = await stat(searchPath);
  const files = rootStat.isDirectory()
    ? (await collectEntries(projectRoot, searchPath, {
        recursive: true,
        includeHidden: false,
        maxEntries: MAX_GLOB_MATCHES,
        includeDirectories: false,
        includeFiles: true,
        filter: matcher ? (entry) => matcher(entry.path, basename(entry.path)) : undefined,
      })).items.map((entry) => join(projectRoot, entry.path))
    : [searchPath];
  const matches: SearchMatch[] = [];

  for (const file of files) {
    if (matches.length >= options.maxMatches) break;
    const rel = toProjectPath(projectRoot, file);
    if (isIgnoredRelative(rel)) continue;
    const { buffer } = await readFilePrefix(file, 1_000_000);
    if (isLikelyBinary(buffer)) continue;
    const lines = buffer.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    for (let index = 0; index < lines.length; index++) {
      const haystack = options.caseSensitive ? lines[index] : lines[index].toLowerCase();
      if (haystack.includes(queryText)) {
        matches.push({ path: rel, line: index + 1, preview: lines[index] });
        if (matches.length >= options.maxMatches) break;
      }
    }
  }
  return matches;
}

async function formatSearchMatches(
  projectRoot: string,
  matches: SearchMatch[],
  contextLines: number,
  maxChars: number,
): Promise<{ text: string; truncated: boolean }> {
  if (matches.length === 0) {
    return { text: 'No matches found.', truncated: false };
  }
  const fileLineCache = new Map<string, string[]>();
  const outputLines: string[] = [];

  for (const match of matches) {
    if (contextLines <= 0) {
      outputLines.push(`${match.path}:${match.line}: ${truncateLine(match.preview)}`);
      continue;
    }
    let lines = fileLineCache.get(match.path);
    if (!lines) {
      const absolutePath = resolve(projectRoot, match.path);
      const { buffer } = await readFilePrefix(absolutePath, 1_000_000);
      lines = buffer.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      fileLineCache.set(match.path, lines);
    }
    const start = Math.max(1, match.line - contextLines);
    const end = Math.min(lines.length, match.line + contextLines);
    for (let current = start; current <= end; current++) {
      const separator = current === match.line ? ':' : '-';
      outputLines.push(`${match.path}${separator}${current}${separator} ${truncateLine(lines[current - 1] ?? '')}`);
    }
  }

  const raw = outputLines.join('\n');
  if (raw.length <= maxChars) {
    return { text: raw, truncated: false };
  }
  return {
    text: `${raw.slice(0, maxChars).trimEnd()}\n\n[Truncated: ${maxChars} character limit reached. Narrow query/path/glob.]`,
    truncated: true,
  };
}

function defaultRunRipgrep(
  args: string[],
  options: { cwd: string; timeoutMs: number; maxBuffer: number; signal?: AbortSignal },
): Promise<RipgrepRunResult> {
  return new Promise((resolvePromise, reject) => {
    execFile('rg', args, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      maxBuffer: options.maxBuffer,
      signal: options.signal,
    }, (error, stdout, stderr) => {
      if (error) {
        const code = (error as { code?: unknown }).code;
        if (code === 1 || code === '1') {
          resolvePromise({ stdout, stderr, exitCode: 1 });
          return;
        }
        Object.assign(error, { stdout, stderr });
        reject(error);
        return;
      }
      resolvePromise({ stdout, stderr, exitCode: 0 });
    });
  });
}

async function readFilePrefix(filePath: string, maxBytes: number): Promise<{ buffer: Buffer; truncated: boolean }> {
  const file = await open(filePath, constants.O_RDONLY);
  try {
    const fileStat = await file.stat();
    const bytesToRead = Math.min(fileStat.size, Math.max(0, maxBytes));
    const buffer = Buffer.alloc(bytesToRead);
    if (bytesToRead > 0) {
      await file.read(buffer, 0, bytesToRead, 0);
    }
    return { buffer, truncated: fileStat.size > bytesToRead };
  } finally {
    await file.close();
  }
}

function createGlobMatcher(pattern: string): (projectRelativePath: string, searchRelativePath: string) => boolean {
  const normalizedPattern = toPosix(pattern);
  const regex = globToRegExp(normalizedPattern);
  const hasSlash = normalizedPattern.includes('/');
  return (projectRelativePath: string, searchRelativePath: string) => {
    const projectRel = toPosix(projectRelativePath);
    const searchRel = toPosix(searchRelativePath);
    const name = basename(projectRel);
    return hasSlash
      ? regex.test(projectRel) || regex.test(searchRel)
      : regex.test(name) || regex.test(projectRel) || regex.test(searchRel);
  };
}

function globToRegExp(pattern: string): RegExp {
  let source = '^';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === '*' && next === '*') {
      const after = pattern[index + 2];
      if (after === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index++;
      }
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    source += escapeRegExp(char);
  }
  source += '$';
  return new RegExp(source);
}

function relativeToSearchRoot(searchRoot: string, absolutePath: string): string {
  return toPosix(relative(searchRoot, absolutePath));
}

function formatListOutput(lines: string[], emptyMessage: string, notices: string[] = []): string {
  const body = lines.length > 0 ? lines.join('\n') : emptyMessage;
  return notices.length > 0 ? `${body}\n\n[${notices.join(' ')}]` : body;
}

function normalizeListType(value: string | undefined): ListType {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'file' || normalized === 'directory') return normalized;
  return 'any';
}

function toProjectPath(projectRoot: string, absolutePath: string): string {
  const rel = relative(projectRoot, absolutePath);
  return rel ? toPosix(rel) : '.';
}

function toPosix(value: string): string {
  return value.split(sep).join('/');
}

function isIgnoredRelative(relativePath: string): boolean {
  if (relativePath === '.') return false;
  return relativePath.split('/').some((part) => IGNORED_DIRS.has(part));
}

function isLikelyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, BINARY_SNIFF_BYTES);
  if (sample.includes(0)) return true;
  let suspicious = 0;
  for (const byte of sample) {
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious++;
  }
  return sample.length > 0 && suspicious / sample.length > 0.3;
}

function looksLikeGlob(path: string): boolean {
  return /[*?[\]{}]/u.test(path);
}

function truncateLine(value: string, maxLength = 240): string {
  const normalized = value.replace(/\t/g, '  ');
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 15)}... [truncated]`;
}

function clampInteger(value: number | undefined, defaultValue: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return defaultValue;
  return Math.min(max, Math.max(min, Math.floor(value)));
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

function pickBoolean(record: RecordValue, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
      if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    }
  }
  return undefined;
}

function pickStringArray(record: RecordValue, keys: string[]): string[] | undefined {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      const values = value.filter((item): item is string => typeof item === 'string');
      if (values.length > 0) return values;
    }
    if (typeof value === 'string') return [value];
  }
  return undefined;
}

function isCommandMissingError(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

function enhanceSearchError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error([
    message,
    '',
    'Student Agent search_files hint:',
    '- Narrow path or glob if the search is too broad.',
    '- Use glob for filename matching and read/read_many for exact files.',
  ].join('\n'), { cause: err instanceof Error ? err : undefined });
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$+?.()|[\]{}]/g, '\\$&');
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
