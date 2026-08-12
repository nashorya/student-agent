/**
 * Student Agent Extension — Pi 集成入口。
 *
 * 开发期：Student Agent 拥有进程，用 createStudentSession() SDK。
 * 稳定后：可封装为 Pi Extension（export default function(pi: ExtensionAPI)）。
 *
 * 职责：
 *   1. 组装四个 hook（snapshot, failure-escalation, memory, reflect）
 *   2. 调用 pi-bridge 的 createStudentSession() 创建 Pi Session
 *   3. 提供 REPL 入口
 */

import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import chalk from 'chalk';
import { getModel, getModels, completeSimple, type Api, type Model } from '../core/pi-compat/index.js';
import { loadEnvFile, loadEnvLayersPreservingAmbient } from '../core/env.js';
import { getProjectCwd } from '../core/paths.js';
import { loadStudentAgentConfig, GLOBAL_CONFIG_DIR, describeProfileEnvConflict } from '../core/config/loader.js';
import type { StudentAgentConfig } from '../core/config/types.js';
import { resolveConfiguredModel } from '../core/config/model-resolver.js';
import {
  createReadlinePrompt,
  runStartupInitializer,
  switchModelName,
  getApiKeyEnvName,
  normalizeProviderApiKeyEnv,
} from '../core/setup/initializer.js';
import { createStudentSession, type StudentAgentHooks } from '../core/pi-bridge/session-factory.js';
import { Context7Client } from '../knowledge/context7-client.js';
import { createSnapshotHook, getLastSnapshotId, restoreSnapshot } from './hooks/snapshot.js';
import { createFileGuardHook } from './hooks/file-guard.js';
import { createToolGuardHook } from './hooks/tool-guard.js';
import { createRiskGuardHook, type ConfirmationProviderRef } from './hooks/risk-guard.js';
import { FailureEscalationContext } from './hooks/failure-escalation.js';
import { createContextAssemblyHook } from './hooks/context-assembly.js';
import { createReflectHook, markReflectBaseline, recordReflectToolCall } from './hooks/reflect.js';
import { createQualityWatchdogHook } from './hooks/quality-watchdog.js';
import { formatContextInspection, inspectContext } from './commands/context-inspector.js';
import { buildSettingTargetPrompt, parseSettingTargetAnswer, type SettingTarget } from './setting-target.js';
import { runProviderProfileCommand } from './provider-command.js';
import { shouldShowAgentErrorMessage, formatAgentErrorForDisplay } from './tui-message-policy.js';
import {
  buildPlanningRecoveryPromptQuestion,
  buildPlanningRetryRequest,
  buildPlanningRevisionQuestion,
  classifyPlanningFailure,
  mergePlanningRevision,
  parsePlanningRecoveryAnswer,
  type PlanningFailureInfo,
} from './planning-recovery.js';
import { QualityFeedbackManager, parseFeedbackCommand } from '../watchdog/feedback-collector.js';
import { QuestionsManager } from '../memory/questions/manager.js';
import { WhyManager } from '../memory/why/manager.js';
import { EventRenderer } from '../cli/event-renderer.js';
import { parseNonInteractiveArgs, type NonInteractiveArgs } from '../cli/non-interactive-args.js';
import {
  beginNonInteractiveContextTask,
  finishNonInteractiveContextTask,
} from '../cli/non-interactive-context.js';
import {
  createNonInteractiveSummary,
  NonInteractiveUsageCollector,
} from '../cli/non-interactive-summary.js';
import {
  CompletionSelfCheck,
  emptySelfCheckResult,
} from '../cli/completion-self-check.js';
import { ZeroEditContinuation } from '../cli/zero-edit-continuation.js';
import { buildContextTokenEffect } from '../evals/context-breakdown.js';
import type { EvalContextAssemblyTrace, ProtectedEvalEvent } from '../evals/types.js';
import { summarizePiToolSchema } from '../evals/agent-runner.js';
import { drainProtectedEvents } from '../core/hashline/index.js';
import { parseCommand, getHelpText, COMMAND_COMPLETIONS, type SlashCommand } from '../cli/command-parser.js';
import { executeArchiveCommand } from '../archive/commands.js';
import { ArchiveService } from '../archive/service.js';
import { ArchiveWorkflowCoordinator } from '../archive/workflow.js';
import { printBanner } from '../cli/banner.js';
import { initLogger, logger } from '../runtime/logger.js';
import { createInputQueue } from '../runtime/input-queue.js';
import { redirectConsoleForTUI } from '../runtime/console-redirect.js';
import type { UiBridge } from '../runtime/ui-bridge.js';
import { startShell, syncWorkbenchProjection, type ShellHandle } from '../tui-shell/index.js';
import { TasksManager } from '../memory/tasks/manager.js';
import type { Task } from '../memory/tasks/types.js';
import { SessionStore, formatSessionExitHint } from '../memory/sessions/index.js';
import { createSignalPipeline } from '../memory/signals/index.js';
import { PlanRevisionManager } from '../memory/plan-revisions/manager.js';
import type { PlanRevision } from '../memory/plan-revisions/types.js';
import { ProjectKbManager } from '../memory/project-kb/manager.js';
import { parsePhaseSignal, type PhaseSignal } from '../core/task-planner/phase-signal.js';
import { createPlanSnapshot, detectPlanRevisionIntent, type PlanSnapshot } from '../core/task-planner/plan-revision-detector.js';
import { detectNegativeFeedback } from '../core/task-planner/feedback-detector.js';
import { detectNaturalReviewResponse } from '../core/task-planner/review-detector.js';
import { classifyIntent, isInformationalFollowUp, type IntentResult } from '../core/task-planner/intent-classifier.js';
import { buildTaskContextPrefix } from '../core/task-planner/task-context-builder.js';
import { buildCtx7RetryContext } from '../core/task-planner/ctx7-retry-builder.js';
import { buildPlanningPrompt, buildPlanningRepairPrompt, buildPhaseExecutionPrompt } from '../core/task-planner/planning-prompt.js';
import { PromptConfirmationProvider } from '../core/executor/confirmation.js';
import type { ConfirmationProvider } from '../core/executor/types.js';
import type { ContextRunMode } from '../memory/recall/types.js';

// ── 早期诊断：捕获模块加载/启动阶段的未处理异常 ────────
// 目的是把 "[Object: null prototype] { Symbol(util.inspect.custom): ... }" 这种没有 stack 的崩溃
// 还原成可读的错误信息（含来源、类型、属性），避免 Node 默认的"对象 toString"丢栈。
process.on('uncaughtException', (err) => {
  // 优先尝试 Error 标准字段
  // eslint-disable-next-line no-console
  console.error('\n[StudentAgent] uncaughtException');
  try {
    if (err instanceof Error) {
      console.error('  name   :', err.name);
      console.error('  message:', err.message);
      console.error('  stack  :', err.stack);
    } else {
      console.error('  typeof :', typeof err);
      console.error('  keys   :', Object.getOwnPropertyNames(err ?? {}));
      console.error('  raw    :', err);
      try { console.error('  json   :', JSON.stringify(err, Object.getOwnPropertyNames(err ?? {}))); } catch {}
    }
  } catch (innerErr) {
    console.error('  (handler failed)', innerErr);
  }
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('\n[StudentAgent] unhandledRejection');
  if (reason instanceof Error) {
    console.error('  ', reason.stack ?? reason.message);
  } else {
    console.error('  typeof:', typeof reason, 'keys:', Object.getOwnPropertyNames(reason ?? {}));
    console.error('  raw   :', reason);
  }
});

// ── 配置 ──────────────────────────────────────────────

const CWD = getProjectCwd();
const MEMORY_DIR = join(CWD, 'memory');
const GLOBAL_MEMORY_DIR = join(GLOBAL_CONFIG_DIR, 'memory');

// 早期检测：CWD 为根目录会导致 memory/ 写入 /memory（需要 root 权限）
if (CWD === '/') {
  console.error('[StudentAgent] 错误：工作目录为文件系统根目录（/）。');
  console.error('  请从项目目录运行：cd /path/to/project && npm run dev');
  console.error('  或设置 STUDENT_AGENT_CWD 环境变量指向项目目录。');
  process.exit(1);
}

/** 当前任务描述（用于 ReflectAgent 和失败升级的诊断报告） */
let currentTaskDescription = '';
let lastPlanSnapshot: PlanSnapshot | null = null;
/** Codex-style collaboration mode: plan = investigate/design only; execute = normal. */
let collaborationMode: 'plan' | 'execute' = 'execute';

const PLAN_CONFIRM_RE = /^(确认|开始|执行|继续|go|yes|y)$/i;
const PLAN_MODE_ENTERED = 'Plan 模式';
const PLAN_MODE_LEFT = '已退出 Plan 模式';

interface RuntimeState {
  config: StudentAgentConfig;
  session: Awaited<ReturnType<typeof createStudentSession>>['session'];
  agent: Awaited<ReturnType<typeof createStudentSession>>['agent'];
  escalation: FailureEscalationContext;
  renderer: EventRenderer;
  unsubscribe: () => void;
  model: Model<Api>;
  resetFileGuard: () => void;
  resetToolGuard: () => void;
  setFileGuardMode: (mode: 'planning' | 'normal') => void;
  setRiskConfirmationProvider: (provider: ConfirmationProvider | null) => void;
}

// ── 构建模型 ──────────────────────────────────────────

function buildModel(config: StudentAgentConfig): Model<Api> {
  return resolveConfiguredModel(config.model);
}

function getDefaultModel(provider: string): Model<Api> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const models = getModels(provider as any) as Model<Api>[];
  if (models.length > 0) return models[0];
  return getModel('anthropic', 'claude-sonnet-4-6');
}

const DEFAULT_OPENAI_CHAT_CONFIG: Pick<StudentAgentConfig, 'model'> = {
  model: {
    provider: 'openai',
    name: 'gpt-4o',
  },
};

function buildOpenAIChatModel(config: Pick<StudentAgentConfig, 'model'>): Model<Api> {
  return resolveConfiguredModel(config.model);
}

// ── 组装 Hooks ────────────────────────────────────────

function buildHooks(
  config: StudentAgentConfig,
  abortRef: { abort: () => void },
  riskConfirmationRef: ConfirmationProviderRef,
  options: RuntimeOptions = {},
): {
  hooks: StudentAgentHooks;
  escalation: FailureEscalationContext;
  resetFileGuard: () => void;
  resetToolGuard: () => void;
  setFileGuardMode: (mode: 'planning' | 'normal') => void;
  resetRiskGuard: () => void;
} {
  const memoryDir = options.memoryDir ?? MEMORY_DIR;
  const bridge = options.bridge;
  const reflectHook = createReflectHook(memoryDir, () => currentTaskDescription, {
    boundedBreakerEnabled: config.features.boundedBreaker,
    onSummary: bridge
      ? (summary) => {
        bridge.addMessage(
          'reflect',
          `提取 ${summary.patternsExtracted} 个模式，升级 ${summary.promotedCount} 条偏好`,
        );
      }
      : undefined,
  });
  const watchdogHook = config.features.qualityWatchdog
    ? createQualityWatchdogHook(memoryDir)
    : null;
  const context7Client = config.features.context7
    ? new Context7Client({
      apiKey: config.context7.apiKey,
      timeoutMs: config.context7.timeoutMs,
      maxDocsChars: config.context7.maxDocsChars,
      projectKb: ProjectKbManager.getInstance(memoryDir),
    })
    : undefined;

  const escalation = new FailureEscalationContext({
    context7Client,
    memoryDir,
    getLastSnapshotId,
    restoreSnapshot,
  });

  const fileGuard = createFileGuardHook(abortRef, config.fileGuard);
  const toolGuard = createToolGuardHook();
  const signalPipeline = createSignalPipeline({
    memoryDir,
    onProtectedEvents: options.onProtectedEvents,
    onSignals: bridge
      ? (signals) => {
        for (const signal of signals) {
          if (signal.severity === 'low') continue;
          bridge.addMessage(
            'signal',
            `${signal.kind} [${signal.severity}] ${signal.summary}`,
          );
        }
      }
      : undefined,
  });
  const escalationHook = escalation.createHook();
  const riskGuard = createRiskGuardHook({
    enabled: config.features.riskGuard && config.executionMode !== 'yolo',
    confirmationProviderRef: riskConfirmationRef,
  });
  const snapshotHook = createSnapshotHook(CWD);

  const hooks: StudentAgentHooks = {
    onBeforeToolCall: async (ctx) => {
      const toolGuardDecision = await toolGuard.hook(ctx);
      if (toolGuardDecision?.block) return toolGuardDecision;
      const guardDecision = await fileGuard.hook(ctx);
      if (guardDecision?.block) return guardDecision;
      const riskDecision = await riskGuard.hook(ctx);
      if (riskDecision?.block) return riskDecision;
      return snapshotHook(ctx);
    },
    onAfterToolCall: async (ctx) => {
      toolGuard.observeResult(ctx);
      await signalPipeline.processAfterToolCall(ctx);
      recordReflectToolCall(ctx);
      return escalationHook(ctx);
    },
    buildMemoryPrompt: createContextAssemblyHook({
      memoryDir,
      useNewPipeline: true,
      runMode: options.runMode,
      onTrace: (trace) => {
        options.onContextAssemblyTrace?.(trace);
        const items = trace.recall?.items ?? [];
        if (bridge && items.length > 0) {
          const byKind = new Map<string, number>();
          for (const item of items) {
            byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1);
          }
          const counts = [...byKind.entries()].map(([k, n]) => `${k}:${n}`).join(' · ');
          bridge.addMessage('recall', `${items.length} injected (${counts})`);
        }
      },
    }),
    onSessionEnd: async (ctx) => {
      await reflectHook(ctx);
      await watchdogHook?.(ctx);
    },
  };

  return {
    hooks,
    escalation,
    resetFileGuard: fileGuard.reset,
    resetToolGuard: toolGuard.reset,
    setFileGuardMode: fileGuard.setMode,
    resetRiskGuard: riskGuard.reset,
  };
}

function bindConsoleRiskConfirmation(
  runtime: RuntimeState,
  rl: Awaited<ReturnType<typeof createInterface>>,
): void {
  runtime.setRiskConfirmationProvider(new PromptConfirmationProvider({
    prompt: createReadlinePrompt(rl),
    isInteractive: () => process.stdin.isTTY === true && process.stdout.isTTY === true,
  }));
}

function bindBridgeRiskConfirmation(runtime: RuntimeState, bridge: UiBridge): void {
  runtime.setRiskConfirmationProvider(new PromptConfirmationProvider({
    prompt: (question) => bridge.promptSettings(question),
    isInteractive: () => process.stdin.isTTY === true && process.stdout.isTTY === true,
  }));
}

// ── 主入口 ─────────────────────────────────────────────

async function runNonInteractive(args: Exclude<NonInteractiveArgs, { mode: 'interactive' }>): Promise<number> {
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const usageCollector = new NonInteractiveUsageCollector();
  let provider: string | undefined;
  let model: string | undefined;
  let exitCode = 1;
  let status: 'success' | 'failed' = 'failed';
  let errorMessage: string | undefined;

  const finish = async (code: number, error?: string): Promise<number> => {
    exitCode = code;
    status = code === 0 ? 'success' : 'failed';
    errorMessage = error;
    return code;
  };

  if (args.mode === 'error') {
    console.error(`[student-agent] ${args.message}`);
    return finish(2, args.message);
  }

  let prompt: string;
  try {
    prompt = args.mode === 'prompt'
      ? args.prompt
      : await readFile(args.promptFile, 'utf8');
  } catch (err) {
    const message = `Failed to read prompt file: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[student-agent] ${message}`);
    return finish(2, message);
  }

  if (!prompt.trim()) {
    console.error('[student-agent] Prompt is empty');
    return finish(2, 'Prompt is empty');
  }

  let runtime: RuntimeState | undefined;
  let usageUnsubscribe: (() => void) | undefined;
  let contextTaskId: string | undefined;
  let hardConstraints = '';
  let selfCheck = emptySelfCheckResult();
  let continuationRounds = 0;
  const memoryDir = args.memoryDir ?? MEMORY_DIR;
  const contextAssemblyTraces: EvalContextAssemblyTrace[] = [];
  const protectedEvents: ProtectedEvalEvent[] = [];
  drainProtectedEvents();
  try {
    const config = await reloadConfig();
    provider = config.model.provider;
    model = config.model.name;
    const apiKeyName = config.model.apiKeyEnv ?? getApiKeyEnvName(config.model.provider);
    if (!process.env[apiKeyName]) {
      const message = `Missing ${apiKeyName} for provider ${config.model.provider}`;
      console.error(`[student-agent] ${message}`);
      return finish(2, message);
    }

    const contextTask = await beginNonInteractiveContextTask({
      memoryDir,
      instruction: prompt,
    });
    contextTaskId = contextTask.id;
    hardConstraints = contextTask.working_memory.hardConstraints;
    runtime = await createRuntime(config, {
      memoryDir,
      runMode: args.runMode ?? 'interactive',
      onContextAssemblyTrace: (trace) => contextAssemblyTraces.push(trace),
      onProtectedEvents: (events) => protectedEvents.push(...events),
    });
    usageUnsubscribe = runtime.agent.subscribe((event) => usageCollector.handleEvent(event));
    currentTaskDescription = prompt;
    runtime.escalation.initTask(currentTaskDescription, CWD);
    markReflectBaseline();
    runtime.resetFileGuard();
    runtime.resetToolGuard();
    await runtime.session.prompt(prompt);
    await runtime.agent.waitForIdle();

    if (shouldShowAgentErrorMessage(runtime.agent.state.errorMessage)) {
      console.error(`[Agent Error] ${runtime.agent.state.errorMessage}`);
      return finish(1, runtime.agent.state.errorMessage);
    }
    continuationRounds = await new ZeroEditContinuation({
      session: runtime.session,
      agent: runtime.agent,
      memoryDir,
      taskId: contextTaskId,
    }).run(hardConstraints);
    if (shouldShowAgentErrorMessage(runtime.agent.state.errorMessage)) {
      console.error(`[Agent Error] ${runtime.agent.state.errorMessage}`);
      return finish(1, runtime.agent.state.errorMessage);
    }
    selfCheck = await new CompletionSelfCheck({
      session: runtime.session,
      agent: runtime.agent,
    }).run(hardConstraints);
    if (shouldShowAgentErrorMessage(runtime.agent.state.errorMessage)) {
      console.error(`[Agent Error] ${runtime.agent.state.errorMessage}`);
      return finish(1, runtime.agent.state.errorMessage);
    }
    return finish(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[student-agent] Non-interactive run failed:', message);
    return finish(1, message);
  } finally {
    if (contextTaskId) {
      await finishNonInteractiveContextTask({
        memoryDir,
        taskId: contextTaskId,
        exitCode,
        errorMessage,
      }).catch((err) => {
        console.error('[student-agent] Failed to finalize context task:', err instanceof Error ? err.message : String(err));
      });
    }
    usageUnsubscribe?.();
    runtime?.renderer.cleanup();
    runtime?.unsubscribe();
    protectedEvents.push(...drainProtectedEvents());
    if (args.jsonSummaryPath) {
      const endedMs = Date.now();
      const usageEvents = usageCollector.usageEvents();
      const contextTask = contextTaskId
        ? await TasksManager.getInstance(memoryDir).getTask(contextTaskId)
        : undefined;
      const piSchemaTrace = runtime
        ? summarizePiToolSchema(runtime.agent.state.tools)
        : undefined;
      await writeNonInteractiveSummary(args.jsonSummaryPath, createNonInteractiveSummary({
        status,
        exitCode,
        startedAt,
        endedAt: new Date(endedMs).toISOString(),
        durationMs: endedMs - startedMs,
        provider,
        model,
        errorMessage,
        usage: usageCollector.usage(),
        usageEvents,
        contextAssemblyTraces,
        contextTokenEffect: buildContextTokenEffect({
          contextAssemblyTraces,
          usageEvents,
          piSchemaTrace,
          instruction: prompt,
        }),
        workingMemorySnapshot: contextTask?.working_memory,
        protectedEvents,
        selfCheck,
        continuationRounds,
      })).catch((err) => {
        console.error('[student-agent] Failed to write JSON summary:', err instanceof Error ? err.message : String(err));
      });
    }
  }
}

async function writeNonInteractiveSummary(path: string, summary: ReturnType<typeof createNonInteractiveSummary>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const nonInteractive = parseNonInteractiveArgs(process.argv.slice(2));
  if (nonInteractive.mode !== 'interactive') {
    process.exitCode = await runNonInteractive(nonInteractive);
    return;
  }

  const setupRl = createInterface({ input, output });
  try {
    const initialConfig = await reloadConfig();
    await runStartupInitializer({
      cwd: CWD,
      config: initialConfig,
      prompt: createReadlinePrompt(setupRl),
    });
  } finally {
    setupRl.close();
  }

  const useTuiShell = process.stdin.isTTY === true && process.stdout.isTTY === true;
  if (useTuiShell) {
    await runInteractiveTui();
    return;
  }

  await runInteractiveReadline();
}

/** Non-TTY interactive path: temporary readline REPL (ADR-009). */
async function runInteractiveReadline(): Promise<void> {
  let runtime = await createRuntime(await reloadConfig());

  printBanner();
  console.log(chalk.yellow(
    '[student-agent] Full TUI requires a TTY; readline REPL is temporary for non-TTY.',
  ));
  initLogger();

  const rl = createInterface({
    input,
    output,
    completer: (line: string) => {
      const hits = COMMAND_COMPLETIONS.filter((c) => c.startsWith(line));
      return [hits.length ? hits : COMMAND_COMPLETIONS, line] as [string[], string];
    }
  });
  bindConsoleRiskConfirmation(runtime, rl);

  while (true) {
    let userInput = await rl.question(chalk.cyan('\n> '));
    if (!userInput.trim()) continue;

    // 清除刚才用户输入的行，用灰色背景重新打印全宽
    const cols = process.stdout.columns || 80;
    const styledInput = `> ${userInput}`.padEnd(cols);
    process.stdout.write(`\x1b[1A\x1b[2K\r${chalk.bgGray.white(styledInput)}\n`);

    // ── Slash command 处理 ────────────────────────

    const command = parseCommand(userInput);
    if (command) {
      switch (command.type) {
        case 'paste':
          userInput = command.content;
          break;

        case 'quit':
          runtime.renderer.cleanup();
          runtime.unsubscribe();
          rl.close();
          process.exit(0);

        case 'help':
          console.log(getHelpText());
          continue;

        case 'clear':
          console.clear();
          continue;

        case 'new': {
          if (runtime.agent.state.isStreaming) {
            console.log(chalk.yellow('  当前任务仍在运行，请先 /abort 再 /new。'));
            continue;
          }
          const tasksMgr = TasksManager.getInstance(MEMORY_DIR);
          const parked = await tasksMgr.parkActiveTask();
          lastPlanSnapshot = null;
          currentTaskDescription = '';
          console.log(
            parked
              ? chalk.green(`  新会话（REPL）。上次任务「${parked.name}」已 park — TUI 下 /resume 恢复对话。`)
              : chalk.green('  新会话（REPL）。'),
          );
          continue;
        }

        case 'sessions':
          console.log(chalk.dim('  最近会话列表请在 TUI 中使用 /sessions。'));
          continue;

        case 'resume': {
          if (runtime.agent.state.isStreaming) {
            console.log(chalk.yellow('  当前任务仍在运行，请先 /abort 再 /resume。'));
            continue;
          }
          if (!command.query.trim()) {
            console.log(chalk.dim('  用法: /resume <名称>'));
            continue;
          }
          const tasksMgr = TasksManager.getInstance(MEMORY_DIR);
          const store = new SessionStore(MEMORY_DIR);
          const loaded = await store.resolveSession(command.query);
          if (!loaded) {
            console.log(chalk.red(`  未找到会话：${command.query}`));
            continue;
          }
          await tasksMgr.parkActiveTask();
          if (loaded.task_id) {
            const resumed = await tasksMgr.resumeTask(loaded.task_id);
            if (resumed) {
              currentTaskDescription = resumed.name;
              lastPlanSnapshot = createPlanSnapshot(resumed);
              console.log(chalk.green(
                `  已恢复会话「${loaded.name}」关联任务「${resumed.name}」（对话记录请在 TUI /resume）`,
              ));
            } else {
              console.log(chalk.yellow(`  会话「${loaded.name}」无有效关联任务。`));
            }
          } else {
            console.log(chalk.yellow(`  会话「${loaded.name}」未关联任务。`));
          }
          continue;
        }

        case 'status':
          console.log(chalk.dim(`  任务: ${currentTaskDescription || '(无)'}`));
          console.log(chalk.dim(`  协作: ${collaborationMode === 'plan' ? 'plan' : 'execute'}`));
          console.log(chalk.dim(`  模式: ${runtime.config.executionMode}`));
          console.log(chalk.dim(`  模型: ${runtime.config.model.provider}/${runtime.config.model.name}`));
          console.log(chalk.dim(`  LLM 超时: ${runtime.config.llm.requestTimeoutMs}ms`));
          continue;

        case 'abort':
          if (!runtime.agent.state.isStreaming) {
            console.log(chalk.dim('  当前没有运行中的任务。'));
          } else {
            await runtime.session.abort();
            console.log(chalk.yellow('  已请求中止当前任务。'));
          }
          continue;

        case 'provider': {
          if (runtime.agent.state.isStreaming) {
            console.log(chalk.yellow('  当前任务仍在运行，不能切换 Provider。'));
            continue;
          }
          try {
            const result = await runProviderProfileCommand({
              cwd: CWD,
              config: runtime.config,
              prompt: createReadlinePrompt(rl),
              log: console.log,
              activate: async () => createRuntime(await reloadConfig()),
            });
            if (!result.switched) {
              console.log(chalk.dim('  已取消。'));
              continue;
            }
            runtime.renderer.cleanup();
            runtime.unsubscribe();
            runtime = result.value;
            bindConsoleRiskConfirmation(runtime, rl);
            console.log(chalk.green(
              `  OK: 已切换至 ${result.profileName}：${runtime.config.model.provider}/${runtime.config.model.name}`,
            ));
          } catch (err) {
            console.log(chalk.red(`  ${err instanceof Error ? err.message : String(err)}`));
          }
          continue;
        }

        case 'model': {
          if (runtime.agent.state.isStreaming) {
            console.log(chalk.yellow('  当前任务仍在运行，不能切换模型。'));
            continue;
          }
          const newName = await switchModelName({
            config: runtime.config,
            prompt: createReadlinePrompt(rl),
          });
          if (newName) {
            runtime.renderer.cleanup();
            runtime.unsubscribe();
            runtime = await createRuntime(await reloadConfig());
            bindConsoleRiskConfirmation(runtime, rl);
          } else {
            console.log(chalk.dim('  已取消。'));
          }
          continue;
        }

        case 'setting':
          runtime = await runSettingFlow(runtime, {
            prompt: createReadlinePrompt(rl),
            log: console.log,
            recreateRuntime: async () => createRuntime(await reloadConfig()),
          });
          bindConsoleRiskConfirmation(runtime, rl);
          continue;

        case 'login':
          console.log(chalk.yellow(`  ${loginHelpMessage(runtime)}`));
          continue;

        case 'task': {
          const tasksMgr = TasksManager.getInstance(MEMORY_DIR);
          const activeTask = await tasksMgr.getActive();
          if (command.subcommand === 'status') {
            if (!activeTask) {
              console.log(chalk.dim('  当前无活跃任务。'));
            } else {
              console.log(chalk.cyan(formatTaskStatus(activeTask)));
            }
          } else if (command.subcommand === 'rename') {
            if (!activeTask) {
              console.log(chalk.yellow('  当前无活跃任务。'));
            } else {
              await tasksMgr.renameTask(activeTask.id, command.name);
              console.log(chalk.green(`  已重命名为：${command.name}`));
            }
          } else if (command.subcommand === 'cancel') {
            const cancelled = await tasksMgr.cancelActiveTask();
            if (!cancelled) {
              console.log(chalk.yellow('  当前无活跃任务。'));
            } else {
              lastPlanSnapshot = null;
              console.log(chalk.green(`  已丢弃当前任务：${cancelled.name}`));
            }
          }
          continue;
        }

        case 'archive':
          try { console.log(await executeArchiveCommand(CWD, command)); }
          catch (error) { console.error(`Archive error: ${error instanceof Error ? error.message : String(error)}`); }
          continue;

        case 'candidates':
          console.log(chalk.dim('  候选：待实现'));
          continue;

        case 'context':
          console.log(formatContextInspection(await inspectContext(MEMORY_DIR)));
          continue;

        case 'init': {
          const run = (cmd: string, args: string[]) =>
            new Promise<string>((resolve, reject) =>
              execFile(cmd, args, { cwd: CWD }, (err, stdout, stderr) =>
                err ? reject(new Error(stderr || err.message)) : resolve(stdout.trim()),
              ),
            );
          try {
            await run('git', ['init']);
            await run('git', ['add', '-A']);
            await run('git', ['commit', '--allow-empty', '-m', 'chore: initial commit by student-agent']);
            console.log(chalk.green('  git 仓库已初始化并创建初始提交，快照回滚已启用。'));
          } catch (e) {
            console.log(chalk.red(`  /init 失败: ${e instanceof Error ? e.message : e}`));
          }
          continue;
        }

        case 'feedback':
          console.log(chalk.green(await recordQualityFeedback(command, runtime)));
          if (isActionableDownFeedback(command)) {
            await runConsoleFeedbackRepair(runtime, command.comment);
          }
          continue;

        case 'review':
          {
            const reviewResult = await handleReviewCommand(command, currentTaskDescription);
            if (reviewResult.completedTask) {
              lastPlanSnapshot = null;
            }
            console.log(chalk.green(`  ${reviewResult.message}`));
          }
          continue;

        case 'why':
          console.log(chalk.green(await renderWhyCommand(command)));
          continue;

        case 'plan': {
          if (runtime.agent.state.isStreaming) {
            console.log(chalk.yellow('  当前任务仍在运行，不能切换 Plan 模式。'));
            continue;
          }
          collaborationMode = 'plan';
          if (!command.goal) {
            console.log(chalk.cyan(`  ${PLAN_MODE_ENTERED}`));
            continue;
          }
          userInput = command.goal;
          break;
        }

        case 'execute':
          collaborationMode = 'execute';
          console.log(chalk.cyan(`  ${PLAN_MODE_LEFT}`));
          continue;

        case 'revision':
          console.log(chalk.green(await handleRevisionCommand({ type: 'revision', content: command.content })));
          continue;

        case 'revisions':
          console.log(chalk.green(await handleRevisionCommand({ type: 'revisions', query: command.query })));
          continue;

        case 'unknown':
          console.log(chalk.yellow(`  未知命令: ${command.raw}`));
          console.log(chalk.dim('  输入 /help 查看可用命令'));
          continue;
      }

      if (command.type !== 'paste' && command.type !== 'plan') continue;
    }

    // ── 兼容旧 /feedback up|down 格式 ──────────────

    const feedback = runtime.config.features.qualityWatchdog ? parseFeedbackCommand(userInput) : null;
    if (feedback) {
      console.log(chalk.green(await recordQualityFeedback(feedback, runtime)));
      if (isActionableDownFeedback(feedback)) {
        await runConsoleFeedbackRepair(runtime, feedback.comment);
      }
      continue;
    }

    // ── 正常任务提交 ──────────────────────────────

    const tasksMgr = TasksManager.getInstance(MEMORY_DIR);
    const activeTask = await tasksMgr.getActive();
    if (activeTask && isAwaitingUserReview(activeTask)) {
      const reviewResult = await maybeHandleNaturalReviewResponse(userInput, currentTaskDescription);
      if (reviewResult) {
        if (reviewResult.completedTask) {
          lastPlanSnapshot = null;
        }
        console.log(chalk.green(`  ${reviewResult.message}`));
        continue;
      }
    }

    const automaticRevisionMessage = await maybeRecordAutomaticPlanRevision(userInput, activeTask);
    if (automaticRevisionMessage) {
      console.log(chalk.dim(`  ${automaticRevisionMessage}`));
    }

    if (activeTask && isPlanConfirmationInput(userInput)) {
      collaborationMode = 'execute';
      await runConsoleActivePhase(runtime, activeTask);
      continue;
    }

    // 负反馈检测
    const feedbackSignal = detectNegativeFeedback(userInput);
    if (feedbackSignal.isNegative && activeTask) {
      await tasksMgr.incrementRetry(activeTask.id, feedbackSignal.extractedText);
      const updatedTask = await tasksMgr.getActive();
      const phase = updatedTask?.phases[updatedTask.active_phase_index];

      // 第 3 次重试时查询 Context7
      let ctx7Docs = '';
      if (phase && phase.retry_count >= 2 && runtime.config.features.context7) {
        const ctx7Client = new Context7Client({
          apiKey: runtime.config.context7.apiKey,
          timeoutMs: runtime.config.context7.timeoutMs,
          maxDocsChars: runtime.config.context7.maxDocsChars,
          projectKb: ProjectKbManager.getInstance(MEMORY_DIR),
        });
        ctx7Docs = await buildCtx7RetryContext(
          updatedTask?.name ?? activeTask.name,
          phase.feedbacks,
          ctx7Client,
          runtime.model,
        );
      }

      // 注入任务上下文
      const taskContext = buildTaskContextPrefix(updatedTask ?? activeTask, ctx7Docs);
      const finalPrompt = taskContext + userInput;

      currentTaskDescription = updatedTask?.name ?? activeTask.name;
      runtime.escalation.initTask(currentTaskDescription, CWD);
      markReflectBaseline();

      try {
        await runTaskWithAbort(runtime, finalPrompt);
      } catch (err) {
        console.error(
          chalk.red('Task error:'),
          err instanceof Error ? err.message : String(err),
        );
      }
    } else {
      // 非负反馈：意图分类（Plan 模式强制走规划路径）
      const forcePlan = collaborationMode === 'plan';
      const intent = forcePlan
        ? forcePlanIntent(userInput)
        : await classifyIntent(
          userInput,
          activeTask?.name ?? null,
          runtime.model,
        );

      if (forcePlan || (intent.type === 'new_task' && intent.requiresPlan)) {
        // 新任务：收集 agent 输出，解析信号
        const planningOut = subscribeAssistantTextSnapshot(runtime.agent);

        currentTaskDescription = intent.taskName ?? userInput;
        runtime.escalation.initTask(currentTaskDescription, CWD);
        markReflectBaseline();

        // 保存规划前的消息数量，临时取消 EventRenderer 订阅
        // 避免规划失败时把规划消息残留到 transcript
        const savedMessageCount = runtime.agent.state.messages.length;
        runtime.unsubscribe();

        let planningError: unknown;
        let signal: PhaseSignal | null = null;
        try {
          runtime.setFileGuardMode('planning');
          await runTaskWithAbort(runtime, buildPlanningPrompt(userInput));
          signal = parsePhaseSignal(planningOut.getText());
          if (!isValidTaskStartSignal(signal)) {
            await runTaskWithAbort(runtime, buildPlanningRepairPrompt(userInput));
            signal = parsePhaseSignal(planningOut.getText());
          }
        } catch (err) {
          planningError = err;
        } finally {
          runtime.setFileGuardMode('normal');
          planningOut.unsubscribe();
          // 重新订阅 EventRenderer
          runtime.unsubscribe = runtime.agent.subscribe((event) => runtime.renderer.handleEvent(event));
        }

        if (planningError) {
          // 规划失败：恢复 agent 消息到规划前状态
          runtime.agent.state.messages = runtime.agent.state.messages.slice(0, savedMessageCount);
          if (isInformationalFollowUp(userInput)) {
            await runConsolePlainAnswer(runtime, userInput);
          } else {
            console.error(
              chalk.red('规划失败:'),
              planningError instanceof Error ? planningError.message : String(planningError),
            );
          }
          continue;
        }

        if (isValidTaskStartSignal(signal)) {
          const autoExec = isYoloMode(runtime) && !forcePlan;
          const newTask = await tasksMgr.createTask(
            signal.name,
            signal.phases,
            buildTaskCreateOptions(intent, signal.context, autoExec),
          );
          lastPlanSnapshot = createPlanSnapshot(newTask);
          console.log(chalk.green('\n' + formatPlanAwaitingConfirmation(
            signal.name,
            signal.phases,
            autoExec,
          )));
          if (autoExec) {
            await runConsoleActivePhase(runtime, newTask);
          }
        } else if (signal?.type === 'phase_done' && activeTask) {
          await tasksMgr.completePhase(activeTask.id);
          const updatedTask = await tasksMgr.getActive();
          if (updatedTask && hasExecutableCurrentPhase(updatedTask)) {
            if (isYoloMode(runtime)) {
              console.log(chalk.green(`\n  [Phase ${signal.phaseIndex + 1} 完成] 进入 Phase ${updatedTask.active_phase_index + 1}，YOLO 自动继续。`));
              await runConsoleActivePhase(runtime, updatedTask);
            } else {
              console.log(chalk.green(`\n  [Phase ${signal.phaseIndex + 1} 完成] 进入 Phase ${updatedTask.active_phase_index + 1}。回复“继续”执行下一 Phase。`));
            }
          } else if (updatedTask && isAwaitingUserReview(updatedTask)) {
            await finalizePendingArchiveForReview(updatedTask, tasksMgr);
            console.log(chalk.green('\n  ' + formatAwaitingReviewMessage(updatedTask)));
          } else {
            console.log(chalk.green(`\n  [任务完成] ${activeTask.name}`));
            lastPlanSnapshot = null;
          }
        } else if (isInformationalFollowUp(userInput)) {
          // 规划未输出 TASK_START：恢复 agent 消息到规划前状态
          runtime.agent.state.messages = runtime.agent.state.messages.slice(0, savedMessageCount);
          await runConsolePlainAnswer(runtime, userInput);
        } else {
          // 规划未输出 TASK_START：恢复 agent 消息到规划前状态
          runtime.agent.state.messages = runtime.agent.state.messages.slice(0, savedMessageCount);
          console.log(chalk.red('\n  [规划失败] Agent 未输出有效 Phase 行，请重试或换个描述方式。'));
        }
      } else {
        // 继续当前任务或其他操作
        const turnOut = subscribeAssistantTextSnapshot(runtime.agent);

        const useActiveTaskContext = Boolean(activeTask && intent.type === 'task_advance');
        const taskContext = useActiveTaskContext && activeTask ? buildTaskContextPrefix(activeTask) : '';
        const finalPrompt = taskContext + userInput;

        currentTaskDescription = useActiveTaskContext && activeTask
          ? activeTask.name
          : intent.type === 'new_task'
            ? intent.taskName ?? userInput
            : userInput;
        runtime.escalation.initTask(currentTaskDescription, CWD);
        markReflectBaseline();

        try {
          await runTaskWithAbort(runtime, finalPrompt);
        } catch (err) {
          console.error(
            chalk.red('Task error:'),
            err instanceof Error ? err.message : String(err),
          );
        } finally {
          turnOut.unsubscribe();
        }

        // 检查是否有 phase_done 信号
        if (useActiveTaskContext && activeTask) {
          const signal = parsePhaseSignal(turnOut.getText());

          if (signal?.type === 'phase_done') {
            await tasksMgr.completePhase(activeTask.id);
            const updatedTask = await tasksMgr.getActive();
            if (updatedTask && hasExecutableCurrentPhase(updatedTask)) {
              if (isYoloMode(runtime)) {
                console.log(chalk.green(`\n  [Phase ${signal.phaseIndex + 1} 完成] 进入 Phase ${updatedTask.active_phase_index + 1}，YOLO 自动继续。`));
                await runConsoleActivePhase(runtime, updatedTask);
              } else {
                console.log(chalk.green(`\n  [Phase ${signal.phaseIndex + 1} 完成] 进入 Phase ${updatedTask.active_phase_index + 1}。回复“继续”执行下一 Phase。`));
              }
            } else if (updatedTask && isAwaitingUserReview(updatedTask)) {
              await finalizePendingArchiveForReview(updatedTask, tasksMgr);
              console.log(chalk.green('\n  ' + formatAwaitingReviewMessage(updatedTask)));
            } else {
              console.log(chalk.green(`\n  [任务完成] ${activeTask.name}`));
              lastPlanSnapshot = null;
            }
          }
        }
      }
    }

    // 三级失败升级后，向用户展示待答问题
    const pendingQ = runtime.escalation.takePendingQuestion();
    if (pendingQ) {
      console.log(chalk.yellow('\n  [需要你的帮助] ' + pendingQ.context));
      const answer = await rl.question(chalk.yellow('  你的回答（直接回车跳过）: '));
      if (answer.trim()) {
        await QuestionsManager.getInstance(MEMORY_DIR).resolve(pendingQ.id, answer.trim());
        console.log(chalk.green('  已记录，下次遇到类似问题会参考。'));
      }
    }
  }

  rl.close();
}

/**
 * TTY interactive path: pi-tui Student shell (ADR-009).
 * Esc aborts the current agent turn; Ctrl+C exits the shell.
 * Ctrl+P cycles Plan/Agents overlay in compact width.
 * promptSettings uses the bottom Composer (question lands in transcript).
 */
async function runInteractiveTui(): Promise<void> {
  initLogger();
  const restoreConsole = redirectConsoleForTUI();

  let runtime!: RuntimeState;
  let shell!: ShellHandle;
  let stopped = false;

  const inputQueue = createInputQueue();
  const sessionStore = new SessionStore(MEMORY_DIR);
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  const flushSession = async () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    try {
      await sessionStore.saveMessages(shell.getState().messages);
    } catch {
      // Persistence must never break the TUI loop.
    }
  };

  const scheduleSessionPersist = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void flushSession();
    }, 300);
  };

  const beginFreshSession = async (note?: string) => {
    await flushSession();
    const tasksMgr = TasksManager.getInstance(MEMORY_DIR);
    const parked = await tasksMgr.parkActiveTask();
    lastPlanSnapshot = null;
    currentTaskDescription = '';
    collaborationMode = 'execute';
    shell.clearTranscript();
    const session = await sessionStore.createSession({ cwd: CWD });
    shell.bridge.addMessage(
      'system',
      note
        ?? (parked
          ? `新会话。上次任务「${parked.name}」已 park。`
          : '新会话'),
    );
    await refreshWorkbench();
    shell.bridge.setStatus('ready');
    return session;
  };

  const refreshWorkbench = async (opts?: { streaming?: boolean; taskError?: boolean }) => {
    await syncWorkbenchProjection({
      shell,
      memoryDir: MEMORY_DIR,
      streaming: opts?.streaming,
      taskError: opts?.taskError,
      taskName: currentTaskDescription || null,
    });
    try {
      const active = await TasksManager.getInstance(MEMORY_DIR).getActive();
      if (active && sessionStore.currentSession && sessionStore.currentSession.task_id !== active.id) {
        await sessionStore.bindTask(active.id);
      }
    } catch {
      // ignore
    }
  };

  shell = startShell({
    onSubmit: (value) => {
      shell.bridge.addMessage('user', value);
      inputQueue.enqueueSubmit(value);
      shell.setPendingCount(inputQueue.pendingCount());
    },
    onAbort: () => {
      if (runtime?.agent.state.isStreaming) {
        void runtime.session.abort().catch(() => {});
        shell.bridge.setStatus('abort requested…');
      }
    },
    onExit: () => {
      stopped = true;
      void flushSession().finally(() => shell.unmount());
    },
    getStatusMeta: () => ({
      model: runtime
        ? `${runtime.config.model.provider}/${runtime.config.model.name}`
        : undefined,
      mode: collaborationMode === 'plan' ? 'plan' : runtime?.config.executionMode,
    }),
    onTranscriptChange: () => {
      scheduleSessionPersist();
    },
  });

  try {
    runtime = await createRuntime(await reloadConfig(), { bridge: shell.bridge });
    bindBridgeRiskConfirmation(runtime, shell.bridge);

    // Each TUI launch = new session file (Claude Code / Codex style).
    await beginFreshSession();

    while (!stopped) {
      const raced = await Promise.race([
        inputQueue.waitForSubmit().then((queued) => ({ kind: 'input' as const, queued })),
        shell.waitForExit().then(() => ({ kind: 'exit' as const })),
      ]);
      if (raced.kind === 'exit' || stopped) break;

      shell.setPendingCount(inputQueue.pendingCount());
      let userInput = raced.queued.value.trim();
      if (!userInput) continue;

      const command = parseCommand(userInput);
      if (command) {
        switch (command.type) {
          case 'paste':
            userInput = command.content;
            break;

          case 'quit':
            stopped = true;
            await flushSession();
            shell.unmount();
            continue;

          case 'help':
            shell.bridge.addMessage('system', getHelpText());
            continue;

          case 'clear':
            shell.clearTranscript();
            shell.bridge.setStatus('cleared');
            continue;

          case 'new': {
            if (runtime.agent.state.isStreaming) {
              shell.bridge.addMessage('system', '当前任务仍在运行，请先 Esc 中止再 /new。');
              continue;
            }
            await beginFreshSession();
            continue;
          }

          case 'sessions': {
            const entries = await sessionStore.listSessions(30);
            shell.bridge.addMessage(
              'system',
              `最近会话\n${sessionStore.formatList(entries, sessionStore.currentId)}`,
            );
            continue;
          }

          case 'resume': {
            if (runtime.agent.state.isStreaming) {
              shell.bridge.addMessage('system', '当前任务仍在运行，请先 Esc 中止再 /resume。');
              continue;
            }
            const query = command.query.trim();
            let loaded = null as Awaited<ReturnType<typeof sessionStore.loadSession>>;
            if (!query) {
              const entries = await sessionStore.listSessions(30);
              if (entries.length === 0) {
                shell.bridge.addMessage('system', '暂无历史会话可恢复。');
                continue;
              }
              const pickedId = await shell.pickSession(entries, {
                currentId: sessionStore.currentId,
                title: 'Resume',
              });
              if (!pickedId) {
                shell.bridge.addMessage('system', '已取消恢复。');
                continue;
              }
              await flushSession();
              loaded = await sessionStore.loadSession(pickedId);
            } else {
              await flushSession();
              loaded = await sessionStore.resolveSession(query);
            }
            if (!loaded) {
              shell.bridge.addMessage(
                'error',
                query
                  ? `未找到会话：${query}\n用 /resume 打开选择列表。`
                  : '未能加载所选会话。',
              );
              continue;
            }
            shell.loadTranscript(loaded.messages.map((m) => ({
              id: m.id,
              kind: m.kind,
              content: m.content,
              timestamp: m.timestamp,
              ...(m.meta ? { meta: m.meta } : {}),
            })));
            const tasksMgr = TasksManager.getInstance(MEMORY_DIR);
            await tasksMgr.parkActiveTask();
            if (loaded.task_id) {
              const resumed = await tasksMgr.resumeTask(loaded.task_id);
              if (resumed) {
                currentTaskDescription = resumed.name;
                lastPlanSnapshot = createPlanSnapshot(resumed);
              } else {
                currentTaskDescription = '';
                lastPlanSnapshot = null;
              }
            } else {
              currentTaskDescription = '';
              lastPlanSnapshot = null;
            }
            shell.bridge.addMessage(
              'system',
              `已恢复「${loaded.name}」· ${loaded.messages.length} 条消息`
              + (loaded.task_id ? ' · 已关联任务' : ''),
            );
            await refreshWorkbench();
            continue;
          }

          case 'status': {
            const active = await TasksManager.getInstance(MEMORY_DIR).getActive();
            shell.bridge.addMessage(
              'system',
              [
                `任务: ${currentTaskDescription || active?.name || '(无)'}`,
                `协作: ${collaborationMode === 'plan' ? 'plan（只规划）' : 'execute'}`,
                `模式: ${runtime.config.executionMode}`,
                `模型: ${runtime.config.model.provider}/${runtime.config.model.name}`,
                `LLM 超时: ${runtime.config.llm.requestTimeoutMs}ms`,
                active
                  ? `Plan: ${active.workflow_status} · phase ${active.active_phase_index + 1}/${active.phases.length}`
                  : 'Plan: (无活跃任务)',
              ].join('\n'),
            );
            await refreshWorkbench();
            continue;
          }

          case 'plan': {
            if (runtime.agent.state.isStreaming) {
              shell.bridge.addMessage('system', '当前任务仍在运行，不能切换 Plan 模式。');
              continue;
            }
            collaborationMode = 'plan';
            if (!command.goal) {
              shell.bridge.addMessage('system', PLAN_MODE_ENTERED);
              continue;
            }
            await refreshWorkbench({ streaming: true });
            shell.bridge.setStatus('planning…');
            let turnError = false;
            try {
              await runTuiPlannerAwareTurn(runtime, command.goal, {
                info: (message) => shell.bridge.addMessage('system', message),
                error: (message) => shell.bridge.addMessage('error', message),
                refresh: refreshWorkbench,
              }, { forcePlan: true });
            } catch (err) {
              turnError = true;
              const raw = err instanceof Error ? err.message : String(err);
              shell.bridge.addMessage('error', `Task error: ${formatAgentErrorForDisplay(raw) ?? raw}`);
            } finally {
              shell.bridge.clearStatus();
              await refreshWorkbench({ streaming: false, taskError: turnError });
              await flushSession();
            }
            continue;
          }

          case 'execute':
            collaborationMode = 'execute';
            shell.bridge.addMessage('system', PLAN_MODE_LEFT);
            continue;

          case 'revision': {
            const text = await handleRevisionCommand({ type: 'revision', content: command.content });
            shell.bridge.addMessage('system', text);
            await refreshWorkbench();
            continue;
          }

          case 'revisions': {
            const text = await handleRevisionCommand({ type: 'revisions', query: command.query });
            shell.bridge.addMessage('system', text);
            continue;
          }

          case 'task': {
            const tasksMgr = TasksManager.getInstance(MEMORY_DIR);
            const activeTask = await tasksMgr.getActive();
            if (command.subcommand === 'status') {
              shell.bridge.addMessage(
                'system',
                activeTask ? formatTaskStatus(activeTask) : '当前无活跃任务。',
              );
            } else if (command.subcommand === 'rename') {
              if (!activeTask) {
                shell.bridge.addMessage('system', '当前无活跃任务。');
              } else {
                await tasksMgr.renameTask(activeTask.id, command.name);
                currentTaskDescription = command.name;
                shell.bridge.addMessage('system', `已重命名为：${command.name}`);
              }
            } else if (command.subcommand === 'cancel') {
              const cancelled = await tasksMgr.cancelActiveTask();
              if (!cancelled) {
                shell.bridge.addMessage('system', '当前无活跃任务。');
              } else {
                lastPlanSnapshot = null;
                currentTaskDescription = '';
                shell.bridge.addMessage('system', `已丢弃当前任务：${cancelled.name}`);
              }
            }
            await refreshWorkbench();
            continue;
          }

          case 'archive': {
            try {
              const text = await executeArchiveCommand(CWD, command);
              shell.bridge.addMessage('system', text);
            } catch (error) {
              shell.bridge.addMessage(
                'error',
                `Archive error: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
            continue;
          }

          case 'candidates':
            shell.bridge.addMessage('system', '候选：待实现');
            continue;

          case 'context': {
            const text = formatContextInspection(await inspectContext(MEMORY_DIR));
            shell.bridge.addMessage('system', text);
            continue;
          }

          case 'init': {
            const run = (cmd: string, args: string[]) =>
              new Promise<string>((resolve, reject) =>
                execFile(cmd, args, { cwd: CWD }, (err, stdout, stderr) =>
                  err ? reject(new Error(stderr || err.message)) : resolve(stdout.trim()),
                ),
              );
            try {
              await run('git', ['init']);
              await run('git', ['add', '-A']);
              await run('git', ['commit', '--allow-empty', '-m', 'chore: initial commit by student-agent']);
              shell.bridge.addMessage('system', 'git 仓库已初始化并创建初始提交，快照回滚已启用。');
            } catch (e) {
              shell.bridge.addMessage('error', `/init 失败: ${e instanceof Error ? e.message : e}`);
            }
            continue;
          }

          case 'feedback': {
            const text = await recordQualityFeedback(command, runtime);
            shell.bridge.addMessage('system', text);
            if (isActionableDownFeedback(command)) {
              shell.bridge.addMessage('system', '收到 down 反馈：将尝试修复（见后续输出）。');
              // Reuse console repair path; messages go through EventRenderer → bridge when wired.
              await runConsoleFeedbackRepair(runtime, command.comment);
            }
            await refreshWorkbench();
            continue;
          }

          case 'review': {
            const reviewResult = await handleReviewCommand(command, currentTaskDescription);
            if (reviewResult.completedTask) {
              lastPlanSnapshot = null;
              currentTaskDescription = '';
            }
            shell.bridge.addMessage('system', reviewResult.message);
            await refreshWorkbench();
            continue;
          }

          case 'why': {
            shell.bridge.addMessage('system', await renderWhyCommand(command));
            continue;
          }

          case 'abort':
            if (!runtime.agent.state.isStreaming) {
              shell.bridge.addMessage('system', '当前没有运行中的任务。');
            } else {
              await runtime.session.abort();
              shell.bridge.addMessage('system', '已请求中止当前任务。');
            }
            continue;

          case 'login':
            shell.bridge.addMessage('system', loginHelpMessage(runtime));
            continue;

          case 'provider': {
            if (runtime.agent.state.isStreaming) {
              shell.bridge.addMessage('system', '当前任务仍在运行，不能切换 Provider。');
              continue;
            }
            try {
              const result = await runProviderProfileCommand({
                cwd: CWD,
                config: runtime.config,
                prompt: (q) => shell.bridge.promptSettings(q),
                log: (message) => shell.bridge.addMessage('system', message),
                activate: async () => createRuntime(await reloadConfig(), { bridge: shell.bridge }),
              });
              if (!result.switched) {
                shell.bridge.addMessage('system', '已取消。');
                continue;
              }
              runtime.renderer.cleanup();
              runtime.unsubscribe();
              runtime = result.value;
              bindBridgeRiskConfirmation(runtime, shell.bridge);
              shell.bridge.addMessage(
                'system',
                `OK: 已切换至 ${result.profileName}：${runtime.config.model.provider}/${runtime.config.model.name}`,
              );
              shell.bridge.setStatus('ready');
            } catch (err) {
              shell.bridge.addMessage('error', err instanceof Error ? err.message : String(err));
            }
            continue;
          }

          case 'model': {
            if (runtime.agent.state.isStreaming) {
              shell.bridge.addMessage('system', '当前任务仍在运行，不能切换模型。');
              continue;
            }
            const newName = await switchModelName({
              config: runtime.config,
              prompt: (q) => shell.bridge.promptSettings(q),
              log: (message) => shell.bridge.addMessage('system', message),
            });
            if (newName) {
              runtime.renderer.cleanup();
              runtime.unsubscribe();
              runtime = await createRuntime(await reloadConfig(), { bridge: shell.bridge });
              bindBridgeRiskConfirmation(runtime, shell.bridge);
              shell.bridge.addMessage(
                'system',
                `OK: 模型已切换为 ${runtime.config.model.provider}/${runtime.config.model.name}`,
              );
              shell.bridge.setStatus('ready');
            } else {
              shell.bridge.addMessage('system', '已取消。');
            }
            continue;
          }

          case 'setting': {
            runtime = await runSettingFlow(runtime, {
              prompt: (q) => shell.bridge.promptSettings(q),
              log: (message) => shell.bridge.addMessage('system', message),
              recreateRuntime: async () => createRuntime(await reloadConfig(), { bridge: shell.bridge }),
            });
            bindBridgeRiskConfirmation(runtime, shell.bridge);
            shell.bridge.setStatus('ready');
            continue;
          }

          case 'unknown':
            shell.bridge.addMessage('system', `未知命令: ${command.raw}\n输入 /help 查看可用命令`);
            continue;
        }

        if (command.type !== 'paste') continue;
      }

      // Planner-aware turn (same TasksManager truth as readline)
      await refreshWorkbench({ streaming: true });
      shell.bridge.setStatus(collaborationMode === 'plan' ? 'planning…' : 'running…');
      let turnError = false;
      try {
        await runTuiPlannerAwareTurn(runtime, userInput, {
          info: (message) => shell.bridge.addMessage('system', message),
          error: (message) => shell.bridge.addMessage('error', message),
          refresh: refreshWorkbench,
        }, { forcePlan: collaborationMode === 'plan' });
      } catch (err) {
        turnError = true;
        const raw = err instanceof Error ? err.message : String(err);
        shell.bridge.addMessage('error', `Task error: ${formatAgentErrorForDisplay(raw) ?? raw}`);
      } finally {
        shell.bridge.clearStatus();
        await refreshWorkbench({ streaming: false, taskError: turnError });
        await flushSession();
      }

      const pendingQ = runtime.escalation.takePendingQuestion();
      if (pendingQ) {
        const answer = await shell.bridge.promptSettings(
          `[需要你的帮助] ${pendingQ.context}\n（直接回车跳过）`,
        );
        if (answer.trim()) {
          await QuestionsManager.getInstance(MEMORY_DIR).resolve(pendingQ.id, answer.trim());
          shell.bridge.addMessage('system', '已记录，下次遇到类似问题会参考。');
        }
      }
    }
  } finally {
    const exitHint = formatSessionExitHint(sessionStore.currentSession);
    await flushSession().catch(() => {});
    runtime?.renderer.cleanup();
    runtime?.unsubscribe();
    shell.unmount();
    restoreConsole();
    if (exitHint) {
      console.log(chalk.dim(exitHint));
    }
  }
}

type TuiTurnNotify = {
  info: (message: string) => void;
  error: (message: string) => void;
  refresh: (opts?: { streaming?: boolean; taskError?: boolean }) => Promise<void>;
};

/**
 * TUI turn loop: classify → plan/create Task → execute phases (YOLO) → project Plan sidebar.
 * Mirrors the readline planner path but reports via the shell bridge.
 */
async function runTuiPlannerAwareTurn(
  runtime: RuntimeState,
  userInput: string,
  notify: TuiTurnNotify,
  options?: { forcePlan?: boolean },
): Promise<void> {
  const forcePlan = options?.forcePlan ?? collaborationMode === 'plan';
  const tasksMgr = TasksManager.getInstance(MEMORY_DIR);
  let activeTask = await tasksMgr.getActive();

  if (activeTask && isAwaitingUserReview(activeTask)) {
    const reviewResult = await maybeHandleNaturalReviewResponse(userInput, currentTaskDescription);
    if (reviewResult) {
      if (reviewResult.completedTask) lastPlanSnapshot = null;
      notify.info(reviewResult.message);
      await notify.refresh();
      return;
    }
  }

  const automaticRevisionMessage = await maybeRecordAutomaticPlanRevision(userInput, activeTask);
  if (automaticRevisionMessage) {
    notify.info(automaticRevisionMessage);
  }

  if (activeTask && isPlanConfirmationInput(userInput)) {
    collaborationMode = 'execute';
    await runActivePhase(runtime, activeTask, notify);
    await notify.refresh();
    return;
  }

  const feedbackSignal = detectNegativeFeedback(userInput);
  if (feedbackSignal.isNegative && activeTask) {
    await tasksMgr.incrementRetry(activeTask.id, feedbackSignal.extractedText);
    const updatedTask = await tasksMgr.getActive();
    const phase = updatedTask?.phases[updatedTask.active_phase_index];
    let ctx7Docs = '';
    if (phase && phase.retry_count >= 2 && runtime.config.features.context7) {
      const ctx7Client = new Context7Client({
        apiKey: runtime.config.context7.apiKey,
        timeoutMs: runtime.config.context7.timeoutMs,
        maxDocsChars: runtime.config.context7.maxDocsChars,
        projectKb: ProjectKbManager.getInstance(MEMORY_DIR),
      });
      ctx7Docs = await buildCtx7RetryContext(
        updatedTask?.name ?? activeTask.name,
        phase.feedbacks,
        ctx7Client,
        runtime.model,
      );
    }
    const taskContext = buildTaskContextPrefix(updatedTask ?? activeTask, ctx7Docs);
    currentTaskDescription = updatedTask?.name ?? activeTask.name;
    runtime.escalation.initTask(currentTaskDescription, CWD);
    markReflectBaseline();
    runtime.resetFileGuard();
    runtime.resetToolGuard();
    await runTaskWithAbort(runtime, taskContext + userInput);
    if (shouldShowAgentErrorMessage(runtime.agent.state.errorMessage)) {
      notify.error(`[Agent Error] ${formatAgentErrorForDisplay(runtime.agent.state.errorMessage)}`);
    }
    await notify.refresh();
    return;
  }

  const intent = forcePlan
    ? forcePlanIntent(userInput)
    : await classifyIntent(
      userInput,
      activeTask?.name ?? null,
      runtime.model,
    );

  if (forcePlan || (intent.type === 'new_task' && intent.requiresPlan)) {
    const planningOut = subscribeAssistantTextSnapshot(runtime.agent);

    currentTaskDescription = intent.taskName ?? userInput;
    runtime.escalation.initTask(currentTaskDescription, CWD);
    markReflectBaseline();

    const savedMessageCount = runtime.agent.state.messages.length;
    runtime.unsubscribe();

    let planningError: unknown;
    let signal: PhaseSignal | null = null;
    try {
      runtime.setFileGuardMode('planning');
      runtime.resetFileGuard();
      runtime.resetToolGuard();
      await runTaskWithAbort(runtime, buildPlanningPrompt(userInput));
      signal = parsePhaseSignal(planningOut.getText());
      if (!isValidTaskStartSignal(signal)) {
        await runTaskWithAbort(runtime, buildPlanningRepairPrompt(userInput));
        signal = parsePhaseSignal(planningOut.getText());
      }
    } catch (err) {
      planningError = err;
    } finally {
      runtime.setFileGuardMode('normal');
      planningOut.unsubscribe();
      runtime.unsubscribe = runtime.agent.subscribe((event) => runtime.renderer.handleEvent(event));
    }

    if (planningError) {
      runtime.agent.state.messages = runtime.agent.state.messages.slice(0, savedMessageCount);
      if (isInformationalFollowUp(userInput)) {
        await runTuiPlainPrompt(runtime, userInput, notify);
      } else {
        notify.error(
          `规划失败: ${planningError instanceof Error ? planningError.message : String(planningError)}`,
        );
      }
      return;
    }

    if (isValidTaskStartSignal(signal)) {
      const autoExec = isYoloMode(runtime) && !forcePlan;
      const newTask = await tasksMgr.createTask(
        signal.name,
        signal.phases,
        buildTaskCreateOptions(intent, signal.context, autoExec),
      );
      lastPlanSnapshot = createPlanSnapshot(newTask);
      notify.info(formatPlanAwaitingConfirmation(
        signal.name,
        signal.phases,
        autoExec,
      ));
      await notify.refresh();
      if (autoExec) {
        await runActivePhase(runtime, newTask, notify);
      }
      await notify.refresh();
      return;
    }

    if (signal?.type === 'phase_done' && activeTask) {
      await tasksMgr.completePhase(activeTask.id);
      const updatedTask = await tasksMgr.getActive();
      await notify.refresh();
      if (updatedTask && hasExecutableCurrentPhase(updatedTask)) {
        if (isYoloMode(runtime)) {
          notify.info(`[Phase ${signal.phaseIndex + 1} 完成] 进入 Phase ${updatedTask.active_phase_index + 1}，YOLO 自动继续。`);
          await runActivePhase(runtime, updatedTask, notify);
        } else {
          notify.info(`[Phase ${signal.phaseIndex + 1} 完成] 进入 Phase ${updatedTask.active_phase_index + 1}。回复“继续”执行下一 Phase。`);
        }
      } else if (updatedTask && isAwaitingUserReview(updatedTask)) {
        await finalizePendingArchiveForReview(updatedTask, tasksMgr);
        notify.info(formatAwaitingReviewMessage(updatedTask));
      } else {
        notify.info(`[任务完成] ${activeTask.name}`);
        lastPlanSnapshot = null;
      }
      await notify.refresh();
      return;
    }

    runtime.agent.state.messages = runtime.agent.state.messages.slice(0, savedMessageCount);
    if (isInformationalFollowUp(userInput)) {
      await runTuiPlainPrompt(runtime, userInput, notify);
    } else {
      notify.error('[规划失败] Agent 未输出有效 Phase 行（需 TASK_START 内含 2–5 个 Phase N: …）。请重试。');
    }
    return;
  }

  // Continue current task / plain answer
  const turnOut = subscribeAssistantTextSnapshot(runtime.agent);

  const useActiveTaskContext = Boolean(activeTask && intent.type === 'task_advance');
  const prompt = useActiveTaskContext && activeTask
    ? buildTaskContextPrefix(activeTask) + userInput
    : userInput;

  currentTaskDescription = useActiveTaskContext && activeTask
    ? activeTask.name
    : userInput;
  runtime.escalation.initTask(currentTaskDescription, CWD);
  markReflectBaseline();

  try {
    runtime.resetFileGuard();
    runtime.resetToolGuard();
    await runTaskWithAbort(runtime, prompt);
    if (shouldShowAgentErrorMessage(runtime.agent.state.errorMessage)) {
      notify.error(`[Agent Error] ${formatAgentErrorForDisplay(runtime.agent.state.errorMessage)}`);
    }
  } finally {
    turnOut.unsubscribe();
  }

  activeTask = await tasksMgr.getActive();
  const signal = parsePhaseSignal(turnOut.getText());
  if (signal?.type === 'phase_done' && activeTask) {
    await tasksMgr.completePhase(activeTask.id);
    const updatedTask = await tasksMgr.getActive();
    if (updatedTask && hasExecutableCurrentPhase(updatedTask)) {
      if (isYoloMode(runtime)) {
        notify.info(`[Phase ${signal.phaseIndex + 1} 完成] YOLO 自动继续。`);
        await runActivePhase(runtime, updatedTask, notify);
      } else {
        notify.info(`[Phase ${signal.phaseIndex + 1} 完成] 回复“继续”执行下一 Phase。`);
      }
    } else if (updatedTask && isAwaitingUserReview(updatedTask)) {
      await finalizePendingArchiveForReview(updatedTask, tasksMgr);
      notify.info(formatAwaitingReviewMessage(updatedTask));
    } else if (!updatedTask) {
      notify.info(`[任务完成] ${activeTask.name}`);
      lastPlanSnapshot = null;
    }
  }
  await notify.refresh();
}

async function runTuiPlainPrompt(
  runtime: RuntimeState,
  userInput: string,
  notify: TuiTurnNotify,
): Promise<void> {
  currentTaskDescription = userInput;
  runtime.escalation.initTask(currentTaskDescription, CWD);
  markReflectBaseline();
  runtime.resetFileGuard();
  runtime.resetToolGuard();
  await runTaskWithAbort(runtime, userInput);
  if (shouldShowAgentErrorMessage(runtime.agent.state.errorMessage)) {
    notify.error(`[Agent Error] ${formatAgentErrorForDisplay(runtime.agent.state.errorMessage)}`);
  }
}

async function runActivePhase(
  runtime: RuntimeState,
  task: Task,
  notify?: TuiTurnNotify,
): Promise<void> {
  const info = notify?.info ?? ((message: string) => console.log(chalk.green(message)));
  const error = notify?.error ?? ((message: string) => console.error(chalk.red(message)));
  const tasksMgr = TasksManager.getInstance(MEMORY_DIR);
  await tasksMgr.updateWorkflowStatus(task.id, 'executing');
  await notify?.refresh({ streaming: true });
  const activeTask = await tasksMgr.getTask(task.id) ?? task;
  const phase = activeTask.phases[activeTask.active_phase_index];
  if (!phase) {
    error(`[任务错误] ${activeTask.name} 没有可执行的当前 Phase。`);
    return;
  }

  currentTaskDescription = activeTask.name;
  runtime.escalation.initTask(activeTask.name, CWD);
  markReflectBaseline();

  const phaseOut = subscribeAssistantTextSnapshot(runtime.agent);

  try {
    runtime.resetFileGuard();
    runtime.resetToolGuard();
    await runTaskWithAbort(
      runtime,
      buildTaskContextPrefix(activeTask)
      + buildPhaseExecutionPrompt(activeTask.name, phase.description, activeTask.active_phase_index, activeTask.phases.length),
    );
  } catch (err) {
    error(
      `Phase ${activeTask.active_phase_index + 1} 执行失败: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    phaseOut.unsubscribe();
  }

  const signal = parsePhaseSignal(phaseOut.getText());
  if (signal?.type !== 'phase_done') {
    await notify?.refresh();
    return;
  }

  await tasksMgr.completePhase(activeTask.id);
  const updatedTask = await tasksMgr.getActive();
  await notify?.refresh();
  if (updatedTask && hasExecutableCurrentPhase(updatedTask)) {
    if (isYoloMode(runtime)) {
      info(`[Phase ${activeTask.active_phase_index + 1} 完成] 进入 Phase ${updatedTask.active_phase_index + 1}，YOLO 自动继续。`);
      await runActivePhase(runtime, updatedTask, notify);
      return;
    }
    info(`[Phase ${activeTask.active_phase_index + 1} 完成] 进入 Phase ${updatedTask.active_phase_index + 1}。回复“继续”执行下一 Phase。`);
  } else if (updatedTask && isAwaitingUserReview(updatedTask)) {
    await finalizePendingArchiveForReview(updatedTask, tasksMgr);
    info(formatAwaitingReviewMessage(updatedTask));
  } else {
    info(`[任务完成] ${activeTask.name}`);
    lastPlanSnapshot = null;
  }
}


type FeedbackCommand = Extract<SlashCommand, { type: 'feedback' }>;
type RevisionCommand =
  | { type: 'revision'; content: string }
  | { type: 'revisions'; query: string };
type ReviewCommand = Extract<SlashCommand, { type: 'review' }>;
type WhyCommand = Extract<SlashCommand, { type: 'why' }>;

async function recordQualityFeedback(
  feedback: Pick<FeedbackCommand, 'rating' | 'comment'>,
  runtime: RuntimeState,
): Promise<string> {
  if (!runtime.config.features.qualityWatchdog) {
    return isActionableDownFeedback(feedback)
      ? 'qualityWatchdog 未启用；这条负反馈会直接用于返工。'
      : 'qualityWatchdog 未启用';
  }

  await QualityFeedbackManager.getInstance(MEMORY_DIR).append({
    task_id: `manual_${Date.now()}`,
    session_ref: `session_${Date.now()}`,
    task_description: currentTaskDescription,
    rating: feedback.rating,
    comment: feedback.comment,
  });

  return isActionableDownFeedback(feedback)
    ? 'OK: 已记录质量反馈，开始根据反馈返工。'
    : 'OK: 已记录质量反馈';
}

function isActionableDownFeedback(feedback: Pick<FeedbackCommand, 'rating' | 'comment'>): boolean {
  return feedback.rating === 'down' && feedback.comment.trim().length > 0;
}


async function runConsoleFeedbackRepair(runtime: RuntimeState, feedback: string): Promise<void> {
  const retryContext = await recordFeedbackRetryForActivePhase(runtime, feedback);
  const taskName = (retryContext.task?.name ?? currentTaskDescription) || '用户反馈返工';
  currentTaskDescription = taskName;
  runtime.escalation.initTask(taskName, CWD);
  markReflectBaseline();
  try {
    await runTaskWithAbort(
      runtime,
      buildTaskContextPrefix(retryContext.task, retryContext.ctx7Docs)
      + buildFeedbackRepairPrompt(taskName, feedback),
    );
  } catch (err) {
    console.error(
      chalk.red('反馈返工失败:'),
      err instanceof Error ? err.message : String(err),
    );
  }
}


async function runConsoleActivePhase(runtime: RuntimeState, task: Task): Promise<void> {
  await runActivePhase(runtime, task);
}

function isYoloMode(runtime: RuntimeState): boolean {
  return runtime.config.executionMode === 'yolo';
}

/** Force a planning turn (Codex /plan): always requires plan, never auto-executes via YOLO. */
function forcePlanIntent(input: string): IntentResult {
  const taskName = input.replace(/\s+/g, ' ').trim().slice(0, 48) || 'Plan';
  return {
    type: 'new_task',
    taskName,
    level: 3,
    reason: 'explicit-/plan-mode',
    requiresPlan: true,
    requiresUserAcceptance: true,
    requiresVisualReview: false,
  };
}

/**
 * Streamed message_update often carries a full text snapshot, not a delta.
 * Replacing (not concatenating) avoids corrupting TASK_START / Phase parsing.
 */
function subscribeAssistantTextSnapshot(
  agent: { subscribe: (listener: (event: any) => void) => () => void },
): { getText: () => string; unsubscribe: () => void } {
  let text = '';
  const unsubscribe = agent.subscribe((event) => {
    if (event.type !== 'message_update' || event.message?.role !== 'assistant') return;
    const textContent = event.message.content?.find((c: { type: string }) => c.type === 'text');
    if (textContent && textContent.type === 'text' && typeof textContent.text === 'string') {
      text = textContent.text;
    }
  });
  return {
    getText: () => text,
    unsubscribe,
  };
}

function isValidTaskStartSignal(
  signal: PhaseSignal | null,
): signal is Extract<PhaseSignal, { type: 'task_start' }> {
  return signal?.type === 'task_start' && signal.phases.length > 0;
}

function isPlanConfirmationInput(input: string): boolean {
  return PLAN_CONFIRM_RE.test(input.trim());
}


function hasExecutableCurrentPhase(task: Task): boolean {
  return task.status === 'active'
    && task.workflow_status === 'executing'
    && task.phases[task.active_phase_index]?.status === 'in_progress';
}

function isAwaitingUserReview(task: Task): boolean {
  return task.workflow_status === 'user_review' || task.workflow_status === 'visual_review';
}

function formatAwaitingReviewMessage(task: Task): string {
  return [
    `[等待验收] ${task.name} 已完成执行，当前状态：${task.workflow_status}。`,
    '可以直接回复“可以/满意/就这样”完成任务；也可以直接说修改意见，例如“按钮太挤了”。',
    '快捷命令：/review ok 接受，/review down <反馈> 请求修订。',
  ].join('\n');
}

async function finalizePendingArchiveForReview(task: Task, tasksMgr: TasksManager): Promise<void> {
  await new ArchiveWorkflowCoordinator(new ArchiveService({ root: CWD }), tasksMgr).applyAfterVerification(task);
}


function formatPlanAwaitingConfirmation(name: string, phases: string[], autoExec = false): string {
  const lines = [
    `[规划完成] ${name}，共 ${phases.length} 个 Phase。`,
    ...phases.map((phase, index) => `Phase ${index + 1}: ${phase}`),
    autoExec
      ? 'YOLO：自动执行'
      : '等待确认后执行',
  ];
  return lines.join('\n');
}

function formatTaskStatus(task: Task): string {
  const phase = task.phases[task.active_phase_index];
  const memory = task.working_memory;
  const lines = [
    `任务：${task.name}`,
    `Workflow：${task.workflow_status} · Level ${task.level} · status=${task.status}`,
    `Phase ${task.active_phase_index + 1}/${task.phases.length}：${phase?.description ?? ''}`,
    `当前 Phase 状态：${phase?.status ?? 'unknown'} · 重试次数：${phase?.retry_count ?? 0}`,
  ];

  if (memory.goal) lines.push(`Goal：${memory.goal}`);
  lines.push(`Working Memory：${memory.phase} · ${memory.currentStep || 'no current step'}`);
  appendStatusList(lines, 'Acceptance Criteria', taskWorkingMemoryItems(task, 'acceptance_criterion'));
  appendStatusList(lines, 'Constraints', taskWorkingMemoryItems(task, 'constraint'));
  appendStatusList(lines, 'Open Questions', taskWorkingMemoryItems(task, 'open_question'));
  appendStatusList(lines, 'User Preferences', taskWorkingMemoryItems(task, 'user_preference'));
  appendStatusList(lines, 'Verification', taskWorkingMemoryItems(task, 'verification_result'));
  appendStatusList(lines, 'Changed Files', taskWorkingMemoryItems(task, 'changed_file'));
  appendStatusList(lines, 'Read Files', memory.readFiles.map((file) => file.path));
  appendStatusList(lines, 'Written Files', memory.writeFiles.map((file) => file.path));
  appendStatusList(lines, 'Recent Errors', memory.recentErrors.map((error) => error.summary));

  if (task.requires_visual_review || task.requires_user_acceptance) {
    lines.push(`Review：visual=${task.requires_visual_review ? 'required' : 'not-required'} · user=${task.requires_user_acceptance ? 'required' : 'not-required'}`);
  }

  return lines.join('\n');
}

function appendStatusList(lines: string[], label: string, values: string[]): void {
  if (values.length === 0) return;
  lines.push(`${label}：`);
  values.slice(-6).forEach((value) => lines.push(`- ${value}`));
}

function taskWorkingMemoryItems(task: Task, kind: string): string[] {
  const memory = task.working_memory;
  const artifactItems = memory.artifactRefs
    .filter((artifact) => artifact.kind === kind)
    .map((artifact) => artifact.summary);
  const signalItems = memory.recentSignals
    .filter((signal) => signal.kind === kind)
    .map((signal) => signal.summary);
  const todoItems = kind === 'acceptance_criterion'
    ? memory.todos.map((todo) => todo.content)
    : [];
  const writtenItems = kind === 'changed_file'
    ? memory.writeFiles.map((file) => file.path)
    : [];
  return [...new Set([...artifactItems, ...signalItems, ...todoItems, ...writtenItems])];
}

function buildTaskCreateOptions(intent: Awaited<ReturnType<typeof classifyIntent>>, context: Extract<ReturnType<typeof parsePhaseSignal>, { type: 'task_start' }>['context'] | undefined, yoloMode: boolean) {
  return {
    level: intent.level,
    workflowStatus: yoloMode ? 'executing' as const : 'awaiting_plan_approval' as const,
    requiresUserAcceptance: intent.requiresUserAcceptance || context?.requires_user_acceptance === true,
    requiresVisualReview: intent.requiresVisualReview || context?.requires_visual_review === true,
    workingMemory: {
      goal: context?.goal || intent.taskName || '',
      acceptance_criteria: context?.acceptance_criteria ?? [],
      constraints: context?.constraints ?? [],
      open_questions: context?.open_questions ?? [],
    },
  };
}




async function recordFeedbackRetryForActivePhase(
  runtime: RuntimeState,
  feedback: string,
): Promise<{ task: Task | null; ctx7Docs: string }> {
  const tasksMgr = TasksManager.getInstance(MEMORY_DIR);
  const activeTask = await tasksMgr.getActive();
  if (!activeTask) {
    return { task: null, ctx7Docs: '' };
  }

  await tasksMgr.incrementRetry(activeTask.id, feedback);
  const updatedTask = await tasksMgr.getActive();
  const phase = updatedTask?.phases[updatedTask.active_phase_index];
  let ctx7Docs = '';

  if (updatedTask && phase && phase.retry_count >= 2 && runtime.config.features.context7) {
    const ctx7Client = new Context7Client({
      apiKey: runtime.config.context7.apiKey,
      timeoutMs: runtime.config.context7.timeoutMs,
      maxDocsChars: runtime.config.context7.maxDocsChars,
      projectKb: ProjectKbManager.getInstance(MEMORY_DIR),
    });
    ctx7Docs = await buildCtx7RetryContext(
      updatedTask.name,
      phase.feedbacks,
      ctx7Client,
      runtime.model,
    );
  }

  return { task: updatedTask, ctx7Docs };
}


async function runConsolePlainAnswer(runtime: RuntimeState, prompt: string): Promise<void> {
  currentTaskDescription = prompt.trim().slice(0, 60) || '普通回答';
  runtime.escalation.initTask(currentTaskDescription, CWD);
  markReflectBaseline();

  try {
    await runTaskWithAbort(runtime, prompt);
  } catch (err) {
    console.error(
      chalk.red('Task error:'),
      err instanceof Error ? err.message : String(err),
    );
  }
}


async function runConsoleFollowUpPrompt(runtime: RuntimeState, prompt: string): Promise<void> {
  const taskName = prompt.trim().slice(0, 60) || '后续任务';
  currentTaskDescription = taskName;
  runtime.escalation.initTask(taskName, CWD);
  markReflectBaseline();
  try {
    await runTaskWithAbort(runtime, prompt);
  } catch (err) {
    console.error(
      chalk.red('后续任务失败:'),
      err instanceof Error ? err.message : String(err),
    );
  }
}

function buildFeedbackRepairPrompt(taskName: string, feedback: string): string {
  return [
    '[用户负反馈返工]',
    `刚完成的任务：${taskName}`,
    `用户反馈：${feedback.trim()}`,
    '',
    '请把这条反馈当作当前任务的返工要求：',
    '- 先定位原因，不要只回复解释',
    '- 如果是运行时/渲染/网络层错误，优先复现并检查相关页面、路由、资源引用和控制台错误',
    '- 修复后运行可用的相关测试或检查',
    '- 完成后说明修复点和验证结果',
  ].join('\n');
}

async function recordReviewCommand(command: ReviewCommand, taskDescription: string): Promise<void> {
  await QualityFeedbackManager.getInstance(MEMORY_DIR).append({
    task_id: `review_${Date.now()}`,
    session_ref: `session_${Date.now()}`,
    task_description: taskDescription,
    rating: command.rating === 'down' ? 'down' : 'up',
    comment: command.rating === 'ok'
      ? `ok${command.comment ? `: ${command.comment}` : ''}`
      : command.comment,
  });
}

async function maybeHandleNaturalReviewResponse(
  input: string,
  taskDescription: string,
): Promise<{ message: string; completedTask: boolean } | null> {
  const signal = detectNaturalReviewResponse(input);
  if (signal.type === 'ambiguous') {
    return null;
  }

  const command: ReviewCommand = signal.type === 'accepted'
    ? { type: 'review', rating: 'ok', comment: signal.text }
    : { type: 'review', rating: 'down', comment: signal.text };

  return handleReviewCommand(command, taskDescription);
}

async function handleReviewCommand(
  command: ReviewCommand,
  taskDescription: string,
): Promise<{ message: string; completedTask: boolean }> {
  await recordReviewCommand(command, taskDescription);

  const tasksMgr = TasksManager.getInstance(MEMORY_DIR);
  const activeTask = await tasksMgr.getActive();
  if (!activeTask || !isAwaitingUserReview(activeTask)) {
    return { message: 'OK: 已记录本轮信心投票', completedTask: false };
  }

  const comment = command.comment.trim();
  if (command.rating === 'down') {
    if (activeTask.pending_archive_acceptance) {
      await new ArchiveWorkflowCoordinator(new ArchiveService({ root: CWD }), tasksMgr).handleUserReview(activeTask, comment || '需要修改');
    }
    await tasksMgr.requestRevision(activeTask.id, comment || '用户未接受当前结果，需要继续修订。');
    return {
      message: `已记录用户未接受当前结果，任务进入 revision_requested：${comment || '请继续补充修改意见。'}`,
      completedTask: false,
    };
  }

  if (activeTask.pending_archive_acceptance) {
    await new ArchiveWorkflowCoordinator(new ArchiveService({ root: CWD }), tasksMgr).handleUserReview(activeTask, comment || '可以');
  }
  await tasksMgr.acceptTask(activeTask.id, comment || `用户 /review ${command.rating}`);
  await tasksMgr.completeTask(activeTask.id, comment || 'User accepted task result.');
  return {
    message: `用户已验收任务：${activeTask.name}`,
    completedTask: true,
  };
}

async function renderWhyCommand(command: WhyCommand): Promise<string> {
  const entries = await new WhyManager(MEMORY_DIR).explain(command.query, { trace: command.trace });
  if (entries.length === 0) {
    return '没有找到相关决策来源。';
  }
  return [
    command.trace ? '决策来源追溯：' : '直接决策来源：',
    ...entries.map((entry) => [
      `- [${entry.source}] ${entry.id}: ${entry.summary}`,
      ...(entry.trace?.map((line) => `  ${line}`) ?? []),
    ].join('\n')),
  ].join('\n');
}

async function handleRevisionCommand(command: RevisionCommand): Promise<string> {
  const manager = PlanRevisionManager.getInstance(MEMORY_DIR);
  if (command.type === 'revisions') {
    const revisions = await manager.search(command.query, 10);
    if (revisions.length === 0) return '没有找到计划修订记忆。';
    return formatPlanRevisions(revisions);
  }

  const tasksMgr = TasksManager.getInstance(MEMORY_DIR);
  const activeTask = await tasksMgr.getActive();
  if (!activeTask) {
    return '当前没有活跃任务，无法记录计划修订。';
  }

  const snapshot = lastPlanSnapshot ?? createPlanSnapshot(activeTask);
  const detected = detectPlanRevisionIntent(command.content, activeTask, snapshot) ?? {
    agentPlanSummary: snapshot.summary,
    userRevisionSummary: command.content.trim(),
    diffType: 'implementation_strategy_change' as const,
    reasonInferred: '用户显式记录了一次计划修订，应作为后续规划的低优先级证据。',
  };

  const revision = await manager.append({
    taskId: activeTask.id,
    sessionRef: `session_${Date.now()}`,
    agentPlanSummary: detected.agentPlanSummary,
    userRevisionSummary: detected.userRevisionSummary,
    diffType: detected.diffType,
    reasonInferred: detected.reasonInferred,
    outcome: 'accepted',
    trustStatus: 'user_confirmed',
    sourceType: 'explicit-command',
  });

  return `OK: 已记录计划修订：${revision.id}`;
}

async function maybeRecordAutomaticPlanRevision(input: string, activeTask: Task | null): Promise<string | null> {
  const detected = detectPlanRevisionIntent(input, activeTask, lastPlanSnapshot);
  if (!activeTask || !detected) return null;

  try {
    const revision = await PlanRevisionManager.getInstance(MEMORY_DIR).append({
      taskId: activeTask.id,
      sessionRef: `session_${Date.now()}`,
      agentPlanSummary: detected.agentPlanSummary,
      userRevisionSummary: detected.userRevisionSummary,
      diffType: detected.diffType,
      reasonInferred: detected.reasonInferred,
      outcome: 'observed',
      trustStatus: 'unverified',
      sourceType: 'automatic-detection',
    });
    return `OK: 已记录计划修订证据：${revision.id}`;
  } catch (err) {
    return `[PlanRevision] 记录失败：${err instanceof Error ? err.message : String(err)}`;
  }
}

function formatPlanRevisions(revisions: PlanRevision[]): string {
  return [
    '计划修订记忆：',
    ...revisions.map((revision) => [
      `- ${revision.id} [${revision.diff_type}/${revision.trust_status}]`,
      `  用户修订：${revision.user_revision_summary}`,
      `  推断：${revision.reason_inferred}`,
    ].join('\n')),
  ].join('\n');
}

async function reloadConfig(): Promise<StudentAgentConfig> {
  // 先加载全局 env（~/.student-agent/.env），再用项目 .env 覆盖
  await loadEnvLayersPreservingAmbient(async () => {
    await loadEnvFile({ cwd: GLOBAL_CONFIG_DIR, filename: '.env', override: true });
    const initialConfig = await loadStudentAgentConfig({ cwd: CWD });
    await loadEnvFile({ cwd: CWD, filename: initialConfig.envFile, override: true });
  });
  const config = await loadStudentAgentConfig({ cwd: CWD });
  normalizeProviderApiKeyEnv(config.model.provider);
  return config;
}

interface RuntimeOptions {
  onContextAssemblyTrace?: (trace: EvalContextAssemblyTrace) => void;
  onProtectedEvents?: (events: ProtectedEvalEvent[]) => void;
  memoryDir?: string;
  runMode?: ContextRunMode;
  bridge?: UiBridge;
}

async function createRuntime(
  config: StudentAgentConfig,
  options: RuntimeOptions = {},
): Promise<RuntimeState> {
  const model = buildModel(config);
  const abortRef = { abort: () => {} };
  const riskConfirmationRef: ConfirmationProviderRef = { current: null };
  const { hooks, escalation, resetFileGuard, resetToolGuard, setFileGuardMode, resetRiskGuard } = buildHooks(
    config,
    abortRef,
    riskConfirmationRef,
    options,
  );

  // Pi SDK 只认识内置 provider 的 env var（OPENAI_API_KEY 等）。
  // 对自定义 provider，用 API_KEY_MAP 规则找到对应 env var，显式注入 apiKey。
  const apiKeyEnvName = config.model.apiKeyEnv ?? getApiKeyEnvName(config.model.provider);
  const resolvedApiKey = process.env[apiKeyEnvName];

  const { session, agent } = await createStudentSession({
    cwd: CWD,
    model,
    hooks,
    apiKey: resolvedApiKey,
    projectArchive: config.features.projectArchive,
    llm: {
      timeoutMs: config.llm.requestTimeoutMs,
      maxTokens: config.llm.maxOutputTokens,
      maxRetries: config.llm.maxRetries,
      maxRetryDelayMs: config.llm.maxRetryDelayMs,
      apiKey: resolvedApiKey,
    },
  });

  // 绑定 abort 回调：session 创建后才能访问 session.abort
  abortRef.abort = () => session.abort().catch(() => {});

  const renderer = new EventRenderer(options.bridge);
  const unsubscribe = agent.subscribe((event) => {
    renderer.handleEvent(event);
  });

  return {
    config,
    session,
    agent,
    escalation,
    renderer,
    unsubscribe,
    model,
    resetFileGuard,
    resetToolGuard,
    setFileGuardMode,
    setRiskConfirmationProvider: (provider) => {
      riskConfirmationRef.current = provider;
      resetRiskGuard();
    },
  };
}

interface SettingFlowIo {
  prompt: (question: string) => Promise<string>;
  log: (message: string) => void;
  recreateRuntime: () => Promise<RuntimeState>;
}

function loginHelpMessage(runtime: RuntimeState): string {
  return [
    'Student Agent 没有 /login。',
    '请用 /setting 配置 Provider 与 API Key（写入 ~/.student-agent/.env）。',
    '已有 DeepSeek key 时：选 deepseek，环境变量一般为 DEEPSEEK_API_KEY。',
    '也可用 /provider 切换已保存的 profile，或 /model 只改模型名。',
    `当前配置：${runtime.config.model.provider}/${runtime.config.model.name}（见 /status）。`,
  ].join('\n');
}

async function runSettingFlow(
  runtime: RuntimeState,
  io: SettingFlowIo,
): Promise<RuntimeState> {
  if (runtime.agent.state.isStreaming) {
    io.log('当前任务仍在运行，不能修改设置。');
    return runtime;
  }

  const target = await chooseSettingTarget(io.prompt);
  if (target === 'cancel') {
    io.log('已取消设置。');
    return runtime;
  }

  await runStartupInitializer({
    cwd: CWD,
    config: runtime.config,
    prompt: io.prompt,
    log: io.log,
    forceModelProviderSetup: target === 'model',
    forceEmbeddingSetup: target === 'embedding',
  });

  runtime.renderer.cleanup();
  runtime.unsubscribe();
  const nextRuntime = await io.recreateRuntime();
  io.log(`OK: 已应用设置：${nextRuntime.config.model.provider}/${nextRuntime.config.model.name}`);
  return nextRuntime;
}

async function chooseSettingTarget(
  prompt: (question: string) => Promise<string>,
): Promise<SettingTarget> {
  const targetPrompt = buildSettingTargetPrompt();
  const answer = await prompt(`${targetPrompt.menu}\n${targetPrompt.question}`);
  return parseSettingTargetAnswer(answer);
}

async function runTaskWithAbort(runtime: RuntimeState, userInput: string): Promise<void> {
  let aborted = false;

  const keypressHandler = (_str: unknown, key: { name?: string } | undefined) => {
    if (key?.name === 'escape' && !aborted) {
      aborted = true;
      process.stdout.write(chalk.yellow('\n  [Esc] 正在中断任务...\n'));
      runtime.session.abort().catch(() => {});
    }
  };

  const isTTY = process.stdin.isTTY;
  if (isTTY) {
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', keypressHandler);
  }

  try {
    runtime.resetFileGuard();
    runtime.resetToolGuard();
    await runtime.session.prompt(userInput);
    await runtime.agent.waitForIdle();

    if (!aborted && runtime.agent.state.errorMessage) {
      const shown = formatAgentErrorForDisplay(runtime.agent.state.errorMessage)
        ?? runtime.agent.state.errorMessage;
      console.error(chalk.red(`[Agent Error] ${shown}`));
    }
  } finally {
    if (isTTY) {
      process.stdin.removeListener('keypress', keypressHandler);
      process.stdin.setRawMode(false);
    }
  }
}

main().catch((err: unknown) => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
