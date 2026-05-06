/**
 * Snapshot Hook — 在每次工具调用前创建 git 快照。
 * 挂载到 Pi 的 beforeToolCall 钩子。
 *
 * SnapshotManager 原封不动复用阶段一代码，仅适配 Pi 的钩子接口。
 */

import { SnapshotManager } from '../../core/executor/snapshot.js';
import type { PreToolCallContext, PreToolCallDecision } from '../../core/pi-bridge/types.js';

/** 最近一次快照 ID，供失败升级时回滚使用 */
let lastSnapshotId: string | null = null;

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
    } catch (err) {
      const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : '';
      const message = err instanceof Error ? err.message : String(err);
      lastSnapshotId = null;
      const warnKey = cause || message;
      if (!warnedMessages.has(warnKey)) {
        warnedMessages.add(warnKey);
        console.warn(`[Snapshot] ${warnKey}（快照已跳过，无法回滚。输入 /init 可初始化 git 仓库）`);
      }
      return undefined;
    }

    return undefined;
  };
}

export function requiresSnapshot(ctx: PreToolCallContext): boolean {
  const toolName = ctx.toolName.toLowerCase();

  if (READ_ONLY_TOOL_NAMES.has(toolName)) {
    return false;
  }

  if (WRITE_TOOL_NAMES.has(toolName) || WRITE_TOOL_PATTERNS.some((pattern) => pattern.test(toolName))) {
    return true;
  }

  if (argsMayWrite(ctx.args)) {
    return true;
  }

  if (argsClearlyReadOnly(ctx.args)) {
    return false;
  }

  return true;
}

/** 获取最近一次快照 ID */
export function getLastSnapshotId(): string | null {
  return lastSnapshotId;
}

/** 回滚到指定快照 */
export async function restoreSnapshot(cwd: string, snapshotId: string): Promise<void> {
  const manager = ensureManager(cwd);
  await manager.restore(snapshotId);
  if (lastSnapshotId === snapshotId) {
    lastSnapshotId = null;
  }
}

/** 仅测试用：重置模块状态 */
export function _resetForTesting(): void {
  snapshotManager = null;
  lastSnapshotId = null;
}

const READ_ONLY_TOOL_NAMES = new Set([
  'read',
  'read_file',
  'grep',
  'glob',
  'list',
  'ls',
  'find',
  'search',
  'context7',
  'context7_query',
  'get-library-docs',
  'resolve-library-id',
]);

const WRITE_TOOL_NAMES = new Set([
  'write',
  'write_file',
  'edit',
  'edit_file',
  'apply_patch',
  'delete_file',
  'remove_file',
  'move_file',
  'rename_file',
  'mkdir',
  'touch',
  'exec_command',
  'bash',
  'shell',
  'terminal',
]);

const WRITE_TOOL_PATTERNS = [
  /(^|[_-])(write|edit|patch|delete|remove|move|rename|mkdir|touch)([_-]|$)/,
];

function argsMayWrite(args: unknown): boolean {
  const text = stringifyArgs(args).toLowerCase();
  return /\b(rm|mv|cp|mkdir|touch|chmod|chown|npm\s+install|pnpm\s+install|yarn\s+add|git\s+(commit|merge|rebase|reset|checkout|apply|am))\b/.test(text)
    || />{1,2}/.test(text);
}

function argsClearlyReadOnly(args: unknown): boolean {
  const text = stringifyArgs(args).toLowerCase();
  if (!text.trim()) {
    return false;
  }
  return /\b(cat|grep|rg|find|ls|pwd|git\s+(status|diff|log|show)|select)\b/.test(text);
}

function stringifyArgs(args: unknown): string {
  if (typeof args === 'string') {
    return args;
  }
  if (args === null || args === undefined) {
    return '';
  }

  try {
    return JSON.stringify(args);
  } catch {
    return '';
  }
}
