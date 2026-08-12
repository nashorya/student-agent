/**
 * Snapshot Hook — 在每次工具调用前创建 git 快照。
 * 挂载到 Pi 的 beforeToolCall 钩子。
 *
 * SnapshotManager 原封不动复用阶段一代码，仅适配 Pi 的钩子接口。
 */

import { SnapshotManager } from '../../core/executor/snapshot.js';
import type { PreToolCallContext, PreToolCallDecision } from '../../core/pi-bridge/types.js';
import { logger } from '../../runtime/logger.js';

/** 最近一次快照 ID，供失败升级时回滚使用 */
let lastSnapshotId: string | null = null;

/** 工具调用 ID 到快照 ID 的映射，避免失败时回滚到其他工具的快照。 */
const snapshotIdsByToolCall = new Map<string, string>();

let snapshotManager: SnapshotManager | null = null;

/** 已打印过的警告，避免重复刷屏 */
const warnedMessages = new Set<string>();

/** 初始化 SnapshotManager（延迟创建，首次调用时实例化） */
function ensureManager(cwd: string): SnapshotManager {
  if (!snapshotManager) {
    snapshotManager = new SnapshotManager(cwd);
  }
  return snapshotManager;
}

/**
 * 创建 snapshot hook。
 * 返回一个可直接传给 StudentAgentHooks.onBeforeToolCall 的函数。
 */
export function createSnapshotHook(cwd: string) {
  return async (ctx: PreToolCallContext): Promise<PreToolCallDecision | undefined> => {
    if (!requiresSnapshot(ctx)) {
      return undefined;
    }

    const manager = ensureManager(cwd);
    try {
      lastSnapshotId = await manager.create();
      snapshotIdsByToolCall.set(ctx.toolCallId, lastSnapshotId);
    } catch (err) {
      lastSnapshotId = null;
      const warnKey = snapshotWarnKey(err);
      if (!warnedMessages.has(warnKey)) {
        warnedMessages.add(warnKey);
        logger.warn(`[Snapshot] ${warnKey}（快照已跳过，无法回滚。输入 /init 可初始化 git 仓库）`);
      }
      return undefined;
    }

    return undefined;
  };
}

export function requiresSnapshot(ctx: PreToolCallContext): boolean {
  return toolMayMutate(ctx.toolName, ctx.args);
}

export function toolMayMutate(toolName: string, args: unknown): boolean {
  const normalizedToolName = normalizeToolName(toolName);

  if (isReadOnlyTool(normalizedToolName)) {
    return false;
  }

  if (isWriteTool(normalizedToolName)) {
    return true;
  }

  if (SHELL_TOOL_NAMES.has(normalizedToolName)) {
    return argsClearlyIndicateWrite(args);
  }

  return argsClearlyIndicateWrite(args);
}

/** 获取最近一次快照 ID */
export function getLastSnapshotId(toolCallId?: string): string | null {
  if (toolCallId) {
    return snapshotIdsByToolCall.get(toolCallId) ?? null;
  }
  return lastSnapshotId;
}

/** 回滚到指定快照 */
export async function restoreSnapshot(cwd: string, snapshotId: string): Promise<void> {
  const manager = ensureManager(cwd);
  await manager.restore(snapshotId);
  if (lastSnapshotId === snapshotId) {
    lastSnapshotId = null;
  }
  for (const [toolCallId, id] of snapshotIdsByToolCall.entries()) {
    if (id === snapshotId) {
      snapshotIdsByToolCall.delete(toolCallId);
    }
  }
}

/** 仅测试用：重置模块状态 */
export function _resetForTesting(): void {
  snapshotManager = null;
  lastSnapshotId = null;
  snapshotIdsByToolCall.clear();
  warnedMessages.clear();
}

const READ_ONLY_TOOL_NAMES = new Set([
  'read',
  'read_file',
  'cat',
  'grep',
  'rg',
  'ripgrep',
  'glob',
  'list',
  'ls',
  'find',
  'search',
  'context7',
  'context7_query',
  'get-library-docs',
  'get_library_docs',
  'resolve-library-id',
  'resolve_library_id',
  'context_docs',
  'docs',
]);

const WRITE_TOOL_NAMES = new Set([
  'write',
  'write_file',
  'edit',
  'edit_file',
  'apply_patch',
  'patch',
  'delete_file',
  'remove_file',
  'move_file',
  'rename_file',
  'create_file',
  'mkdir',
  'touch',
]);

const SHELL_TOOL_NAMES = new Set([
  'exec_command',
  'bash',
  'shell',
  'terminal',
]);

const WRITE_TOOL_PATTERNS = [
  /(^|[_-])(write|edit|patch|delete|remove|move|rename|create|mkdir|touch)([_-]|$)/,
  /^(str_replace_editor|notebook_edit)$/,
];

const COMMAND_ARG_KEYS = new Set(['cmd', 'command', 'script']);
const CONTENT_ARG_KEYS = new Set(['content', 'contents', 'newtext', 'oldtext', 'replacement']);
const PATCH_ARG_KEYS = new Set(['patch', 'diff']);
const MUTATING_ACTION_VALUES = /^(write|edit|patch|delete|remove|move|rename|create|mkdir|touch|update|upsert)$/i;

function isReadOnlyTool(toolName: string): boolean {
  return READ_ONLY_TOOL_NAMES.has(toolName)
    || /^mcp__context7__/.test(toolName)
    || /^context(7)?[_-]/.test(toolName);
}

function isWriteTool(toolName: string): boolean {
  return WRITE_TOOL_NAMES.has(toolName)
    || WRITE_TOOL_PATTERNS.some((pattern) => pattern.test(toolName));
}

function argsClearlyIndicateWrite(args: unknown): boolean {
  const command = extractCommand(args);
  if (command) {
    return commandLikelyMutates(command);
  }

  return objectArgsClearlyIndicateWrite(args);
}

function objectArgsClearlyIndicateWrite(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => objectArgsClearlyIndicateWrite(item));
  }

  if (!isRecord(value)) {
    return false;
  }

  if (hasPathAndWritePayload(value) || hasPatchPayload(value)) {
    return true;
  }

  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = normalizeArgKey(key);
    if (isMutatingActionArg(normalizedKey, item)) {
      return true;
    }
    if (Array.isArray(item) || isRecord(item)) {
      if (objectArgsClearlyIndicateWrite(item)) {
        return true;
      }
    }
  }

  return false;
}

function hasPathAndWritePayload(obj: Record<string, unknown>): boolean {
  const keys = new Set(Object.keys(obj).map(normalizeArgKey));
  const hasPath = keys.has('path') || keys.has('filepath') || keys.has('file');
  const hasContent = [...CONTENT_ARG_KEYS].some((key) => keys.has(key));
  return hasPath && hasContent;
}

function hasPatchPayload(obj: Record<string, unknown>): boolean {
  return Object.entries(obj).some(([key, value]) => {
    const normalizedKey = normalizeArgKey(key);
    if (!PATCH_ARG_KEYS.has(normalizedKey)) {
      return false;
    }
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function isMutatingActionArg(key: string, value: unknown): boolean {
  if (['action', 'operation', 'op', 'mode', 'type'].includes(key) && typeof value === 'string') {
    return MUTATING_ACTION_VALUES.test(value);
  }
  if (['write', 'edit', 'delete', 'remove', 'rename', 'move', 'create', 'update', 'upsert'].includes(key)) {
    return value !== false && value !== null && value !== undefined;
  }
  return false;
}

function extractCommand(args: unknown): string | null {
  if (typeof args === 'string') {
    return args.trim() || null;
  }
  if (!isRecord(args)) {
    return null;
  }
  for (const key of COMMAND_ARG_KEYS) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function commandLikelyMutates(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return mutatingCommandRegexes.some((pattern) => pattern.test(normalized));
}

const mutatingCommandRegexes = [
  /\b(rm|mv|cp|mkdir|touch|chmod|chown|ln|truncate)\b/,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|remove|uninstall)\b/,
  /\bgit\s+(?:add|commit|merge|rebase|reset|checkout|switch|restore|apply|am|stash|clean)\b/,
  /\b(?:sed|perl)\b(?=[^;&|]*\s-[A-Za-z]*i[A-Za-z]*\b)/,
  /\b(?:prettier|eslint)\b(?=[^;&|]*(?:--write|--fix)\b)/,
  /\b(?:apply_patch|patch)\b/,
  /(?:^|\s)(?:\d*)>>?\s*(?!&\d\b|\/dev\/null\b)(?:['"]?)[^'"&;|\s]+/,
  /(?:^|\s)&>\s*(?!\/dev\/null\b)(?:['"]?)[^'"&;|\s]+/,
  /\btee\s+(?:-a\s+)?(?!\/dev\/null\b)\S+/,
];

function snapshotWarnKey(err: unknown): string {
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : null;
  const directCode = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
  const code = directCode ?? (cause ? (cause as NodeJS.ErrnoException).code : undefined);
  if (code) {
    return code;
  }

  const message = cause?.message ?? (err instanceof Error ? err.message : String(err));
  return message.split('\n')[0] ?? message;
}

function normalizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase();
}

function normalizeArgKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
