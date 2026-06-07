/**
 * ToolGuard Hook — 在 beforeToolCall 阶段拦截四类异常工具调用：
 *   1. Empty bash: 空/纯空格的 shell 命令
 *   2. NL bash: 自然语言被误当作 shell 命令
 *   3. Broad glob: 过于宽泛的 glob 模式（缺少目录前缀）
 *   4. Patch retry: 未重新读取就重复编辑同一文件
 *
 * 每次拦截同时 emit ProtectedEvalEvent 供离线审计。
 */

import type { PreToolCallContext, PreToolCallDecision } from '../../core/pi-bridge/types.js';
import { emitProtectedEvent } from '../../core/hashline/index.js';

// ── 工具名称集合 ─────────────────────────────────────

const SHELL_TOOLS = new Set(["bash", "shell", "terminal", "exec_command"]);
const GLOB_TOOLS = new Set(["glob", "search_files", "find", "list_files"]);
const EDIT_TOOLS = new Set(["edit", "apply_patch"]);
const READ_TOOLS = new Set(["read", "read_file"]);

// ── 自然语言检测模式 ──────────────────────────────────

const NL_BASH_PATTERNS = [
  /^(please|help|can you|could you|i want|i need|let's|show me|tell me|explain)/i,
  /^(创建|删除|修改|查看|帮我|请|运行|执行|打开).{0,5}(一个|这个|那个|文件|目录|项目)/,
];

const SHELL_METACHAR_RE = /[|><;&`$]/;

// ── 宽泛 glob 模式 ────────────────────────────────────

const BROAD_GLOB_PREFIX_RE = /^(?:\.\/)?\*{1,2}[/\\]/;

// ── 类型 ─────────────────────────────────────────────

export interface ToolGuard {
  hook: (ctx: PreToolCallContext) => Promise<PreToolCallDecision | undefined>;
  reset: () => void;
}

interface EditAttempt {
  path: string;
  timestamp: number;
}

// ── 工具函数 ──────────────────────────────────────────

function extractCommand(args: unknown): string | undefined {
  if (args === null || args === undefined) return undefined;
  if (typeof args === "object" && args !== null) {
    const obj = args as Record<string, unknown>;
    if (typeof obj.command === "string") return obj.command;
  }
  if (typeof args === "string") return args;
  return undefined;
}

function extractPath(args: unknown): string | undefined {
  if (args === null || args === undefined) return undefined;
  if (typeof args === "object" && args !== null) {
    const obj = args as Record<string, unknown>;
    for (const key of ["path", "file_path", "filePath", "pattern", "glob"]) {
      if (typeof obj[key] === "string") return obj[key] as string;
    }
  }
  if (typeof args === "string") return args;
  return undefined;
}

function extractGlobPattern(args: unknown): string | undefined {
  if (args === null || args === undefined) return undefined;
  if (typeof args === "object" && args !== null) {
    const obj = args as Record<string, unknown>;
    for (const key of ["pattern", "glob", "query"]) {
      if (typeof obj[key] === "string") return obj[key] as string;
    }
  }
  return undefined;
}

function isNlBash(command: string): boolean {
  // Pattern 1: starts with natural language phrases
  for (const re of NL_BASH_PATTERNS) {
    if (re.test(command.trim())) return true;
  }

  // Pattern 2: no shell metacharacters AND 5+ space-separated words AND none look like flags or paths
  if (!SHELL_METACHAR_RE.test(command)) {
    const words = command.trim().split(/\s+/);
    if (words.length >= 5) {
      const noneLookLikeFlagsOrPaths = words.every(
        (w) => !w.startsWith("-") && !w.startsWith("/") && !w.startsWith("./"),
      );
      if (noneLookLikeFlagsOrPaths) return true;
    }
  }

  return false;
}

// ── 工厂函数 ──────────────────────────────────────────

export function createToolGuardHook(): ToolGuard {
  let lastEditPath: string | null = null;
  let lastEditBlocked: boolean = false;
  let recentReads: Set<string> = new Set();
  let recentFailures: EditAttempt[] = [];

  function block(
    reason: string,
    ruleName: string,
    ctx: PreToolCallContext,
    extra?: Record<string, string>,
  ): PreToolCallDecision {
    emitProtectedEvent({
      source: "toolguard",
      type: "block",
      path: extractPath(ctx.args) ?? "",
      ruleName,
      evidenceRef: ctx.toolCallId,
      blocked: true,
      provenance: { ruleName, ...extra },
    });
    return { block: true, reason };
  }

  const hook = async (ctx: PreToolCallContext): Promise<PreToolCallDecision | undefined> => {
    const toolName = ctx.toolName.toLowerCase();

    // ── Track reads ─────────────────────────────────
    if (READ_TOOLS.has(toolName)) {
      const readPath = extractPath(ctx.args);
      if (readPath) {
        recentReads.add(readPath);
      }
    }

    // ── Rule 1: Empty bash ──────────────────────────
    if (SHELL_TOOLS.has(toolName)) {
      const command = extractCommand(ctx.args);
      if (command === undefined || command.trim() === "") {
        return block(
          "[ToolGuard:empty_bash] 空命令已阻断。请提供具体的 shell 命令。",
          "empty_bash",
          ctx,
          { command: command ?? "" },
        );
      }

      // ── Rule 2: Natural language bash ────────────────
      if (isNlBash(command)) {
        return block(
          "[ToolGuard:nl_bash] 自然语言命令已阻断。bash 工具只接受 shell 命令，不是自然语言描述。",
          "nl_bash",
          ctx,
          { command },
        );
      }
    }

    // ── Rule 3: Broad glob ───────────────────────────
    if (GLOB_TOOLS.has(toolName)) {
      const pattern = extractGlobPattern(ctx.args);
      if (pattern && BROAD_GLOB_PREFIX_RE.test(pattern)) {
        return block(
          "[ToolGuard:broad_glob] 过于宽泛的 glob 模式已阻断。请添加具体目录前缀，例如 src/core/**/*.ts 而非 **/*.ts。",
          "broad_glob",
          ctx,
          { pattern },
        );
      }
    }

    // ── Rule 4: Patch retry without re-read ─────────
    if (EDIT_TOOLS.has(toolName)) {
      const editPath = extractPath(ctx.args) ?? "";

      if (
        editPath
        && editPath === lastEditPath
        && !recentReads.has(editPath)
      ) {
        lastEditBlocked = true;
        recentReads.clear();
        return block(
          "[ToolGuard:patch_retry] 未重新读取就重复编辑同一文件已阻断。请先 re-read 文件再重试编辑。",
          "patch_retry",
          ctx,
          { path: editPath },
        );
      }

      lastEditPath = editPath;
      lastEditBlocked = false;
    }

    return undefined;
  };

  const reset = () => {
    lastEditPath = null;
    lastEditBlocked = false;
    recentReads = new Set();
    recentFailures = [];
  };

  return { hook, reset };
}