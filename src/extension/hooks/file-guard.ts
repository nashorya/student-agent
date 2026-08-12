/**
 * FileGuard Hook — 在 beforeToolCall 阶段拦截过于宽泛的文件操作。
 *
 * 两种模式：
 *   planning  规划阶段：read 上限 3 次，连续 block 会持续给出软拒绝
 *   normal    执行阶段：read 上限 15 次，连续 block 会持续给出软拒绝
 *
 * 拦截规则：
 *   1. 除 coding-agent README 外，任何工具访问 pi-mono/ → block
 *   2. 列举类工具（ls/glob/find）目标为项目根目录 → block
 *   3. Glob 模式以 ** 开头且无具体目录前缀 → block
 *   4. read 调用超过当前模式限制 → block
 */

import type { PreToolCallContext, PreToolCallDecision } from '../../core/pi-bridge/types.js';
import { emitProtectedEvent } from '../../core/hashline/index.js';

export interface FileGuardOptions {
  planningMaxReads?: number;
  normalMaxReads?: number;
  readWindow?: number;
}

const DEFAULT_OPTIONS = {
  planningMaxReads: 3,
  normalMaxReads: 15,
  readWindow: 30,
} as const;

const LISTING_TOOLS = new Set(['ls', 'list', 'list_directory', 'glob', 'find']);
const READ_TOOLS    = new Set(['read', 'read_file', 'cat']);
const ROOT_PATH_RE  = /^(?:\.\/?)?\s*$|^\/$/;
const BROAD_GLOB_RE = /(?:^|["'\s])(?:\.\/)?(?:\*\*[/\\]|\*\.)/;
const PI_MONO_PATH_RE = /(?:^|["'\s:{,[/\\])pi-mono(?:[/\\]|$)/;
const ALLOWED_PI_MONO_README_RE = /(?:^|["'\s:{,[/\\])pi-mono[/\\]packages[/\\]coding-agent[/\\]README\.md(?:["'\s,}\]]|$)/;

export interface FileGuard {
  hook: (ctx: PreToolCallContext) => Promise<PreToolCallDecision | undefined>;
  reset: () => void;
  setMode: (mode: 'planning' | 'normal') => void;
}

export function createFileGuardHook(_abortRef: { abort: () => void }, options: FileGuardOptions = {}): FileGuard {
  const limits = {
    planningMaxReads: options.planningMaxReads ?? DEFAULT_OPTIONS.planningMaxReads,
    normalMaxReads: options.normalMaxReads ?? DEFAULT_OPTIONS.normalMaxReads,
    readWindow: options.readWindow ?? DEFAULT_OPTIONS.readWindow,
  };
  let mode: 'planning' | 'normal' = 'normal';
  let recentTools: string[] = [];

  function block(reason: string, path?: string | null): PreToolCallDecision {
    emitProtectedEvent({
      source: 'signal',
      type: 'fileguard_block',
      path: path ?? undefined,
      blocked: true,
      provenance: { reason },
    });
    return { block: true, reason };
  }

  const hook = async (ctx: PreToolCallContext): Promise<PreToolCallDecision | undefined> => {
    const argsText = stringifyArgs(ctx.args);
    const toolName = ctx.toolName.toLowerCase();
    recentTools.push(toolName);
    if (recentTools.length > limits.readWindow) {
      recentTools = recentTools.slice(-limits.readWindow);
    }

    const maxReads = mode === 'planning' ? limits.planningMaxReads : limits.normalMaxReads;

    // 规则 1：禁止访问 pi-mono/，但允许查阅 coding-agent README。
    if (PI_MONO_PATH_RE.test(argsText) && !ALLOWED_PI_MONO_README_RE.test(argsText)) {
      return block(
        '[FileGuard] pi-mono/ 是只读参考包，不要直接读取其文件。' +
        '通过 import 使用其导出 API，如需了解能力请查阅 pi-mono/packages/coding-agent/README.md。',
        extractFirstPath(ctx.args) ?? 'pi-mono',
      );
    }

    // 规则 2：列举类工具不得以根目录为目标
    if (LISTING_TOOLS.has(toolName)) {
      const path = extractFirstPath(ctx.args);
      if (path !== null && ROOT_PATH_RE.test(path)) {
        return block(
          '[FileGuard] 禁止列举项目根目录，那里有数千个文件会撑满上下文。' +
          '请指定具体子目录，例如 src/core/ 或 src/cli/。',
          path,
        );
      }
    }

    // 规则 3：glob 模式过于宽泛
    if ((toolName === 'glob' || toolName === 'find') && BROAD_GLOB_RE.test(argsText)) {
      return block(
        '[FileGuard] glob 模式过于宽泛，会扫描数千文件。' +
        '请加上具体目录前缀，例如用 src/core/**/*.ts 而非 **/*.ts。',
        extractFirstPath(ctx.args),
      );
    }

    // 规则 4：read 调用超过本阶段限制
    if (READ_TOOLS.has(toolName)) {
      const readCount = recentTools.filter((name) => READ_TOOLS.has(name)).length;
      if (readCount > maxReads) {
        if (mode === 'planning') {
          return block(
            `[FileGuard] 规划阶段最近 ${limits.readWindow} 次工具调用中已读取 ${readCount} 个文件（上限 ${maxReads}）。` +
            '规划只需查看 CLAUDE.md，请直接输出 TASK_START 计划，不要再读文件。',
            extractFirstPath(ctx.args),
          );
        }
        return block(
          `[FileGuard] 最近 ${limits.readWindow} 次工具调用中已读取 ${readCount} 个文件，超出上限 ${maxReads}。` +
          '停止 read。正确做法：grep "关键词" src/ 定位文件，再只 read 命中的那个文件。',
          extractFirstPath(ctx.args),
        );
      }
    }

    return undefined;
  };

  const reset = () => {
    recentTools = [];
  };

  const setMode = (m: 'planning' | 'normal') => {
    mode = m;
    reset();
  };

  return { hook, reset, setMode };
}

function stringifyArgs(args: unknown): string {
  if (typeof args === 'string') return args;
  if (args === null || args === undefined) return '';
  try { return JSON.stringify(args); } catch { return ''; }
}

function extractFirstPath(args: unknown): string | null {
  if (typeof args === 'string') return args.trim();
  if (Array.isArray(args) && typeof args[0] === 'string') return args[0].trim();
  if (args !== null && typeof args === 'object') {
    const obj = args as Record<string, unknown>;
    for (const key of ['path', 'directory', 'dir', 'pattern', 'file', 'filename']) {
      if (typeof obj[key] === 'string') return (obj[key] as string).trim();
    }
  }
  return null;
}
