/**
 * ToolGuard Hook — 拦截五类异常工具调用：
 *   1. Empty bash: 空/纯空格的 shell 命令
 *   2. NL bash: 自然语言被误当作 shell 命令
 *   3. Broad glob: 过于宽泛的 glob 模式（缺少目录前缀）
 *   4. Patch retry: 未重新读取就重复编辑同一文件
 *   5. Verify retry: 无编辑时反复运行同类失败验证
 *
 * 每次拦截同时 emit ProtectedEvalEvent 供离线审计。
 */

import type {
  PostToolCallContext,
  PreToolCallContext,
  PreToolCallDecision,
} from '../../core/pi-bridge/types.js';
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

// ── 验证命令 ──────────────────────────────────────────

const DIRECT_VALIDATION_COMMANDS = new Set([
  "jest",
  "py.test",
  "py_compile",
  "pytest",
  "tsc",
  "vitest",
]);
const PACKAGE_MANAGERS = new Set(["bun", "npm", "pnpm", "yarn"]);
const VALIDATION_TASK_RE = /^(?:build|check|compile|lint|test|typecheck|verify)(?::|$)/;
const COMMAND_VALIDATION_TASKS = new Set([
  "build",
  "check",
  "clippy",
  "compile",
  "lint",
  "package",
  "test",
  "verify",
  "vet",
]);
const PYTHON_COMMAND_RE = /^python(?:\d+(?:\.\d+)*)?$/;
const PYTHON_VALIDATION_MODULES = new Set(["compileall", "py_compile", "pytest", "unittest"]);

// ── 类型 ─────────────────────────────────────────────

export interface ToolGuard {
  hook: (ctx: PreToolCallContext) => Promise<PreToolCallDecision | undefined>;
  observeResult: (ctx: PostToolCallContext) => void;
  reset: () => void;
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

function commandTokens(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

function validationClass(command: string): string | undefined {
  const tokens = commandTokens(command);
  const firstToken = tokens[0]?.replace(/^.*[/\\]/, "");
  if (!firstToken) return undefined;

  if (DIRECT_VALIDATION_COMMANDS.has(firstToken)) {
    return firstToken;
  }

  if (PACKAGE_MANAGERS.has(firstToken)) {
    const task = tokens[1] === "run" ? tokens[2] : tokens[1];
    return task && VALIDATION_TASK_RE.test(task) ? firstToken : undefined;
  }

  if (firstToken === "npx") {
    const executable = tokens[1]?.replace(/^.*[/\\]/, "");
    return executable && DIRECT_VALIDATION_COMMANDS.has(executable)
      ? firstToken
      : undefined;
  }

  if (PYTHON_COMMAND_RE.test(firstToken)) {
    const moduleFlagIndex = tokens.indexOf("-m");
    const moduleName = moduleFlagIndex >= 0 ? tokens[moduleFlagIndex + 1] : undefined;
    if (moduleName && PYTHON_VALIDATION_MODULES.has(moduleName)) {
      return firstToken;
    }
  }

  if (["cargo", "dotnet", "go", "make", "mvn", "mvnw"].includes(firstToken)) {
    return tokens.slice(1).some((token) => COMMAND_VALIDATION_TASKS.has(token))
      ? firstToken
      : undefined;
  }

  if (firstToken === "gradle" || firstToken === "gradlew") {
    return tokens.slice(1).some((token) => VALIDATION_TASK_RE.test(token))
      ? firstToken
      : undefined;
  }

  return undefined;
}

// ── 工厂函数 ──────────────────────────────────────────

export function createToolGuardHook(): ToolGuard {
  let lastEditPath: string | null = null;
  let recentReads: Set<string> = new Set();
  let validationFailures = new Map<string, number>();

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

      const verifyClass = validationClass(command);
      const failureCount = verifyClass
        ? validationFailures.get(verifyClass) ?? 0
        : 0;
      if (verifyClass && failureCount >= 3) {
        return block(
          "[ToolGuard:verify_retry] 同类验证已连续失败 3 次且期间没有文件编辑。请更换验证策略，或记录环境阻塞后继续。",
          "verify_retry",
          ctx,
          {
            command,
            validationClass: verifyClass,
            consecutiveFailures: String(failureCount),
          },
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
        recentReads.clear();
        return block(
          "[ToolGuard:patch_retry] 未重新读取就重复编辑同一文件已阻断。请先 re-read 文件再重试编辑。",
          "patch_retry",
          ctx,
          { path: editPath },
        );
      }

      lastEditPath = editPath;
      validationFailures.clear();
    }

    return undefined;
  };

  const observeResult = (ctx: PostToolCallContext) => {
    if (!SHELL_TOOLS.has(ctx.toolName.toLowerCase())) return;

    const command = extractCommand(ctx.args);
    if (!command) return;

    const verifyClass = validationClass(command);
    if (!verifyClass) return;

    if (ctx.isError) {
      validationFailures.set(
        verifyClass,
        (validationFailures.get(verifyClass) ?? 0) + 1,
      );
      return;
    }

    validationFailures.delete(verifyClass);
  };

  const reset = () => {
    lastEditPath = null;
    recentReads = new Set();
    validationFailures = new Map();
  };

  return { hook, observeResult, reset };
}
