/**
 * Failure Escalation Hook — 三级失败升级阶梯。
 * 统一收敛在此文件中，挂载到 Pi 的 afterToolCall 钩子。
 *
 * 阶梯：
 *   Attempt 1：降级/拆分/复位 → 注入恢复指令，不停止
 *   Attempt 2：Context7 文档注入 → 注入检索结果，不停止
 *   Attempt 3：中断 + 诊断报告   → terminate: true
 */

import type { PostToolCallContext, EscalationDecision } from '../../core/pi-bridge/types.js';
import { classifyError, type ClassifiedError } from '../../core/state-machine/error-classifier.js';
import { renderDiagnosticReport, type DiagnosticInput } from '../../core/state-machine/diagnostic-reporter.js';
import type { AttemptRecord, ErrorCategory } from '../../core/state-machine/types.js';
import type { Context7Client, Context7DocsResult } from '../../knowledge/context7-client.js';
import { QuestionsManager } from '../../memory/questions/manager.js';
import type { Question } from '../../memory/questions/types.js';
import { getProjectMemoryDir } from '../../core/paths.js';
import { toolMayMutate } from './snapshot.js';
import { t } from '../../core/i18n/messages.js';

// 这些工具的失败通常是探测未命中，不应触发失败升级。
const READONLY_TOOLS = new Set([
  'read',
  'read_file',
  'cat',
  'grep',
  'ripgrep',
  'rg',
  'ls',
  'list',
  'find',
  'search',
  'context7',
  'context7_query',
  'get-library-docs',
  'resolve-library-id',
]);

type RollbackStatus =
  | { state: 'success'; snapshotId: string }
  | { state: 'failed'; snapshotId: string; reason: string }
  | { state: 'unavailable' };

export interface FailureEscalationOptions {
  context7Client?: Pick<Context7Client, 'query'>;
  memoryDir?: string;
  /** 获取最近一次快照 ID 的回调 */
  getLastSnapshotId?: (toolCallId?: string) => string | null;
  /** 回滚到指定快照的回调 */
  restoreSnapshot?: (cwd: string, snapshotId: string) => Promise<void>;
}

/**
 * 会话级失败升级上下文。
 * 每个任务会话创建独立实例，不共享模块级全局状态。
 */
export class FailureEscalationContext {
  private consecutiveFailures = 0;
  private attempts: AttemptRecord[] = [];
  private taskDescription = '';
  private cwd = '';
  private pendingQuestion: Question | null = null;
  private readonly context7Client?: Pick<Context7Client, 'query'>;
  private readonly memoryDir: string;
  private readonly getLastSnapshotId: (toolCallId?: string) => string | null;
  private readonly restoreSnapshotFn: (cwd: string, snapshotId: string) => Promise<void>;

  constructor(options: FailureEscalationOptions = {}) {
    this.context7Client = options.context7Client;
    this.memoryDir = options.memoryDir ?? getProjectMemoryDir();
    this.getLastSnapshotId = options.getLastSnapshotId ?? (() => null);
    this.restoreSnapshotFn = options.restoreSnapshot ?? (async () => {});
  }

  /** 每次新任务开始时调用，重置连续失败计数和尝试记录。 */
  initTask(taskDesc: string, workingDir: string): void {
    this.consecutiveFailures = 0;
    this.attempts = [];
    this.taskDescription = taskDesc;
    this.cwd = workingDir;
    this.pendingQuestion = null;
  }

  /** 取出待回答问题（取后清空），供 REPL 展示给用户。 */
  takePendingQuestion(): Question | null {
    const q = this.pendingQuestion;
    this.pendingQuestion = null;
    return q;
  }

  /**
   * 创建失败升级 hook。
   * 返回一个可直接传给 StudentAgentHooks.onAfterToolCall 的函数。
   *
   * 只在真正的工具执行错误（isError === true）时介入。
   * 任意工具成功都代表工具链路已恢复，重置连续失败计数。
   */
  createHook() {
    return async (ctx: PostToolCallContext): Promise<EscalationDecision | undefined> => {
      if (!ctx.isError) {
        this.consecutiveFailures = 0;
        return undefined;
      }

      if (isSoftToolBlock(ctx)) {
        return undefined;
      }

      if (isReadOnlyProbeFailure(ctx)) {
        return {
          overrideContent: buildReadOnlyProbeResult(ctx),
          isError: false,
          terminate: false,
        };
      }

      this.consecutiveFailures++;

      const classified = classifyError(
        new Error(ctx.resultText),
        ctx.toolName,
      );

      if (this.consecutiveFailures === 1) {
        return this.handleAttempt1(ctx, classified);
      } else if (this.consecutiveFailures === 2) {
        return this.handleAttempt2(ctx, classified);
      } else {
        return this.handleAttempt3(ctx, classified);
      }
    };
  }

  // ── Attempt 1：降级/拆分/复位 ──────────────────────

  private async handleAttempt1(
    ctx: PostToolCallContext,
    classified: ClassifiedError,
  ): Promise<EscalationDecision> {
    const snapshotId = this.getLastSnapshotId(ctx.toolCallId);
    let rollback: RollbackStatus = { state: 'unavailable' };
    if (snapshotId && this.cwd && shouldRollback(ctx, classified)) {
      try {
        await this.restoreSnapshotFn(this.cwd, snapshotId);
        rollback = { state: 'success', snapshotId };
      } catch (err) {
        rollback = {
          state: 'failed',
          snapshotId,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
    }

    const record: AttemptRecord = {
      index: 1,
      strategy: selectStrategy(classified.category),
      result: 'failed',
      reason: classified.message,
    };
    this.attempts.push(record);

    const recoveryInstructions = buildRecoveryInstructions(classified, rollback);

    return {
      overrideContent: recoveryInstructions,
      isError: true,
      terminate: false,
    };
  }

  // ── Attempt 2：Context7 文档注入 ───────────────────

  private async handleAttempt2(
    ctx: PostToolCallContext,
    classified: ClassifiedError,
  ): Promise<EscalationDecision> {
    const record: AttemptRecord = {
      index: 2,
      strategy: classified.subtype === 'edit-exact-text-mismatch'
        ? 'reread_target_and_patch'
        : 'context7_docs',
      result: 'failed',
      reason: classified.message,
    };
    this.attempts.push(record);

    if (classified.subtype === 'edit-exact-text-mismatch') {
      return {
        overrideContent: buildEditMismatchRecovery(classified, ctx),
        isError: true,
        terminate: false,
      };
    }

    if (!shouldQueryContext7ForToolFailure(ctx, classified)) {
      return {
        overrideContent: buildSecondFailureRecovery(classified),
        isError: true,
        terminate: false,
      };
    }

    const context = await buildContext7Context(ctx, classified, this.taskDescription, this.context7Client);

    return {
      overrideContent: context,
      isError: true,
      terminate: false,
    };
  }

  // ── Attempt 3：中断 + 诊断报告 + 提问 ──────────────

  private async handleAttempt3(
    ctx: PostToolCallContext,
    classified: ClassifiedError,
  ): Promise<EscalationDecision> {
    const record: AttemptRecord = {
      index: 3,
      strategy: 'diagnostic_report',
      result: 'failed',
      reason: classified.message,
    };
    this.attempts.push(record);

    const diagnosticInput: DiagnosticInput = {
      taskDescription: this.taskDescription,
      attempts: this.attempts,
      errorCategory: classified.category,
      errorSubtype: classified.subtype,
      rawError: ctx.resultText.slice(0, 500),
    };

    const report = renderDiagnosticReport(diagnosticInput);

    const question: Question = {
      id: `q_${Date.now()}`,
      error_type: classified.category,
      error_subtype: classified.subtype,
      context: t('escalation.question_context', {
        taskDescription: this.taskDescription,
        category: classified.category,
        subtype: classified.subtype,
        message: classified.message,
      }),
      attempts: this.attempts.map((a) => ({
        strategy: a.strategy,
        result: t('escalation.attempt_result') as '失败',
        reason: a.reason,
      })),
      status: 'unverified',
      hit_count: 1,
      last_hit: new Date().toISOString(),
      provenance: {
        source_type: 'machine-inferred',
        task_id: `task_${Date.now()}`,
        session_ref: `session_${Date.now()}`,
        trust_status: 'pending',
      },
    };

    try {
      await QuestionsManager.getInstance(this.memoryDir).append(question);
    } catch {
      // 写入失败不阻塞主流程
    }
    this.pendingQuestion = question;

    return {
      overrideContent: report,
      isError: true,
      terminate: true,
    };
  }
}

// ── 辅助函数 ──────────────────────────────────────────

export function isSoftToolBlock(ctx: PostToolCallContext): boolean {
  const text = ctx.resultText.trim();
  return text.includes('[FileGuard]')
    || text.includes('FileGuard')
    || text.includes('[RiskGuard]')
    || text.includes('RiskGuard')
    || text.startsWith('Tool execution was blocked');
}

function shouldRollback(ctx: PostToolCallContext, classified: ClassifiedError): boolean {
  if (!toolMayMutate(ctx.toolName, ctx.args)) {
    return false;
  }

  return ![
    'edit-exact-text-mismatch',
    'resource-not-found',
    'write-parent-missing',
    'selector-not-found',
    'timeout',
  ].includes(classified.subtype);
}

function isReadOnlyProbeFailure(ctx: PostToolCallContext): boolean {
  const toolName = ctx.toolName.toLowerCase();
  if (READONLY_TOOLS.has(toolName)) {
    return true;
  }

  if (!['bash', 'shell', 'terminal', 'exec_command'].includes(toolName)) {
    return false;
  }

  const command = extractCommand(ctx.args);
  if (!command) return false;

  return isReadOnlyShellCommand(command) && isProbeMiss(ctx.resultText);
}

function buildReadOnlyProbeResult(ctx: PostToolCallContext): string {
  const command = extractCommand(ctx.args);
  return [
    t('probe.miss'),
    command ? `命令：${command}` : '',
    t('probe.guidance'),
  ].filter(Boolean).join('\n');
}

function extractCommand(args: unknown): string | null {
  if (typeof args === 'string') return args.trim() || null;
  if (args === null || typeof args !== 'object') return null;
  const obj = args as Record<string, unknown>;
  for (const key of ['cmd', 'command', 'script']) {
    if (typeof obj[key] === 'string' && obj[key].trim()) {
      return obj[key].trim();
    }
  }
  return null;
}

function isReadOnlyShellCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  if (/[>;]|&&|\|\|/.test(normalized)) return false;
  return /^(rg|grep|find|ls|cat|pwd|wc|sed|nl|head|tail)\b/.test(normalized)
    || /^git\s+(status|diff|log|show|grep)\b/.test(normalized)
    || /^test\s+(-e|-f|-d)\b/.test(normalized);
}

function isProbeMiss(resultText: string): boolean {
  const text = resultText.trim();
  if (!text) return true;
  return /command exited with code 1/i.test(text)
    || /no such file or directory/i.test(text)
    || /not found/i.test(text)
    || /no matches?/i.test(text)
    || /\(no output\)/i.test(text);
}

function shouldQueryContext7ForToolFailure(
  ctx: PostToolCallContext,
  classified: ClassifiedError,
): boolean {
  if (classified.category === 'environment') {
    return true;
  }

  if (classified.category === 'model' || classified.category === 'user_input' || classified.category === 'state_conflict') {
    return false;
  }

  const toolName = ctx.toolName.toLowerCase();
  if (!['bash', 'shell', 'terminal', 'exec_command'].includes(toolName)) {
    return false;
  }

  const command = extractCommand(ctx.args);
  const text = [command ?? '', ctx.resultText].join('\n');
  return isBuildOrRuntimeDiagnostic(text);
}

function isBuildOrRuntimeDiagnostic(text: string): boolean {
  return /\b(tsc|npm\s+(run\s+)?(build|test)|pnpm\s+(run\s+)?(build|test)|yarn\s+(build|test)|vitest|jest|eslint|ts-node|vite|webpack|rollup)\b/i.test(text)
    || /\b(TypeScript|TS\d{4}|SyntaxError|ReferenceError|TypeError|Cannot find module|Module not found|Failed to compile|Compilation failed|Build failed|Test Files\s+\d+\s+failed)\b/i.test(text);
}

function selectStrategy(category: ErrorCategory): string {
  switch (category) {
    case 'tool':
      return 'downgrade_retry';
    case 'model':
      return 'split_task';
    case 'environment':
      return 'wait_retry';
    case 'user_input':
      return 'clarify';
    case 'state_conflict':
      return 'rollback_retry';
    default:
      return 'generic_retry';
  }
}

function buildRecoveryInstructions(
  classified: ClassifiedError,
  rollback: RollbackStatus,
): string {
  const lines = [
    `WARN: 工具执行失败（${classified.category}/${classified.subtype}）`,
    `错误：${classified.message}`,
    '',
  ];

  switch (rollback.state) {
    case 'success':
      lines.push(t('recovery.success', { snapshotId: rollback.snapshotId }));
      lines.push('');
      break;
    case 'failed':
      lines.push(t('recovery.failed', { snapshotId: rollback.snapshotId, reason: rollback.reason }));
      lines.push('');
      break;
    case 'unavailable':
      lines.push(t('recovery.unavailable'));
      lines.push('');
      break;
  }

  switch (classified.category) {
    case 'tool':
      if (classified.subtype === 'edit-exact-text-mismatch') {
        lines.push(t('recovery.advice.edit'));
      } else if (classified.subtype === 'write-parent-missing') {
        lines.push(t('recovery.advice.write'));
      } else {
        lines.push(t('recovery.advice.generic'));
      }
      break;
    case 'model':
      lines.push(t('recovery.advice.model'));
      break;
    case 'environment':
      lines.push(t('recovery.advice.env'));
      break;
    case 'user_input':
      lines.push(t('recovery.advice.user_input'));
      break;
    case 'state_conflict':
      lines.push(t('recovery.advice.conflict'));
      break;
  }

  return lines.join('\n');
}

function buildSecondFailureRecovery(classified: ClassifiedError): string {
  return [
    `WARN: 第二次尝试仍失败（${classified.category}/${classified.subtype}）`,
    `错误：${classified.message}`,
    '',
    '辅助诊断：这是工具操作问题，不触发 Context7 文档检索。',
    '',
    '建议：',
    '1. 不要重复同一失败工具参数',
    '2. 重新读取目标文件或缩小路径/关键词',
    '3. 如果后续出现编译、类型检查、测试或运行时报错，再查询 Context7',
  ].join('\n');
}

function buildEditMismatchRecovery(
  classified: ClassifiedError,
  ctx: PostToolCallContext,
): string {
  const targetPath = extractTargetPath(ctx.resultText) ?? extractTargetPath(stringifyToolArgs(ctx.args));
  return [
    `WARN: 第二次 edit 精确文本替换仍失败（${classified.category}/${classified.subtype}）`,
    `错误：${classified.message}`,
    '',
    '辅助诊断：这是本地文件内容与 oldText 不一致导致的 edit 失败，不是第三方库/API 问题；跳过 Context7。',
    targetPath ? `目标文件：${targetPath}` : '',
    '',
    '恢复动作：',
    targetPath
      ? `1. 先重新读取 ${targetPath} 的当前内容，确认真实上下文。`
      : '1. 先重新读取目标文件当前内容，确认真实上下文。',
    '2. 不要再次提交同一段 oldText。',
    '3. 单点小改可以换更小的 edit 锚点；如果要改大块结构或多处位置，改用 apply_patch。',
    '4. 修改后再继续当前 Phase，不要重新规划整个任务。',
  ].filter(Boolean).join('\n');
}

async function buildContext7Context(
  ctx: PostToolCallContext,
  classified: ClassifiedError,
  taskDescription: string,
  context7Client?: Pick<Context7Client, 'query'>,
): Promise<string> {
  const query = extractContext7Query(ctx, classified, taskDescription);
  if (!query) {
    return buildContext7Fallback(classified, 'skipped', '未能从任务或错误中提取明确的库名');
  }
  if (!context7Client) {
    return buildContext7Fallback(classified, 'skipped', 'Context7 客户端未配置，未执行文档检索');
  }

  try {
    const docs = await context7Client.query({
      libraryName: query.libraryName,
      topic: query.topic,
      tokens: 2_000,
    });

    if (!docs) {
      return buildContext7Fallback(classified, 'attempted', `Context7 未找到与 ${query.libraryName} 相关的文档`);
    }

    return renderContext7Docs(classified, query, docs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return buildContext7Fallback(classified, 'attempted', `Context7 检索不可用：${message}`);
  }
}

function renderContext7Docs(
  classified: ClassifiedError,
  query: Context7Query,
  docs: Context7DocsResult,
): string {
  return [
    `WARN: 第二次尝试仍失败（${classified.category}/${classified.subtype}）`,
    `错误：${classified.message}`,
    '',
    '辅助诊断：已触发 Context7 文档检索。',
    `查询：${query.libraryName}${query.topic ? ` / ${query.topic}` : ''}`,
    `命中文档：${docs.libraryId}`,
    '',
    'Context7 文档片段：',
    docs.content,
    '',
    '建议：',
    '1. 根据上面的官方文档片段修正工具参数或 API 用法',
    '2. 如果文档与当前代码版本不匹配，先检查项目依赖版本',
    '3. 避免重复同一失败路径，换一种实现方式重试',
  ].join('\n');
}

function buildContext7Fallback(
  classified: ClassifiedError,
  status: 'attempted' | 'skipped',
  reason?: string,
): string {
  const lines = [
    `WARN: 第二次尝试仍失败（${classified.category}/${classified.subtype}）`,
    `错误：${classified.message}`,
    '',
    status === 'attempted'
      ? '辅助诊断：已尝试触发 Context7 文档检索，但没有可用文档可注入。'
      : '辅助诊断：未触发 Context7 文档检索。',
  ];

  if (reason) {
    lines.push(`原因：${reason}`);
  }

  lines.push(
    '',
    '建议：',
    '1. 停止重复同一工具参数',
    '2. 根据错误信息缩小复现范围',
    '3. 若是第三方库或 API 问题，优先检查本地依赖版本和官方文档',
  );

  return lines.join('\n');
}

interface Context7Query {
  libraryName: string;
  topic?: string;
}

const KNOWN_LIBRARY_NAMES = [
  'playwright',
  'context7',
  'react',
  'next',
  'vite',
  'vitest',
  'xstate',
  'typescript',
  'node',
  'express',
  'prisma',
  'tailwind',
  'zod',
  'anthropic',
  'claude',
  'sqlite',
  'astropy',
];

function extractContext7Query(
  ctx: PostToolCallContext,
  classified: ClassifiedError,
  taskDescription: string,
): Context7Query | null {
  const text = [
    taskDescription,
    ctx.toolName,
    stringifyToolArgs(ctx.args),
    ctx.resultText,
    classified.message,
  ].join('\n').toLowerCase();

  const knownLibrary = KNOWN_LIBRARY_NAMES.find((name) => text.includes(name));
  const libraryName = knownLibrary ?? extractPackageName(text);
  if (!libraryName) {
    return null;
  }

  return {
    libraryName,
    topic: classified.subtype || classified.category,
  };
}

function stringifyToolArgs(args: unknown): string {
  if (typeof args === 'string') {
    return args;
  }
  if (typeof args === 'number' || typeof args === 'boolean') {
    return String(args);
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

function extractTargetPath(text: string): string | null {
  const match = text.match(/\b(?:src|app|pages|components|lib|server|client|test|tests)\/[^\s:'"]+/);
  return match?.[0].replace(/[.)\],;]+$/u, '') ?? null;
}

function extractPackageName(text: string): string | null {
  const scoped = text.match(/@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*/);
  if (scoped) {
    return scoped[0];
  }

  const dependency = text.match(/(?:package|module|library|import|from)\s+['"]?([a-z0-9][a-z0-9._-]*)/);

  // Python: from astropy.xxx import yyy / import numpy
  const pyFrom = text.match(/from\s+([a-z_][a-z0-9_]*)[\s.]/);
  if (pyFrom) return pyFrom[1];

  const pyImport = text.match(/import\s+([a-z_][a-z0-9_]*)/);
  if (pyImport) return pyImport[1];

  return dependency?.[1] ?? null;
}
