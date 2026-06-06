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
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import chalk from 'chalk';
import { getModel, getModels, completeSimple, type Api, type Model } from '@mariozechner/pi-ai';
import { loadEnvFile } from '../core/env.js';
import { getProjectCwd } from '../core/paths.js';
import { loadStudentAgentConfig, GLOBAL_CONFIG_DIR } from '../core/config/loader.js';
import type { StudentAgentConfig } from '../core/config/types.js';
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
import { createRiskGuardHook, type ConfirmationProviderRef } from './hooks/risk-guard.js';
import { FailureEscalationContext } from './hooks/failure-escalation.js';
import { createMemoryHook } from './hooks/memory.js';
import { createReflectHook, markReflectBaseline } from './hooks/reflect.js';
import { createQualityWatchdogHook } from './hooks/quality-watchdog.js';
import { buildSettingTargetPrompt, parseSettingTargetAnswer, type SettingTarget } from './setting-target.js';
import { shouldShowAgentErrorMessage } from './tui-message-policy.js';
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
import { parseCommand, getHelpText, COMMAND_COMPLETIONS, type SlashCommand } from '../cli/command-parser.js';
import { printBanner } from '../cli/banner.js';
import { startSelectedTUI, isTTY } from '../tui-runtime.js';
import { createInputQueue } from '../tui/input-queue.js';
import { createPasteBuffer } from '../tui/paste-buffer.js';
import { createBufferedPromptLog } from '../tui/prompt-log.js';
import { clearTerminalViewport } from '../tui/terminal.js';
import type { TUIBridge } from '../tui/bridge.js';
import { initLogger, logger, setTuiMode } from '../tui/logger.js';
import { initDebugEvents } from '../tui/debug-events.js';
import { TasksManager } from '../memory/tasks/manager.js';
import type { Task } from '../memory/tasks/types.js';
import { PlanRevisionManager } from '../memory/plan-revisions/manager.js';
import type { PlanRevision } from '../memory/plan-revisions/types.js';
import { ProjectKbManager } from '../memory/project-kb/manager.js';
import { parsePhaseSignal, type PhaseSignal } from '../core/task-planner/phase-signal.js';
import { createPlanSnapshot, detectPlanRevisionIntent, type PlanSnapshot } from '../core/task-planner/plan-revision-detector.js';
import { detectNegativeFeedback } from '../core/task-planner/feedback-detector.js';
import { detectNaturalReviewResponse } from '../core/task-planner/review-detector.js';
import { classifyIntent, isInformationalFollowUp } from '../core/task-planner/intent-classifier.js';
import { buildTaskContextPrefix } from '../core/task-planner/task-context-builder.js';
import { buildCtx7RetryContext } from '../core/task-planner/ctx7-retry-builder.js';
import { buildPlanningPrompt, buildPhaseExecutionPrompt } from '../core/task-planner/planning-prompt.js';
import { PromptConfirmationProvider } from '../core/executor/confirmation.js';
import type { ConfirmationProvider } from '../core/executor/types.js';

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

const PLAN_CONFIRM_RE = /^(确认|开始|执行|继续|go|yes|y)$/i;
const ACTIVE_TASK_CONTINUE_RE = /^(继续|继续当前任务|继续这个任务|继续执行|下一步|执行下一步|执行当前\s*phase|执行当前阶段|开始当前任务|go|yes|y)$/i;

interface RuntimeState {
  config: StudentAgentConfig;
  session: Awaited<ReturnType<typeof createStudentSession>>['session'];
  agent: Awaited<ReturnType<typeof createStudentSession>>['agent'];
  escalation: FailureEscalationContext;
  renderer: EventRenderer;
  unsubscribe: () => void;
  model: Model<Api>;
  resetFileGuard: () => void;
  setFileGuardMode: (mode: 'planning' | 'normal') => void;
  setRiskConfirmationProvider: (provider: ConfirmationProvider | null) => void;
}

// ── 构建模型 ──────────────────────────────────────────

function buildModel(config: StudentAgentConfig): Model<Api> {
  const { provider, name, baseUrl } = config.model;

  // 先从 Pi 注册表查找（支持所有已知提供商）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const piModels = getModels(provider as any) as Model<Api>[];
  const piModel = piModels.find((m) => m.id === name);

  if (piModel) {
    return { ...piModel, baseUrl: baseUrl ?? piModel.baseUrl };
  }

  // 未在注册表中：按 OpenAI-compatible 规范构建（兜底）
  return buildOpenAIChatModel(config);
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
  const api = (config.model.api as Api | undefined) ?? 'openai-completions';
  return {
    id: config.model.name,
    name: config.model.name,
    api,
    provider: config.model.provider,
    baseUrl: config.model.baseUrl ?? 'https://api.openai.com/v1',
    reasoning: false,
    input: ['text', 'image'],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 128_000,
    maxTokens: 16_384,
    compat: {
      supportsDeveloperRole: false,
    },
  };
}

// ── 组装 Hooks ────────────────────────────────────────

function buildHooks(
  config: StudentAgentConfig,
  abortRef: { abort: () => void },
  riskConfirmationRef: ConfirmationProviderRef,
): {
  hooks: StudentAgentHooks;
  escalation: FailureEscalationContext;
  resetFileGuard: () => void;
  setFileGuardMode: (mode: 'planning' | 'normal') => void;
  resetRiskGuard: () => void;
} {
  const reflectHook = createReflectHook(MEMORY_DIR, () => currentTaskDescription, {
    boundedBreakerEnabled: config.features.boundedBreaker,
  });
  const watchdogHook = config.features.qualityWatchdog
    ? createQualityWatchdogHook(MEMORY_DIR)
    : null;
  const context7Client = config.features.context7
    ? new Context7Client({
      apiKey: config.context7.apiKey,
      timeoutMs: config.context7.timeoutMs,
      maxDocsChars: config.context7.maxDocsChars,
      projectKb: ProjectKbManager.getInstance(MEMORY_DIR),
    })
    : undefined;

  const escalation = new FailureEscalationContext({
    context7Client,
    memoryDir: MEMORY_DIR,
    getLastSnapshotId,
    restoreSnapshot,
  });

  const fileGuard = createFileGuardHook(abortRef, config.fileGuard);
  const riskGuard = createRiskGuardHook({
    enabled: config.features.riskGuard && config.executionMode !== 'yolo',
    confirmationProviderRef: riskConfirmationRef,
  });
  const snapshotHook = createSnapshotHook(CWD);

  const hooks: StudentAgentHooks = {
    onBeforeToolCall: async (ctx) => {
      const guardDecision = await fileGuard.hook(ctx);
      if (guardDecision?.block) return guardDecision;
      const riskDecision = await riskGuard.hook(ctx);
      if (riskDecision?.block) return riskDecision;
      return snapshotHook(ctx);
    },
    onAfterToolCall: escalation.createHook(),
    buildMemoryPrompt: createMemoryHook(MEMORY_DIR),
    onSessionEnd: async (ctx) => {
      await reflectHook(ctx);
      await watchdogHook?.(ctx);
    },
  };

  return {
    hooks,
    escalation,
    resetFileGuard: fileGuard.reset,
    setFileGuardMode: fileGuard.setMode,
    resetRiskGuard: riskGuard.reset,
  };
}

function bindTuiRiskConfirmation(runtime: RuntimeState, bridge: TUIBridge): void {
  runtime.setRiskConfirmationProvider(new PromptConfirmationProvider({
    prompt: bridge.promptSettings,
    isInteractive: () => process.stdin.isTTY === true && process.stdout.isTTY === true,
  }));
}

function bindRuntimeToTui(runtime: RuntimeState, bridge: TUIBridge): void {
  runtime.renderer.cleanup();
  runtime.unsubscribe();
  runtime.renderer = new EventRenderer(bridge);
  runtime.unsubscribe = runtime.agent.subscribe((event) => runtime.renderer.handleEvent(event));
  bindTuiRiskConfirmation(runtime, bridge);
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

// ── 主入口 ─────────────────────────────────────────────

async function main(): Promise<void> {
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

  let runtime = await createRuntime(await reloadConfig());

  // ── REPL ─────────────────────────────────────────

  if (isTTY()) {
    // ── TUI 模式 ──────────────────────────────────────
    clearTerminalViewport(output);
    printBanner();
    initLogger();
    initDebugEvents({ enabled: process.env.STUDENT_AGENT_DEBUG_UI === '1' });
    setTuiMode(true);
    const pasteBuffer = createPasteBuffer();
    let hasExitedTUI = false;
    let tui: ReturnType<typeof startSelectedTUI>;
    const inputQueue = createInputQueue((value) => {
      tui.bridge.addMessage('user', value);
      tui.bridge.dispatch({ type: 'SET_PENDING_MESSAGE_COUNT', count: inputQueue.pendingCount() });
      tui.bridge.setStatus(`当前任务仍在运行，已排队 ${inputQueue.pendingCount()} 条`);
    });

    const abortCurrentRun = () => {
      if (!runtime.agent.state.isStreaming) {
        tui.bridge.setStatus('当前没有运行中的任务');
        return;
      }
      tui.bridge.updateTaskStatus({ state: 'aborting' });
      runtime.session.abort().catch(() => {});
      tui.bridge.setStatus('已请求中止当前任务');
    };

    const exitTUI = () => {
      if (hasExitedTUI) return;
      hasExitedTUI = true;
      runtime.renderer.cleanup();
      runtime.unsubscribe();
      tui.unmount();
      process.exit(0);
    };

    tui = startSelectedTUI({
      onSubmit: (value) => {
        const pasteResult = pasteBuffer.handle(value);
        if (pasteResult.type === 'status') {
          tui.bridge.setStatus(pasteResult.text);
          return;
        }

        const submittedValue = pasteResult.value;
        if (pasteResult.source === 'input' && parseCommand(submittedValue)?.type === 'abort') {
          tui.bridge.addMessage('user', submittedValue);
          abortCurrentRun();
          return;
        }
        inputQueue.enqueueSubmit(submittedValue);
      },
      onAbort: abortCurrentRun,
      onExit: exitTUI,
    });

    bindRuntimeToTui(runtime, tui.bridge);

    while (true) {
      const submitted = await inputQueue.waitForSubmit();
      let userInput = submitted.value;

      // 消费了一条排队消息后更新计数
      tui.bridge.dispatch({ type: 'SET_PENDING_MESSAGE_COUNT', count: inputQueue.pendingCount() });
      // 队列清空时清除瞬态状态
      if (inputQueue.pendingCount() === 0) {
        tui.bridge.clearStatus();
      }

      if (!submitted.alreadyDisplayed) {
        tui.bridge.addMessage('user', userInput);
      }

      // ── Slash command 处理 ────────────────────────

      const command = parseCommand(userInput);
      if (command) {
        switch (command.type) {
          case 'paste':
            userInput = command.content;
            break;

          case 'quit':
            exitTUI();

          case 'help':
            tui.bridge.addMessage('system', getHelpText());
            continue;

          case 'clear':
            if ('clear' in tui.bridge && typeof tui.bridge.clear === 'function') {
              tui.bridge.clear();
            } else {
              clearTerminalViewport(output);
              tui.bridge.clearStatus();
              tui.bridge.dispatch({ type: 'CLEAR_INPUT' });
            }
            continue;

          case 'status':
            tui.bridge.addMessage('system',
              `任务: ${currentTaskDescription || '(无)'}\n模式: ${runtime.config.executionMode}\n模型: ${runtime.config.model.provider}/${runtime.config.model.name}\nLLM 超时: ${runtime.config.llm.requestTimeoutMs}ms`
            );
            continue;

          case 'abort':
            abortCurrentRun();
            continue;

          case 'model': {
            if (runtime.agent.state.isStreaming) {
              tui.bridge.setStatus('当前任务仍在运行，不能切换模型');
              continue;
            }
            const promptLog = createBufferedPromptLog({
              writeLog: (message) => tui.bridge.addMessage('system', message),
              prompt: tui.bridge.promptSettings,
            });
            const newName = await switchModelName({
              config: runtime.config,
              prompt: promptLog.prompt,
              log: promptLog.log,
            });
            if (newName) {
              runtime.renderer.cleanup();
              runtime.unsubscribe();
              runtime = await createRuntime(await reloadConfig());
              bindRuntimeToTui(runtime, tui.bridge);
              tui.bridge.setStatus(`OK: 模型已切换为 ${runtime.config.model.provider}/${runtime.config.model.name}`);
            } else {
              tui.bridge.setStatus('已取消');
            }
            continue;
          }

          case 'setting': {
            if (runtime.agent.state.isStreaming) {
              tui.bridge.setStatus('当前任务仍在运行，不能修改设置');
              continue;
            }
            const promptLog = createBufferedPromptLog({
              writeLog: (message) => tui.bridge.addMessage('system', message),
              prompt: tui.bridge.promptSettings,
            });
            const targetPrompt = buildSettingTargetPrompt();
            promptLog.log(targetPrompt.menu);
            const targetAnswer = await promptLog.prompt(targetPrompt.question);
            const target = parseSettingTargetAnswer(targetAnswer);
            if (target === 'cancel') {
              tui.bridge.setStatus('已取消设置');
              continue;
            }
            await runStartupInitializer({
              cwd: CWD,
              config: runtime.config,
              prompt: promptLog.prompt,
              log: promptLog.log,
              forceModelProviderSetup: target === 'model',
              forceEmbeddingSetup: target === 'embedding',
            });
            runtime.renderer.cleanup();
            runtime.unsubscribe();
            runtime = await createRuntime(await reloadConfig());
            bindRuntimeToTui(runtime, tui.bridge);
            tui.bridge.setStatus(`OK: 已应用设置：${runtime.config.model.provider}/${runtime.config.model.name}`);
            continue;
          }

          case 'task': {
            const tasksMgr = TasksManager.getInstance(MEMORY_DIR);
            const activeTask = await tasksMgr.getActive();
            if (command.subcommand === 'status') {
              if (!activeTask) {
                tui.bridge.setStatus('当前无活跃任务');
              } else {
                tui.bridge.addMessage('system', formatTaskStatus(activeTask));
              }
            } else if (command.subcommand === 'rename') {
              if (!activeTask) {
                tui.bridge.setStatus('当前无活跃任务');
              } else {
                await tasksMgr.renameTask(activeTask.id, command.name);
                tui.bridge.setStatus(`已重命名为：${command.name}`);
              }
            } else if (command.subcommand === 'cancel') {
              const cancelled = await tasksMgr.cancelActiveTask();
              if (!cancelled) {
                tui.bridge.setStatus('当前无活跃任务');
              } else {
                lastPlanSnapshot = null;
                tui.bridge.clearTaskStatus();
                tui.bridge.setStatus(`已丢弃当前任务：${cancelled.name}`);
              }
            }
            continue;
          }

          case 'candidates':
            tui.bridge.setStatus('候选查看功能待实现');
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
              tui.bridge.setStatus('git 仓库已初始化，快照回滚已启用');
            } catch (e) {
              tui.bridge.addMessage('system', `/init 失败: ${e instanceof Error ? e.message : e}`);
            }
            continue;
          }

          case 'feedback':
            tui.bridge.addMessage('system', await recordQualityFeedback(command, runtime));
            if (isActionableDownFeedback(command)) {
              await runTuiFeedbackRepair(runtime, tui.bridge, command.comment);
            }
            continue;

          case 'review':
            {
              const reviewResult = await handleReviewCommand(command, currentTaskDescription);
              if (reviewResult.completedTask) {
                lastPlanSnapshot = null;
                tui.bridge.clearTaskStatus();
              }
              tui.bridge.addMessage('system', reviewResult.message);
            }
            continue;

          case 'why':
            tui.bridge.addMessage('system', await renderWhyCommand(command));
            continue;

          case 'plan':
            tui.bridge.addMessage('system', await handlePlanCommand(command));
            continue;

          case 'unknown':
            tui.bridge.addMessage('system', `未知命令: ${command.raw}\n输入 /help 查看可用命令`);
            continue;
        }
      }

      // ── 兼容旧 /feedback up|down 格式 ──────────────

      const feedback = runtime.config.features.qualityWatchdog ? parseFeedbackCommand(userInput) : null;
      if (feedback) {
        tui.bridge.addMessage('system', await recordQualityFeedback(feedback, runtime));
        if (isActionableDownFeedback(feedback)) {
          await runTuiFeedbackRepair(runtime, tui.bridge, feedback.comment);
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
            tui.bridge.clearTaskStatus();
          } else {
            const updatedTask = await tasksMgr.getActive();
            if (updatedTask) {
              tui.bridge.updateTaskStatus(buildTaskStatusUpdate(updatedTask, 'idle'));
            }
          }
          tui.bridge.addMessage('system', reviewResult.message);
          continue;
        }
      }

      const automaticRevisionMessage = await maybeRecordAutomaticPlanRevision(userInput, activeTask);
      if (automaticRevisionMessage) {
        tui.bridge.addMessage('system', automaticRevisionMessage);
      }

      if (activeTask && isPlanConfirmationInput(userInput)) {
        await runTuiActivePhase(runtime, tui.bridge, activeTask);
        continue;
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
        const finalPrompt = taskContext + userInput;

        currentTaskDescription = updatedTask?.name ?? activeTask.name;
        runtime.escalation.initTask(currentTaskDescription, CWD);
        markReflectBaseline();

        tui.bridge.updateTaskStatus({
          name: updatedTask?.name ?? activeTask.name,
          phaseIndex: updatedTask?.active_phase_index ?? activeTask.active_phase_index,
          totalPhases: updatedTask?.phases.length ?? activeTask.phases.length,
          retryCount: phase?.retry_count ?? 0,
          toolCallCount: 0,
          elapsedMs: 0,
          state: 'running',
        });

        try {
          runtime.resetFileGuard();
          await runtime.session.prompt(finalPrompt);
          await runtime.agent.waitForIdle();
          tui.bridge.updateTaskStatus({ state: 'idle' });
          if (shouldShowAgentErrorMessage(runtime.agent.state.errorMessage)) {
            tui.bridge.addMessage('system', `[Agent Error] ${runtime.agent.state.errorMessage}`);
          }
        } catch (err) {
          tui.bridge.updateTaskStatus({ state: 'failed' });
          tui.bridge.addMessage('system', `Task error: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        const intent = await classifyIntent(
          userInput,
          activeTask?.name ?? null,
          runtime.model,
        );

        if (intent.type === 'new_task' && intent.requiresPlan) {
          currentTaskDescription = intent.taskName ?? userInput;
          runtime.escalation.initTask(currentTaskDescription, CWD);
          markReflectBaseline();

          // ── 阶段 0：规划（planning 模式，最多读 3 个文件）──────────
          tui.bridge.setStatus('[规划中] 正在分析任务并制定执行计划…');
          tui.bridge.updateTaskStatus({
            name: currentTaskDescription,
            phaseIndex: 0,
            totalPhases: 1,
            workflowStatus: 'planning',
            level: intent.level,
            requiresUserAcceptance: intent.requiresUserAcceptance,
            requiresVisualReview: intent.requiresVisualReview,
            retryCount: 0,
            toolCallCount: 0,
            elapsedMs: 0,
            state: 'running',
          });

          let effectiveUserInput = userInput;
          let planSignal: Extract<PhaseSignal, { type: 'task_start' }> | null = null;
          let lastPlanningFailure: PlanningFailureInfo | null = null;
          let planningAbandoned = false;

          for (let planningAttempt = 0; planningAttempt < 2 && !planSignal; planningAttempt += 1) {
            if (planningAttempt > 0) {
              tui.bridge.setStatus('[规划中] 正在根据恢复选择重新规划…');
              tui.bridge.updateTaskStatus({ state: 'running', retryCount: planningAttempt });
            }

            const planningResult = await runTuiPlanningAttempt(runtime, effectiveUserInput);

            if (planningResult.outcome === 'task_start') {
              planSignal = planningResult.signal;
              tui.bridge.updateTaskStatus({ state: 'idle' });
              break;
            }

            lastPlanningFailure = planningResult.failure;
            if (isInformationalFollowUp(userInput)) {
              tui.bridge.clearTaskStatus();
              await runTuiPlainAnswer(runtime, tui.bridge, userInput);
              planningAbandoned = true;
              break;
            }

            const recoveryAction = await promptTuiPlanningRecovery(tui.bridge, planningResult.failure);
            if (recoveryAction === 'cancel') {
              tui.bridge.clearTaskStatus();
              tui.bridge.setStatus('已取消规划');
              planningAbandoned = true;
              break;
            }

            if (recoveryAction === 'revise') {
              const revision = await tui.bridge.promptSettings(buildPlanningRevisionQuestion(planningResult.failure));
              if (!revision.trim()) {
                tui.bridge.clearTaskStatus();
                tui.bridge.setStatus('已取消规划');
                planningAbandoned = true;
                break;
              }
              effectiveUserInput = mergePlanningRevision(userInput, revision);
              currentTaskDescription = intent.taskName ?? effectiveUserInput;
            } else {
              effectiveUserInput = buildPlanningRetryRequest(effectiveUserInput, planningResult.failure);
            }
          }

          if (!planSignal) {
            if (!planningAbandoned) {
              tui.bridge.updateTaskStatus({ state: 'failed' });
              tui.bridge.setStatus(`规划仍未完成：${lastPlanningFailure?.userSummary ?? '请换个描述重试'}`);
            }
            continue;
          }

          const newTask = await tasksMgr.createTask(
            planSignal.name,
            planSignal.phases,
            buildTaskCreateOptions(intent, planSignal.context, isYoloMode(runtime)),
          );
          lastPlanSnapshot = createPlanSnapshot(newTask);
          tui.bridge.addMessage('system', formatPlanAwaitingConfirmation(
            planSignal.name,
            planSignal.phases,
            isYoloMode(runtime),
          ));
          tui.bridge.updateTaskStatus(buildTaskStatusUpdate(newTask, 'idle'));
          if (isYoloMode(runtime)) {
            await runTuiActivePhase(runtime, tui.bridge, newTask);
          }
        } else {
          const agentOutputs: string[] = [];
          const tempUnsubscribe = runtime.agent.subscribe((event) => {
            if (event.type === 'message_update' && event.message.role === 'assistant') {
              const textContent = event.message.content.find((c) => c.type === 'text');
              if (textContent && textContent.type === 'text') {
                agentOutputs.push(textContent.text);
              }
            }
          });

          const useActiveTaskContext = Boolean(activeTask && shouldUseActiveTaskContext(userInput));
          const taskContext = useActiveTaskContext && activeTask ? buildTaskContextPrefix(activeTask) : '';
          const finalPrompt = taskContext + userInput;

          currentTaskDescription = useActiveTaskContext && activeTask
            ? activeTask.name
            : intent.type === 'new_task'
              ? intent.taskName ?? userInput
              : userInput;
          runtime.escalation.initTask(currentTaskDescription, CWD);
          markReflectBaseline();

          if (useActiveTaskContext && activeTask) {
            tui.bridge.updateTaskStatus(buildTaskStatusUpdate(activeTask, 'running'));
          }

          try {
            runtime.resetFileGuard();
            await runtime.session.prompt(finalPrompt);
            await runtime.agent.waitForIdle();
            tui.bridge.updateTaskStatus({ state: 'idle' });
            if (shouldShowAgentErrorMessage(runtime.agent.state.errorMessage)) {
              tui.bridge.addMessage('system', `[Agent Error] ${runtime.agent.state.errorMessage}`);
            }
          } catch (err) {
            tui.bridge.updateTaskStatus({ state: 'failed' });
            tui.bridge.addMessage('system', `Task error: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            tempUnsubscribe();
          }

          if (useActiveTaskContext && activeTask) {
            const fullOutput = agentOutputs.join('');
            const signal = parsePhaseSignal(fullOutput);

            if (signal?.type === 'phase_done') {
              await tasksMgr.completePhase(activeTask.id);
              const updatedTask = await tasksMgr.getActive();
              if (updatedTask && hasExecutableCurrentPhase(updatedTask)) {
                if (isYoloMode(runtime)) {
                  tui.bridge.addMessage('system', `[Phase ${signal.phaseIndex + 1} 完成] 进入 Phase ${updatedTask.active_phase_index + 1}，YOLO 自动继续。`);
                  await runTuiActivePhase(runtime, tui.bridge, updatedTask);
                } else {
                  tui.bridge.updateTaskStatus(buildTaskStatusUpdate(updatedTask, 'idle'));
                  tui.bridge.addMessage('system', `[Phase ${signal.phaseIndex + 1} 完成] 进入 Phase ${updatedTask.active_phase_index + 1}。回复“继续”执行下一 Phase。`);
                }
              } else if (updatedTask && isAwaitingUserReview(updatedTask)) {
                tui.bridge.updateTaskStatus(buildTaskStatusUpdate(updatedTask, 'idle'));
                tui.bridge.addMessage('system', formatAwaitingReviewMessage(updatedTask));
              } else {
                tui.bridge.addMessage('system', `[任务完成] ${activeTask.name}`);
                tui.bridge.clearTaskStatus();
                lastPlanSnapshot = null;
              }
            }
          }
        }
      }

      // 三级失败升级后，展示待答问题
      const pendingQ = runtime.escalation.takePendingQuestion();
      if (pendingQ) {
        tui.bridge.addMessage('system', `[需要你的帮助] ${pendingQ.context}`);
      }
    }
  } else {
    // ── 非 TUI 模式（readline 降级）──────────────────
    printBanner();

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

          case 'status':
            console.log(chalk.dim(`  任务: ${currentTaskDescription || '(无)'}`));
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
            runtime = await runSettingFlow(rl, runtime);
            bindConsoleRiskConfirmation(runtime, rl);
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

          case 'candidates':
            console.log(chalk.dim('  候选查看功能待实现'));
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

          case 'plan':
            console.log(chalk.green(await handlePlanCommand(command)));
            continue;

          case 'unknown':
            console.log(chalk.yellow(`  未知命令: ${command.raw}`));
            console.log(chalk.dim('  输入 /help 查看可用命令'));
            continue;
        }
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
        // 非负反馈：意图分类
        const intent = await classifyIntent(
          userInput,
          activeTask?.name ?? null,
          runtime.model,
        );

        if (intent.type === 'new_task' && intent.requiresPlan) {
          // 新任务：收集 agent 输出，解析信号
          const agentOutputs: string[] = [];
          const tempUnsubscribe = runtime.agent.subscribe((event) => {
            if (event.type === 'message_update' && event.message.role === 'assistant') {
              const textContent = event.message.content.find((c) => c.type === 'text');
              if (textContent && textContent.type === 'text') {
                agentOutputs.push(textContent.text);
              }
            }
          });

          currentTaskDescription = intent.taskName ?? userInput;
          runtime.escalation.initTask(currentTaskDescription, CWD);
          markReflectBaseline();

          // 保存规划前的消息数量，临时取消 EventRenderer 订阅
          // 避免规划失败时把规划消息残留到 transcript
          const savedMessageCount = runtime.agent.state.messages.length;
          runtime.unsubscribe();

          let planningError: unknown;
          try {
            runtime.setFileGuardMode('planning');
            await runTaskWithAbort(runtime, buildPlanningPrompt(userInput));
          } catch (err) {
            planningError = err;
          } finally {
            runtime.setFileGuardMode('normal');
            tempUnsubscribe();
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

          // 解析信号
          const fullOutput = agentOutputs.join('');
          const signal = parsePhaseSignal(fullOutput);

          if (signal?.type === 'task_start') {
            if (signal.phases.length === 0) {
              // 规划失败：恢复 agent 消息到规划前状态
              runtime.agent.state.messages = runtime.agent.state.messages.slice(0, savedMessageCount);
              if (isInformationalFollowUp(userInput)) {
                await runConsolePlainAnswer(runtime, userInput);
              } else {
                console.log(chalk.red('\n  [规划失败] Agent 未输出有效 Phase 行，请重试或换个描述方式。'));
              }
              continue;
            }
            const newTask = await tasksMgr.createTask(
              signal.name,
              signal.phases,
              buildTaskCreateOptions(intent, signal.context, isYoloMode(runtime)),
            );
            lastPlanSnapshot = createPlanSnapshot(newTask);
            console.log(chalk.green('\n' + formatPlanAwaitingConfirmation(
              signal.name,
              signal.phases,
              isYoloMode(runtime),
            )));
            if (isYoloMode(runtime)) {
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
            console.log(chalk.red('\n  [规划失败] Agent 未输出 TASK_START 信号，请重试或换个描述方式。'));
          }
        } else {
          // 继续当前任务或其他操作
          const agentOutputs: string[] = [];
          const tempUnsubscribe = runtime.agent.subscribe((event) => {
            if (event.type === 'message_update' && event.message.role === 'assistant') {
              const textContent = event.message.content.find((c) => c.type === 'text');
              if (textContent && textContent.type === 'text') {
                agentOutputs.push(textContent.text);
              }
            }
          });

          const useActiveTaskContext = Boolean(activeTask && shouldUseActiveTaskContext(userInput));
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
            tempUnsubscribe();
          }

          // 检查是否有 phase_done 信号
          if (useActiveTaskContext && activeTask) {
            const fullOutput = agentOutputs.join('');
            const signal = parsePhaseSignal(fullOutput);

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
}

type FeedbackCommand = Extract<SlashCommand, { type: 'feedback' }>;
type PlanCommand = Extract<SlashCommand, { type: 'plan' }>;
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

async function runTuiFeedbackRepair(
  runtime: RuntimeState,
  bridge: TUIBridge,
  feedback: string,
): Promise<void> {
  const retryContext = await recordFeedbackRetryForActivePhase(runtime, feedback);
  const taskName = (retryContext.task?.name ?? currentTaskDescription) || '用户反馈返工';
  currentTaskDescription = taskName;
  runtime.escalation.initTask(taskName, CWD);
  markReflectBaseline();
  const activePhase = retryContext.task?.phases[retryContext.task.active_phase_index];

  bridge.updateTaskStatus({
    name: taskName,
    phaseIndex: retryContext.task?.active_phase_index ?? 0,
    totalPhases: retryContext.task?.phases.length ?? 1,
    retryCount: activePhase?.retry_count ?? 0,
    toolCallCount: 0,
    elapsedMs: 0,
    state: 'running',
  });

  try {
    runtime.resetFileGuard();
    await runtime.session.prompt(
      buildTaskContextPrefix(retryContext.task, retryContext.ctx7Docs)
      + buildFeedbackRepairPrompt(taskName, feedback),
    );
    await runtime.agent.waitForIdle();
    bridge.updateTaskStatus({ state: 'idle' });
    if (shouldShowAgentErrorMessage(runtime.agent.state.errorMessage)) {
      bridge.addMessage('system', `[Agent Error] ${runtime.agent.state.errorMessage}`);
    }
  } catch (err) {
    bridge.updateTaskStatus({ state: 'failed' });
    bridge.addMessage('system', `反馈返工失败: ${err instanceof Error ? err.message : String(err)}`);
  }
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

async function runTuiActivePhase(
  runtime: RuntimeState,
  bridge: TUIBridge,
  task: Task,
): Promise<void> {
  const tasksMgr = TasksManager.getInstance(MEMORY_DIR);
  await tasksMgr.updateWorkflowStatus(task.id, 'executing');
  const activeTask = await tasksMgr.getTask(task.id) ?? task;
  const phase = activeTask.phases[activeTask.active_phase_index];
  if (!phase) {
    bridge.addMessage('system', `[任务错误] ${activeTask.name} 没有可执行的当前 Phase。`);
    return;
  }

  currentTaskDescription = activeTask.name;
  runtime.escalation.initTask(activeTask.name, CWD);
  markReflectBaseline();
  bridge.updateTaskStatus(buildTaskStatusUpdate(activeTask, 'running'));

  const outputs: string[] = [];
  const unsub = runtime.agent.subscribe((event) => {
    if (event.type === 'message_update' && event.message.role === 'assistant') {
      const textContent = event.message.content.find((c) => c.type === 'text');
      if (textContent && textContent.type === 'text') outputs.push(textContent.text);
    }
  });

  try {
    runtime.resetFileGuard();
    await runtime.session.prompt(
      buildTaskContextPrefix(activeTask)
      + buildPhaseExecutionPrompt(activeTask.name, phase.description, activeTask.active_phase_index, activeTask.phases.length),
    );
    await runtime.agent.waitForIdle();
    bridge.updateTaskStatus({ state: 'idle' });
    if (shouldShowAgentErrorMessage(runtime.agent.state.errorMessage)) {
      bridge.addMessage('system', `[Agent Error] ${runtime.agent.state.errorMessage}`);
    }
  } catch (err) {
    bridge.updateTaskStatus({ state: 'failed' });
    bridge.addMessage('system', `Phase ${activeTask.active_phase_index + 1} 执行失败: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    unsub();
  }

  const signal = parsePhaseSignal(outputs.join(''));
  if (signal?.type !== 'phase_done') return;

  await tasksMgr.completePhase(activeTask.id);
  const updatedTask = await tasksMgr.getActive();
  if (updatedTask && hasExecutableCurrentPhase(updatedTask)) {
    if (isYoloMode(runtime)) {
      bridge.addMessage('system', `[Phase ${activeTask.active_phase_index + 1} 完成] 进入 Phase ${updatedTask.active_phase_index + 1}，YOLO 自动继续。`);
      await runTuiActivePhase(runtime, bridge, updatedTask);
      return;
    }
    bridge.updateTaskStatus(buildTaskStatusUpdate(updatedTask, 'idle'));
    bridge.addMessage('system', `[Phase ${activeTask.active_phase_index + 1} 完成] 进入 Phase ${updatedTask.active_phase_index + 1}。回复“继续”执行下一 Phase。`);
  } else if (updatedTask && isAwaitingUserReview(updatedTask)) {
    bridge.updateTaskStatus(buildTaskStatusUpdate(updatedTask, 'idle'));
    bridge.addMessage('system', formatAwaitingReviewMessage(updatedTask));
  } else {
    bridge.addMessage('system', `[任务完成] ${activeTask.name}`);
    bridge.clearTaskStatus();
    lastPlanSnapshot = null;
  }
}

async function runConsoleActivePhase(runtime: RuntimeState, task: Task): Promise<void> {
  const tasksMgr = TasksManager.getInstance(MEMORY_DIR);
  await tasksMgr.updateWorkflowStatus(task.id, 'executing');
  const activeTask = await tasksMgr.getTask(task.id) ?? task;
  const phase = activeTask.phases[activeTask.active_phase_index];
  if (!phase) {
    console.log(chalk.red(`\n  [任务错误] ${activeTask.name} 没有可执行的当前 Phase。`));
    return;
  }

  currentTaskDescription = activeTask.name;
  runtime.escalation.initTask(activeTask.name, CWD);
  markReflectBaseline();

  const outputs: string[] = [];
  const unsub = runtime.agent.subscribe((event) => {
    if (event.type === 'message_update' && event.message.role === 'assistant') {
      const textContent = event.message.content.find((c) => c.type === 'text');
      if (textContent && textContent.type === 'text') outputs.push(textContent.text);
    }
  });

  try {
    await runTaskWithAbort(
      runtime,
      buildTaskContextPrefix(activeTask)
      + buildPhaseExecutionPrompt(activeTask.name, phase.description, activeTask.active_phase_index, activeTask.phases.length),
    );
  } catch (err) {
    console.error(
      chalk.red(`Phase ${activeTask.active_phase_index + 1} 执行失败:`),
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    unsub();
  }

  const signal = parsePhaseSignal(outputs.join(''));
  if (signal?.type !== 'phase_done') return;

  await tasksMgr.completePhase(activeTask.id);
  const updatedTask = await tasksMgr.getActive();
  if (updatedTask && hasExecutableCurrentPhase(updatedTask)) {
    if (isYoloMode(runtime)) {
      console.log(chalk.green(`\n  [Phase ${activeTask.active_phase_index + 1} 完成] 进入 Phase ${updatedTask.active_phase_index + 1}，YOLO 自动继续。`));
      await runConsoleActivePhase(runtime, updatedTask);
      return;
    }
    console.log(chalk.green(`\n  [Phase ${activeTask.active_phase_index + 1} 完成] 进入 Phase ${updatedTask.active_phase_index + 1}。回复“继续”执行下一 Phase。`));
  } else if (updatedTask && isAwaitingUserReview(updatedTask)) {
    console.log(chalk.green('\n  ' + formatAwaitingReviewMessage(updatedTask)));
  } else {
    console.log(chalk.green(`\n  [任务完成] ${activeTask.name}`));
    lastPlanSnapshot = null;
  }
}

function isYoloMode(runtime: RuntimeState): boolean {
  return runtime.config.executionMode === 'yolo';
}

function isPlanConfirmationInput(input: string): boolean {
  return PLAN_CONFIRM_RE.test(input.trim());
}

function shouldUseActiveTaskContext(input: string): boolean {
  return ACTIVE_TASK_CONTINUE_RE.test(input.trim());
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

function buildTaskStatusUpdate(task: Task, state: 'running' | 'aborting' | 'idle' | 'failed') {
  const phase = task.phases[task.active_phase_index];
  return {
    name: task.name,
    phaseIndex: task.active_phase_index,
    totalPhases: task.phases.length,
    workflowStatus: task.workflow_status,
    level: task.level,
    goal: task.working_memory.goal,
    acceptanceCriteria: task.working_memory.acceptance_criteria,
    phases: task.phases.map((p) => ({ description: p.description, status: p.status })),
    constraints: task.working_memory.constraints,
    openQuestions: task.working_memory.open_questions,
    userPreferences: task.working_memory.user_preferences,
    verificationSummary: task.working_memory.verification_results,
    requiresUserAcceptance: task.requires_user_acceptance,
    requiresVisualReview: task.requires_visual_review,
    retryCount: phase?.retry_count ?? 0,
    toolCallCount: 0,
    elapsedMs: 0,
    state,
  };
}

function formatPlanAwaitingConfirmation(name: string, phases: string[], yoloMode = false): string {
  const lines = [
    `[规划完成] ${name}，共 ${phases.length} 个 Phase。`,
    ...phases.map((phase, index) => `Phase ${index + 1}: ${phase}`),
    yoloMode
      ? 'YOLO 模式：自动执行 Phase 1，并在每个 Phase 完成后继续推进。'
      : '回复“确认”或“开始”后执行 Phase 1；也可以先提出修改计划。',
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
  appendStatusList(lines, 'Acceptance Criteria', memory.acceptance_criteria);
  appendStatusList(lines, 'Constraints', memory.constraints);
  appendStatusList(lines, 'Open Questions', memory.open_questions);
  appendStatusList(lines, 'User Preferences', memory.user_preferences);
  appendStatusList(lines, 'Verification', memory.verification_results);
  appendStatusList(lines, 'Changed Files', memory.changed_files);

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

type TuiPlanningAttemptResult =
  | { outcome: 'task_start'; signal: Extract<PhaseSignal, { type: 'task_start' }> }
  | { outcome: 'failure'; failure: PlanningFailureInfo };

async function runTuiPlanningAttempt(
  runtime: RuntimeState,
  userInput: string,
): Promise<TuiPlanningAttemptResult> {
  // Collect final text of each assistant message using message_end (not message_update).
  // message_update fires on every streaming token with the full accumulated text, so joining
  // message_update outputs produces a repeated-prefix string that breaks phase parsing.
  const planTexts: string[] = [];
  const planUnsub = runtime.agent.subscribe((event) => {
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const textContent = event.message.content.find((c) => c.type === 'text');
      if (textContent && textContent.type === 'text') planTexts.push(textContent.text);
    }
  });

  const savedMessageCount = runtime.agent.state.messages.length;
  runtime.unsubscribe();

  let planningError: unknown;
  try {
    runtime.setFileGuardMode('planning');
    await runtime.session.prompt(buildPlanningPrompt(userInput));
    await runtime.agent.waitForIdle();
  } catch (err) {
    planningError = err;
  } finally {
    runtime.setFileGuardMode('normal');
    planUnsub();
    runtime.unsubscribe = runtime.agent.subscribe((event) => runtime.renderer.handleEvent(event));
  }

  const planText = planTexts.join('\n');
  if (planningError) {
    runtime.agent.state.messages = runtime.agent.state.messages.slice(0, savedMessageCount);
    return {
      outcome: 'failure',
      failure: classifyPlanningFailure({ reason: 'error', detail: planningError, planText }),
    };
  }

  const signal = parsePhaseSignal(planText);
  if (!signal || signal.type !== 'task_start') {
    runtime.agent.state.messages = runtime.agent.state.messages.slice(0, savedMessageCount);
    return {
      outcome: 'failure',
      failure: classifyPlanningFailure({ reason: 'missing-task-start', planText }),
    };
  }
  if (signal.phases.length === 0) {
    runtime.agent.state.messages = runtime.agent.state.messages.slice(0, savedMessageCount);
    return {
      outcome: 'failure',
      failure: classifyPlanningFailure({ reason: 'empty-phases', planText }),
    };
  }

  return { outcome: 'task_start', signal };
}

async function promptTuiPlanningRecovery(
  bridge: TUIBridge,
  failure: PlanningFailureInfo,
) {
  bridge.updateTaskStatus({ state: 'failed' });
  const answer = await bridge.promptSettings(buildPlanningRecoveryPromptQuestion(failure));
  return parsePlanningRecoveryAnswer(answer);
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

async function runTuiPlainAnswer(
  runtime: RuntimeState,
  bridge: TUIBridge,
  prompt: string,
): Promise<void> {
  currentTaskDescription = prompt.trim().slice(0, 60) || '普通回答';
  runtime.escalation.initTask(currentTaskDescription, CWD);
  markReflectBaseline();
  bridge.clearTaskStatus();

  try {
    runtime.resetFileGuard();
    await runtime.session.prompt(prompt);
    await runtime.agent.waitForIdle();
    bridge.updateTaskStatus({ state: 'idle' });
    if (shouldShowAgentErrorMessage(runtime.agent.state.errorMessage)) {
      bridge.addMessage('system', `[Agent Error] ${runtime.agent.state.errorMessage}`);
    }
  } catch (err) {
    bridge.updateTaskStatus({ state: 'failed' });
    bridge.addMessage('system', `Task error: ${err instanceof Error ? err.message : String(err)}`);
  }
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

async function runTuiFollowUpPrompt(
  runtime: RuntimeState,
  bridge: TUIBridge,
  prompt: string,
): Promise<void> {
  const taskName = prompt.trim().slice(0, 60) || '后续任务';
  currentTaskDescription = taskName;
  runtime.escalation.initTask(taskName, CWD);
  markReflectBaseline();
  bridge.updateTaskStatus({
    name: taskName,
    phaseIndex: 0,
    totalPhases: 1,
    retryCount: 0,
    toolCallCount: 0,
    elapsedMs: 0,
    state: 'running',
  });

  try {
    runtime.resetFileGuard();
    await runtime.session.prompt(prompt);
    await runtime.agent.waitForIdle();
    bridge.updateTaskStatus({ state: 'idle' });
    if (shouldShowAgentErrorMessage(runtime.agent.state.errorMessage)) {
      bridge.addMessage('system', `[Agent Error] ${runtime.agent.state.errorMessage}`);
    }
  } catch (err) {
    bridge.updateTaskStatus({ state: 'failed' });
    bridge.addMessage('system', `后续任务失败: ${err instanceof Error ? err.message : String(err)}`);
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
    await tasksMgr.requestRevision(activeTask.id, comment || '用户未接受当前结果，需要继续修订。');
    return {
      message: `已记录用户未接受当前结果，任务进入 revision_requested：${comment || '请继续补充修改意见。'}`,
      completedTask: false,
    };
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

async function handlePlanCommand(command: PlanCommand): Promise<string> {
  const manager = PlanRevisionManager.getInstance(MEMORY_DIR);
  if (command.subcommand === 'revisions') {
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
  await loadEnvFile({ cwd: GLOBAL_CONFIG_DIR, filename: '.env', override: true });
  const initialConfig = await loadStudentAgentConfig({ cwd: CWD });
  await loadEnvFile({ cwd: CWD, filename: initialConfig.envFile, override: true });
  const config = await loadStudentAgentConfig({ cwd: CWD });
  normalizeProviderApiKeyEnv(config.model.provider);
  return config;
}

async function createRuntime(config: StudentAgentConfig): Promise<RuntimeState> {
  const model = buildModel(config);
  const abortRef = { abort: () => {} };
  const riskConfirmationRef: ConfirmationProviderRef = { current: null };
  const { hooks, escalation, resetFileGuard, setFileGuardMode, resetRiskGuard } = buildHooks(
    config,
    abortRef,
    riskConfirmationRef,
  );

  // Pi SDK 只认识内置 provider 的 env var（OPENAI_API_KEY 等）。
  // 对自定义 provider，用 API_KEY_MAP 规则找到对应 env var，显式注入 apiKey。
  const resolvedApiKey = process.env[getApiKeyEnvName(config.model.provider)];

  const { session, agent } = await createStudentSession({
    cwd: CWD,
    model,
    hooks,
    apiKey: resolvedApiKey,
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

  const renderer = new EventRenderer();
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
    setFileGuardMode,
    setRiskConfirmationProvider: (provider) => {
      riskConfirmationRef.current = provider;
      resetRiskGuard();
    },
  };
}

async function runSettingFlow(
  rl: Awaited<ReturnType<typeof createInterface>>,
  runtime: RuntimeState,
): Promise<RuntimeState> {
  if (runtime.agent.state.isStreaming) {
    console.log(chalk.yellow('  当前任务仍在运行，不能修改设置。'));
    return runtime;
  }

  const target = await chooseSettingTarget(rl);
  if (target === 'cancel') {
    console.log(chalk.dim('  已取消设置。'));
    return runtime;
  }

  await runStartupInitializer({
    cwd: CWD,
    config: runtime.config,
    prompt: createReadlinePrompt(rl),
    forceModelProviderSetup: target === 'model',
    forceEmbeddingSetup: target === 'embedding',
  });

  runtime.renderer.cleanup();
  runtime.unsubscribe();
  const nextRuntime = await createRuntime(await reloadConfig());
  console.log(chalk.green(`OK: 已应用设置：${nextRuntime.config.model.provider}/${nextRuntime.config.model.name}`));
  return nextRuntime;
}

async function chooseSettingTarget(
  rl: Awaited<ReturnType<typeof createInterface>>,
): Promise<SettingTarget> {
  const targetPrompt = buildSettingTargetPrompt();
  const answer = await rl.question(`${targetPrompt.menu}\n${targetPrompt.question}`);
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
    await runtime.session.prompt(userInput);
    await runtime.agent.waitForIdle();

    if (!aborted && runtime.agent.state.errorMessage) {
      console.error(chalk.red(`[Agent Error] ${runtime.agent.state.errorMessage}`));
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
