/**
 * Reflect Hook — 会话结束后异步运行 ReflectAgent。
 * 挂载到 Pi 的 agent_end 事件。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import { ReflectAgent } from '../../reflect/reflect-agent.js';
import { PreferenceCandidatesManager } from '../../memory/candidates/manager.js';
import { PreferencesManager } from '../../memory/preferences/manager.js';
import { LessonsManager } from '../../memory/lessons/index.js';
import { KnacksManager } from '../../memory/knacks/index.js';
import { BreakerLogManager } from '../../reflect/breaker-log-manager.js';
import {
  buildOperationEvidence,
  buildVerificationEvidence,
  type ToolCallRecord,
} from '../../memory/distill/tool-evidence.js';
import type { PostToolCallContext, SessionEndContext } from '../../core/pi-bridge/types.js';
import { safeStdout } from '../../runtime/logger.js';

let taskCount = 0;
let baselineRef = 'HEAD';
/** Per-task tool trace; feeds the same lesson evidence builders the eval runner uses. */
let toolTrace: ToolCallRecord[] = [];

export interface CollectTaskDiffOptions {
  cwd?: string;
  execGit?: (args: string[], cwd: string) => string;
  readFile?: (path: string) => string;
}

/**
 * 创建 reflect hook。
 * 返回可直接传给 StudentAgentHooks.onSessionEnd 的函数。
 *
 * 在每次 agent_end 事件后异步运行 ReflectAgent：
 *   1. 从 git diff 中提取行为模式
 *   2. 写入 preference-candidates
 *   3. 满足条件时升级为正式 preference
 */
export function createReflectHook(
  memoryDir: string,
  taskDescription: () => string,
  options: {
    boundedBreakerEnabled?: boolean;
    onSummary?: (summary: { patternsExtracted: number; promotedCount: number }) => void;
  } = {},
) {
  return async (_ctx: SessionEndContext): Promise<void> => {
    taskCount++;

    const agent = new ReflectAgent(
      PreferenceCandidatesManager.getInstance(memoryDir),
      PreferencesManager.getInstance(memoryDir),
      options.boundedBreakerEnabled === false ? null : undefined,
      new BreakerLogManager(memoryDir),
      LessonsManager.getInstance(memoryDir),
      KnacksManager.getInstance(memoryDir),
    );

    const gitDiff = collectTaskDiff(baselineRef);

    const result = await agent.run({
      taskId: `task_${Date.now()}`,
      sessionRef: `session_${Date.now()}`,
      taskDescription: taskDescription(),
      gitDiff,
      totalTaskCount: taskCount,
      lessonVerificationEvidence: buildVerificationEvidence(toolTrace),
      lessonOperationEvidence: buildOperationEvidence(toolTrace),
    });

    if (result.patternsExtracted > 0) {
      const summary = {
        patternsExtracted: result.patternsExtracted,
        promotedCount: result.promoted.length,
      };
      options.onSummary?.(summary);
      emitReflectSummary(summary);
    }
  };
}

function emitReflectSummary(summary: { patternsExtracted: number; promotedCount: number }): void {
  safeStdout(chalk.dim(`  [Reflect] 提取 ${summary.patternsExtracted} 个模式，升级 ${summary.promotedCount} 条偏好\n`));
}

export const emitReflectSummaryForTesting = emitReflectSummary;

/** 标记一次用户任务开始前的 git 基线，用于会话结束后提取本次任务 diff。 */
export function markReflectBaseline(): void {
  baselineRef = createTrackedWorktreeRef();
  toolTrace = [];
}

/** 记录一次工具调用，供会话结束后构造 lesson 证据。 */
export function recordReflectToolCall(ctx: PostToolCallContext): void {
  toolTrace.push({
    id: ctx.toolCallId,
    name: ctx.toolName,
    args: ctx.args,
    endedAt: new Date().toISOString(),
    isError: ctx.isError,
  });
}

/** 收集本次任务 diff：基线、暂存区、未暂存改动，以及 untracked 文件。 */
export function collectTaskDiff(baseRef: string, options: CollectTaskDiffOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const execGit = options.execGit ?? defaultExecGit;
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf-8'));

  return [
    gitDiff(['diff', '--binary', baseRef, '--'], cwd, execGit),
    gitDiff(['diff', '--cached', '--binary', '--'], cwd, execGit),
    gitDiff(['diff', '--binary', '--'], cwd, execGit),
    collectUntrackedDiff(cwd, execGit, readFile),
  ].filter(Boolean).join('\n');
}

function gitDiff(
  args: string[],
  cwd: string,
  execGit: (args: string[], cwd: string) => string,
): string {
  try {
    return execGit(args, cwd);
  } catch {
    return '';
  }
}

function collectUntrackedDiff(
  cwd: string,
  execGit: (args: string[], cwd: string) => string,
  readFile: (path: string) => string,
): string {
  const files = listUntrackedFiles(cwd, execGit);
  return files.map((path) => renderUntrackedFileDiff(cwd, path, readFile)).filter(Boolean).join('\n');
}

function listUntrackedFiles(
  cwd: string,
  execGit: (args: string[], cwd: string) => string,
): string[] {
  try {
    const raw = execGit(['ls-files', '--others', '--exclude-standard'], cwd);
    return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function renderUntrackedFileDiff(
  cwd: string,
  path: string,
  readFile: (path: string) => string,
): string {
  try {
    const content = readFile(`${cwd}/${path}`);
    const lines = content.split(/\r?\n/);
    return [
      `diff --git a/${path} b/${path}`,
      'new file mode 100644',
      'index 0000000..0000000',
      '--- /dev/null',
      `+++ b/${path}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
    ].join('\n');
  } catch {
    return '';
  }
}

function defaultExecGit(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    timeout: 5000,
  });
}

function createTrackedWorktreeRef(): string {
  try {
    const ref = execFileSync('git', ['stash', 'create'], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    return ref || 'HEAD';
  } catch {
    return 'HEAD';
  }
}

/** 仅测试用：重置任务计数 */
export function _resetForTesting(): void {
  taskCount = 0;
  baselineRef = 'HEAD';
  toolTrace = [];
}
