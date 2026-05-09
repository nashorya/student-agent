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
import chalk from 'chalk';
import { getModel, getModels, type Api, type Model } from '@mariozechner/pi-ai';
import { loadEnvFile } from '../core/env.js';
import { loadStudentAgentConfig, GLOBAL_CONFIG_DIR } from '../core/config/loader.js';
import type { StudentAgentConfig } from '../core/config/types.js';
import { createReadlinePrompt, runStartupInitializer, switchModelName, getApiKeyEnvName } from '../core/setup/initializer.js';
import { createStudentSession, type StudentAgentHooks } from '../core/pi-bridge/session-factory.js';
import { Context7Client } from '../knowledge/context7-client.js';
import { createSnapshotHook, getLastSnapshotId, restoreSnapshot } from './hooks/snapshot.js';
import { createFileGuardHook } from './hooks/file-guard.js';
import { FailureEscalationContext } from './hooks/failure-escalation.js';
import { createMemoryHook } from './hooks/memory.js';
import { createReflectHook, markReflectBaseline } from './hooks/reflect.js';
import { createQualityWatchdogHook } from './hooks/quality-watchdog.js';
import { QualityFeedbackManager, parseFeedbackCommand } from '../watchdog/feedback-collector.js';
import { QuestionsManager } from '../memory/questions/manager.js';
import { WhyManager } from '../memory/why/manager.js';
import { EventRenderer } from '../cli/event-renderer.js';
import { parseCommand, getHelpText, COMMAND_COMPLETIONS, type SlashCommand } from '../cli/command-parser.js';
import { printBanner } from '../cli/banner.js';
import { startTUI, isTTY } from '../tui/index.js';
import { createInputQueue } from '../tui/input-queue.js';
import type { TUIBridge } from '../tui/bridge.js';
import { TasksManager } from '../memory/tasks/manager.js';
import type { Task } from '../memory/tasks/types.js';
import { PlanRevisionManager } from '../memory/plan-revisions/manager.js';
import type { PlanRevision } from '../memory/plan-revisions/types.js';
import { DesignMemoryManager } from '../memory/design/manager.js';
import type { DesignCandidate } from '../memory/design/types.js';
import { ProjectKbManager } from '../memory/project-kb/manager.js';
import { DesignStudyService, NativePlaywrightExtractor, assertLocalDesignUrl } from '../knowledge/design-study/index.js';
import { parsePhaseSignal } from '../core/task-planner/phase-signal.js';
import { createPlanSnapshot, detectPlanRevisionIntent, type PlanSnapshot } from '../core/task-planner/plan-revision-detector.js';
import { detectNegativeFeedback } from '../core/task-planner/feedback-detector.js';
import { classifyIntent } from '../core/task-planner/intent-classifier.js';
import { buildTaskContextPrefix } from '../core/task-planner/task-context-builder.js';
import { buildCtx7RetryContext } from '../core/task-planner/ctx7-retry-builder.js';
import { buildPlanningPrompt, buildPhaseExecutionPrompt } from '../core/task-planner/planning-prompt.js';

// ── 配置 ──────────────────────────────────────────────

const CWD = process.env.STUDENT_AGENT_CWD ?? process.cwd();
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
let automaticDesignCritiqueFailures = 0;
let lastPlanSnapshot: PlanSnapshot | null = null;

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
  designService: DesignStudyService;
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

function buildHooks(config: StudentAgentConfig, abortRef: { abort: () => void }): { hooks: StudentAgentHooks; escalation: FailureEscalationContext; resetFileGuard: () => void; setFileGuardMode: (mode: 'planning' | 'normal') => void } {
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

  const fileGuard = createFileGuardHook(abortRef);
  const snapshotHook = createSnapshotHook(CWD);

  const hooks: StudentAgentHooks = {
    onBeforeToolCall: async (ctx) => {
      const guardDecision = await fileGuard.hook(ctx);
      if (guardDecision?.block) return guardDecision;
      return snapshotHook(ctx);
    },
    onAfterToolCall: escalation.createHook(),
    buildMemoryPrompt: createMemoryHook(MEMORY_DIR),
    onSessionEnd: async (ctx) => {
      await reflectHook(ctx);
      await watchdogHook?.(ctx);
    },
  };

  return { hooks, escalation, resetFileGuard: fileGuard.reset, setFileGuardMode: fileGuard.setMode };
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

  printBanner();

  if (isTTY()) {
    // ── TUI 模式 ──────────────────────────────────────
    const inputQueue = createInputQueue((value) => {
      tui.bridge.addMessage('user', value);
      tui.bridge.addMessage('system', '当前任务仍在运行，消息已排队。');
    });

    const tui = startTUI({
      onSubmit: inputQueue.enqueueSubmit,
      onAbort: () => {
        tui.bridge.updateTaskStatus({ state: 'aborting' });
        runtime.session.abort().catch(() => {});
      },
    });

    // 注入 TUIBridge 到 EventRenderer
    runtime.unsubscribe();
    runtime.renderer = new EventRenderer(tui.bridge);
    runtime.unsubscribe = runtime.agent.subscribe((event) => runtime.renderer.handleEvent(event));

    while (true) {
      const submitted = await inputQueue.waitForSubmit();
      const userInput = submitted.value;

      if (!submitted.alreadyDisplayed) {
        tui.bridge.addMessage('user', userInput);
      }

      // ── Slash command 处理 ────────────────────────

      const command = parseCommand(userInput);
      if (command) {
        switch (command.type) {
          case 'quit':
            runtime.renderer.cleanup();
            runtime.unsubscribe();
            tui.unmount();
            return;

          case 'help':
            tui.bridge.addMessage('system', getHelpText());
            continue;

          case 'clear':
            continue;

          case 'status':
            tui.bridge.addMessage('system',
              `任务: ${currentTaskDescription || '(无)'}\n模型: ${runtime.config.model.provider}/${runtime.config.model.name}\nLLM 超时: ${runtime.config.llm.requestTimeoutMs}ms`
            );
            continue;

          case 'model': {
            if (runtime.agent.state.isStreaming) {
              tui.bridge.addMessage('system', '当前任务仍在运行，不能切换模型。');
              continue;
            }
            let modelLog = '';
            const tuiModelPrompt = (question: string) => {
              const fullQuestion = modelLog.trim()
                ? modelLog.trimEnd() + '\n' + question
                : question;
              modelLog = '';
              return tui.bridge.promptSettings(fullQuestion);
            };
            const newName = await switchModelName({
              config: runtime.config,
              prompt: tuiModelPrompt,
              log: (msg) => { modelLog += msg + '\n'; },
            });
            if (newName) {
              runtime.renderer.cleanup();
              runtime.unsubscribe();
              runtime = await createRuntime(await reloadConfig());
              runtime.renderer = new EventRenderer(tui.bridge);
              runtime.unsubscribe = runtime.agent.subscribe((event) => runtime.renderer.handleEvent(event));
              tui.bridge.addMessage('system', `OK: 模型已切换为 ${runtime.config.model.provider}/${runtime.config.model.name}`);
            } else {
              tui.bridge.addMessage('system', '已取消。');
            }
            continue;
          }

          case 'setting': {
            if (runtime.agent.state.isStreaming) {
              tui.bridge.addMessage('system', '当前任务仍在运行，不能修改设置。');
              continue;
            }
            // log() 调用的内容累积到 pendingLog，在下一次 prompt() 时拼入问题头部显示
            let pendingLog = '';
            const tuiLog = (msg: string) => { pendingLog += msg + '\n'; };
            const tuiPrompt = (question: string) => {
              const fullQuestion = pendingLog.trim()
                ? pendingLog.trimEnd() + '\n' + question
                : question;
              pendingLog = '';
              return tui.bridge.promptSettings(fullQuestion);
            };
            const targetAnswer = await tuiPrompt(
              '设置项：\n  1) 模型 Provider / API Key\n  2) 向量模型\n  q) 取消\n选择 [1]: '
            );
            const trimmed = targetAnswer.trim().toLowerCase();
            if (trimmed === 'q' || trimmed === 'quit' || trimmed === 'cancel') {
              tui.bridge.addMessage('system', '已取消设置。');
              continue;
            }
            const forceEmbedding = trimmed === '2' || trimmed === 'embedding';
            await runStartupInitializer({
              cwd: CWD,
              config: runtime.config,
              prompt: tuiPrompt,
              log: tuiLog,
              forceModelProviderSetup: !forceEmbedding,
              forceEmbeddingSetup: forceEmbedding,
            });
            runtime.renderer.cleanup();
            runtime.unsubscribe();
            runtime = await createRuntime(await reloadConfig());
            runtime.renderer = new EventRenderer(tui.bridge);
            runtime.unsubscribe = runtime.agent.subscribe((event) => runtime.renderer.handleEvent(event));
            tui.bridge.addMessage('system', `OK: 已应用设置：${runtime.config.model.provider}/${runtime.config.model.name}`);
            continue;
          }

          case 'task': {
            const tasksMgr = TasksManager.getInstance(MEMORY_DIR);
            const activeTask = await tasksMgr.getActive();
            if (command.subcommand === 'status') {
              if (!activeTask) {
                tui.bridge.addMessage('system', '当前无活跃任务。');
              } else {
                const phase = activeTask.phases[activeTask.active_phase_index];
                tui.bridge.addMessage('system',
                  `任务：${activeTask.name}\nPhase ${activeTask.active_phase_index + 1}/${activeTask.phases.length}：${phase?.description ?? ''}\n重试次数：${phase?.retry_count ?? 0}`
                );
              }
            } else if (command.subcommand === 'rename') {
              if (!activeTask) {
                tui.bridge.addMessage('system', '当前无活跃任务。');
              } else {
                await tasksMgr.renameTask(activeTask.id, command.name);
                tui.bridge.addMessage('system', `已重命名为：${command.name}`);
              }
            }
            continue;
          }

          case 'candidates':
            tui.bridge.addMessage('system', '候选查看功能待实现');
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
              tui.bridge.addMessage('system', 'git 仓库已初始化并创建初始提交，快照回滚已启用。');
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
            await recordReviewCommand(command, currentTaskDescription);
            tui.bridge.addMessage('system', 'OK: 已记录本轮信心投票');
            continue;

          case 'why':
            tui.bridge.addMessage('system', await renderWhyCommand(command));
            continue;

          case 'plan':
            tui.bridge.addMessage('system', await handlePlanCommand(command));
            continue;

          case 'design':
            tui.bridge.addMessage('system', '[DesignStudy] 正在处理设计命令…');
            try {
              tui.bridge.addMessage('system', await handleDesignCommand(command, runtime));
            } catch (err) {
              tui.bridge.addMessage('system', `[DesignStudy] 失败：${err instanceof Error ? err.message : String(err)}`);
            }
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
      const automaticRevisionMessage = await maybeRecordAutomaticPlanRevision(userInput, activeTask);
      if (automaticRevisionMessage) {
        tui.bridge.addMessage('system', automaticRevisionMessage);
      }

      const feedbackSignal = detectNegativeFeedback(userInput);
      if (feedbackSignal.isNegative && activeTask) {
        automaticDesignCritiqueFailures = 0;
        const phase = activeTask.phases[activeTask.active_phase_index];
        await tasksMgr.incrementRetry(activeTask.id, feedbackSignal.extractedText);

        let ctx7Docs = '';
        if (phase && phase.retry_count >= 2 && runtime.config.features.context7) {
          const ctx7Client = new Context7Client({
            apiKey: runtime.config.context7.apiKey,
            timeoutMs: runtime.config.context7.timeoutMs,
            maxDocsChars: runtime.config.context7.maxDocsChars,
            projectKb: ProjectKbManager.getInstance(MEMORY_DIR),
          });
          ctx7Docs = await buildCtx7RetryContext(
            activeTask.name,
            phase.feedbacks,
            ctx7Client,
            runtime.model,
          );
        }

        const taskContext = buildTaskContextPrefix(activeTask, ctx7Docs);
        const finalPrompt = taskContext + userInput;

        currentTaskDescription = activeTask.name;
        runtime.escalation.initTask(activeTask.name, CWD);
        markReflectBaseline();

        tui.bridge.updateTaskStatus({
          name: activeTask.name,
          phaseIndex: activeTask.active_phase_index,
          totalPhases: activeTask.phases.length,
          retryCount: activeTask.phases[activeTask.active_phase_index]?.retry_count ?? 0,
          toolCallCount: 0,
          elapsedMs: 0,
          state: 'running',
        });

        try {
          runtime.resetFileGuard();
          await runtime.session.prompt(finalPrompt);
          await runtime.agent.waitForIdle();
          tui.bridge.updateTaskStatus({ state: 'idle' });
          const critiqueMessage = await maybeRunAutomaticDesignCritique(runtime, currentTaskDescription);
          if (critiqueMessage) tui.bridge.addMessage('system', critiqueMessage);
          if (runtime.agent.state.errorMessage) {
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

        if (intent.type === 'new_task') {
          automaticDesignCritiqueFailures = 0;
          currentTaskDescription = intent.taskName ?? userInput;
          runtime.escalation.initTask(currentTaskDescription, CWD);
          markReflectBaseline();

          // ── 阶段 0：规划（planning 模式，最多读 3 个文件）──────────
          tui.bridge.addMessage('system', '[规划中] 正在分析任务并制定执行计划…');
          tui.bridge.updateTaskStatus({
            name: currentTaskDescription,
            phaseIndex: 0,
            totalPhases: 1,
            retryCount: 0,
            toolCallCount: 0,
            elapsedMs: 0,
            state: 'running',
          });

          const planOutputs: string[] = [];
          const planUnsub = runtime.agent.subscribe((event) => {
            if (event.type === 'message_update' && event.message.role === 'assistant') {
              const textContent = event.message.content.find((c) => c.type === 'text');
              if (textContent && textContent.type === 'text') planOutputs.push(textContent.text);
            }
          });

          try {
            runtime.setFileGuardMode('planning');
            await runtime.session.prompt(buildPlanningPrompt(userInput));
            await runtime.agent.waitForIdle();
          } catch (err) {
            tui.bridge.updateTaskStatus({ state: 'failed' });
            tui.bridge.addMessage('system', `规划失败: ${err instanceof Error ? err.message : String(err)}`);
            runtime.setFileGuardMode('normal');
            planUnsub();
            continue;
          } finally {
            planUnsub();
          }

          runtime.setFileGuardMode('normal');
          tui.bridge.updateTaskStatus({ state: 'idle' });

          const planText = planOutputs.join('');
          const planSignal = parsePhaseSignal(planText);

          if (!planSignal || planSignal.type !== 'task_start') {
            tui.bridge.addMessage('system', '[规划失败] Agent 未输出 TASK_START 信号，请重试或换个描述方式。');
            continue;
          }

          const newTask = await tasksMgr.createTask(planSignal.name, planSignal.phases);
          lastPlanSnapshot = createPlanSnapshot(newTask);
          tui.bridge.addMessage('system',
            `[规划完成] ${planSignal.name}，共 ${planSignal.phases.length} 个 Phase。开始执行 Phase 1…`
          );
          tui.bridge.updateTaskStatus({
            name: planSignal.name,
            phaseIndex: 0,
            totalPhases: planSignal.phases.length,
            retryCount: 0,
            toolCallCount: 0,
            elapsedMs: 0,
            state: 'running',
          });

          // ── 阶段 1：自动执行 Phase 1 ──────────────────────────────
          const phase1 = newTask.phases[0];
          const phase1Prompt = buildPhaseExecutionPrompt(planSignal.name, phase1?.description ?? '', 0, planSignal.phases.length);

          const exec1Outputs: string[] = [];
          const exec1Unsub = runtime.agent.subscribe((event) => {
            if (event.type === 'message_update' && event.message.role === 'assistant') {
              const textContent = event.message.content.find((c) => c.type === 'text');
              if (textContent && textContent.type === 'text') exec1Outputs.push(textContent.text);
            }
          });

          try {
            runtime.resetFileGuard();
            currentTaskDescription = planSignal.name;
            runtime.escalation.initTask(currentTaskDescription, CWD);
            await runtime.session.prompt(phase1Prompt);
            await runtime.agent.waitForIdle();
            tui.bridge.updateTaskStatus({ state: 'idle' });
            const critiqueMessage = await maybeRunAutomaticDesignCritique(runtime, currentTaskDescription);
            if (critiqueMessage) tui.bridge.addMessage('system', critiqueMessage);
            if (runtime.agent.state.errorMessage) {
              tui.bridge.addMessage('system', `[Agent Error] ${runtime.agent.state.errorMessage}`);
            }
          } catch (err) {
            tui.bridge.updateTaskStatus({ state: 'failed' });
            tui.bridge.addMessage('system', `Phase 1 执行失败: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            exec1Unsub();
          }

          const exec1Text = exec1Outputs.join('');
          const exec1Signal = parsePhaseSignal(exec1Text);
          if (exec1Signal?.type === 'phase_done') {
            await tasksMgr.completePhase(newTask.id);
            const remaining = await tasksMgr.getActive();
            if (remaining) {
              tui.bridge.addMessage('system', `[Phase 1 完成] 进入 Phase 2，发送任意内容继续。`);
            } else {
              tui.bridge.addMessage('system', `[任务完成] ${planSignal.name}`);
              tui.bridge.clearTaskStatus();
              lastPlanSnapshot = null;
            }
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

          const taskContext = activeTask ? buildTaskContextPrefix(activeTask) : '';
          const finalPrompt = taskContext + userInput;

          currentTaskDescription = activeTask?.name ?? userInput;
          runtime.escalation.initTask(currentTaskDescription, CWD);
          markReflectBaseline();

          if (activeTask) {
            tui.bridge.updateTaskStatus({
              name: activeTask.name,
              phaseIndex: activeTask.active_phase_index,
              totalPhases: activeTask.phases.length,
              retryCount: activeTask.phases[activeTask.active_phase_index]?.retry_count ?? 0,
              toolCallCount: 0,
              elapsedMs: 0,
              state: 'running',
            });
          }

          try {
            runtime.resetFileGuard();
            await runtime.session.prompt(finalPrompt);
            await runtime.agent.waitForIdle();
            tui.bridge.updateTaskStatus({ state: 'idle' });
            const critiqueMessage = await maybeRunAutomaticDesignCritique(runtime, currentTaskDescription);
            if (critiqueMessage) tui.bridge.addMessage('system', critiqueMessage);
            if (runtime.agent.state.errorMessage) {
              tui.bridge.addMessage('system', `[Agent Error] ${runtime.agent.state.errorMessage}`);
            }
          } catch (err) {
            tui.bridge.updateTaskStatus({ state: 'failed' });
            tui.bridge.addMessage('system', `Task error: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            tempUnsubscribe();
          }

          if (activeTask) {
            const fullOutput = agentOutputs.join('');
            const signal = parsePhaseSignal(fullOutput);

            if (signal?.type === 'phase_done') {
              await tasksMgr.completePhase(activeTask.id);
              const updatedTask = await tasksMgr.getActive();
              if (updatedTask) {
                tui.bridge.addMessage('system', `[Phase ${signal.phaseIndex + 1} 完成] 进入下一 Phase`);
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

    const rl = createInterface({
      input,
      output,
      completer: (line: string) => {
        const hits = COMMAND_COMPLETIONS.filter((c) => c.startsWith(line));
        return [hits.length ? hits : COMMAND_COMPLETIONS, line] as [string[], string];
      }
    });

    while (true) {
      const userInput = await rl.question(chalk.cyan('\n> '));
      if (!userInput.trim()) continue;

      // 清除刚才用户输入的行，用灰色背景重新打印全宽
      const cols = process.stdout.columns || 80;
      const styledInput = `> ${userInput}`.padEnd(cols);
      process.stdout.write(`\x1b[1A\x1b[2K\r${chalk.bgGray.white(styledInput)}\n`);

      // ── Slash command 处理 ────────────────────────

      const command = parseCommand(userInput);
      if (command) {
        switch (command.type) {
          case 'quit':
            runtime.renderer.cleanup();
            runtime.unsubscribe();
            rl.close();
            return;

          case 'help':
            console.log(getHelpText());
            continue;

          case 'clear':
            console.clear();
            continue;

          case 'status':
            console.log(chalk.dim(`  任务: ${currentTaskDescription || '(无)'}`));
            console.log(chalk.dim(`  模型: ${runtime.config.model.provider}/${runtime.config.model.name}`));
            console.log(chalk.dim(`  LLM 超时: ${runtime.config.llm.requestTimeoutMs}ms`));
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
            } else {
              console.log(chalk.dim('  已取消。'));
            }
            continue;
          }

          case 'setting':
            runtime = await runSettingFlow(rl, runtime);
            continue;

          case 'task': {
            const tasksMgr = TasksManager.getInstance(MEMORY_DIR);
            const activeTask = await tasksMgr.getActive();
            if (command.subcommand === 'status') {
              if (!activeTask) {
                console.log(chalk.dim('  当前无活跃任务。'));
              } else {
                const phase = activeTask.phases[activeTask.active_phase_index];
                console.log(chalk.cyan(`  任务：${activeTask.name}`));
                console.log(chalk.dim(`  Phase ${activeTask.active_phase_index + 1}/${activeTask.phases.length}：${phase?.description}`));
                console.log(chalk.dim(`  当前 Phase 重试次数：${phase?.retry_count ?? 0}`));
              }
            } else if (command.subcommand === 'rename') {
              if (!activeTask) {
                console.log(chalk.yellow('  当前无活跃任务。'));
              } else {
                await tasksMgr.renameTask(activeTask.id, command.name);
                console.log(chalk.green(`  已重命名为：${command.name}`));
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
            await recordReviewCommand(command, currentTaskDescription);
            console.log(chalk.green('  OK: 已记录本轮信心投票'));
            continue;

          case 'why':
            console.log(chalk.green(await renderWhyCommand(command)));
            continue;

          case 'plan':
            console.log(chalk.green(await handlePlanCommand(command)));
            continue;

          case 'design':
            console.log(chalk.dim('  [DesignStudy] 正在处理设计命令…'));
            try {
              console.log(chalk.green(await handleDesignCommand(command, runtime)));
            } catch (err) {
              console.log(chalk.red(`[DesignStudy] 失败：${err instanceof Error ? err.message : String(err)}`));
            }
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
      const automaticRevisionMessage = await maybeRecordAutomaticPlanRevision(userInput, activeTask);
      if (automaticRevisionMessage) {
        console.log(chalk.dim(`  ${automaticRevisionMessage}`));
      }

      // 负反馈检测
      const feedbackSignal = detectNegativeFeedback(userInput);
      if (feedbackSignal.isNegative && activeTask) {
        const phase = activeTask.phases[activeTask.active_phase_index];
        await tasksMgr.incrementRetry(activeTask.id, feedbackSignal.extractedText);

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
            activeTask.name,
            phase.feedbacks,
            ctx7Client,
            runtime.model,
          );
        }

        // 注入任务上下文
        const taskContext = buildTaskContextPrefix(activeTask, ctx7Docs);
        const finalPrompt = taskContext + userInput;

        currentTaskDescription = activeTask.name;
        runtime.escalation.initTask(activeTask.name, CWD);
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

        if (intent.type === 'new_task') {
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

          try {
            await runTaskWithAbort(runtime, userInput);
          } catch (err) {
            console.error(
              chalk.red('Task error:'),
              err instanceof Error ? err.message : String(err),
            );
          } finally {
            tempUnsubscribe();
          }

          // 解析信号
          const fullOutput = agentOutputs.join('');
          const signal = parsePhaseSignal(fullOutput);

          if (signal?.type === 'task_start') {
            const newTask = await tasksMgr.createTask(signal.name, signal.phases);
            lastPlanSnapshot = createPlanSnapshot(newTask);
            console.log(chalk.green(`\n  [任务已创建] ${signal.name}，共 ${signal.phases.length} 个 Phase`));
          } else if (signal?.type === 'phase_done' && activeTask) {
            await tasksMgr.completePhase(activeTask.id);
            const updatedTask = await tasksMgr.getActive();
            if (updatedTask) {
              console.log(chalk.green(`\n  [Phase ${signal.phaseIndex + 1} 完成] 进入下一 Phase`));
            } else {
              console.log(chalk.green(`\n  [任务完成] ${activeTask.name}`));
              lastPlanSnapshot = null;
            }
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

          const taskContext = activeTask ? buildTaskContextPrefix(activeTask) : '';
          const finalPrompt = taskContext + userInput;

          currentTaskDescription = activeTask?.name ?? userInput;
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
          if (activeTask) {
            const fullOutput = agentOutputs.join('');
            const signal = parsePhaseSignal(fullOutput);

            if (signal?.type === 'phase_done') {
              await tasksMgr.completePhase(activeTask.id);
              const updatedTask = await tasksMgr.getActive();
              if (updatedTask) {
                console.log(chalk.green(`\n  [Phase ${signal.phaseIndex + 1} 完成] 进入下一 Phase`));
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

type DesignCommand = Extract<SlashCommand, { type: 'design' }>;
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
  const taskName = currentTaskDescription || '用户反馈返工';
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
    await runtime.session.prompt(buildFeedbackRepairPrompt(taskName, feedback));
    await runtime.agent.waitForIdle();
    bridge.updateTaskStatus({ state: 'idle' });
    const critiqueMessage = await maybeRunAutomaticDesignCritique(runtime, currentTaskDescription);
    if (critiqueMessage) bridge.addMessage('system', critiqueMessage);
    if (runtime.agent.state.errorMessage) {
      bridge.addMessage('system', `[Agent Error] ${runtime.agent.state.errorMessage}`);
    }
  } catch (err) {
    bridge.updateTaskStatus({ state: 'failed' });
    bridge.addMessage('system', `反馈返工失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runConsoleFeedbackRepair(runtime: RuntimeState, feedback: string): Promise<void> {
  const taskName = currentTaskDescription || '用户反馈返工';
  currentTaskDescription = taskName;
  runtime.escalation.initTask(taskName, CWD);
  markReflectBaseline();
  try {
    await runTaskWithAbort(runtime, buildFeedbackRepairPrompt(taskName, feedback));
  } catch (err) {
    console.error(
      chalk.red('反馈返工失败:'),
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

async function handleDesignCommand(
  command: DesignCommand,
  runtime: RuntimeState,
): Promise<string> {
  if (!runtime.config.features.designStudy) {
    return 'DesignStudy 未启用。设置 STUDENT_AGENT_FEATURE_DESIGN_STUDY=true 后重启即可使用。';
  }

  const memory = DesignMemoryManager.getInstance(MEMORY_DIR);
  const taskId = `design_${Date.now()}`;
  const sessionRef = `session_${Date.now()}`;

  switch (command.subcommand) {
    case 'study': {
      const candidate = await runtime.designService.study({
        url: command.url,
        name: command.name,
        taskId,
        sessionRef,
      });
      return [
        `已生成设计候选：${candidate.name}`,
        `candidate_id: ${candidate.id}`,
        `观察次数：${candidate.observations}`,
        '',
        formatDesignEvidence(candidate),
        '下一步：/design confirm <candidate-id> 确认为 StyleProfile。',
      ].join('\n');
    }
    case 'confirm': {
      const profile = await runtime.designService.confirmCandidate(command.candidateId, taskId, sessionRef);
      return [
        `已确认 StyleProfile：${profile.name}`,
        `profile_id: ${profile.id}`,
        `作用域：当前项目（${MEMORY_DIR}）`,
        '这个风格默认只在当前项目生效；如需跨项目复用，运行 /design globalize <profile-id> 加入全局。',
        '可用 /design use <profile-id> 设为当前 UI 实现风格。',
      ].join('\n');
    }
    case 'use':
      await runtime.designService.useProfile(command.profileId);
      return `已启用 StyleProfile：${command.profileId}`;

    case 'globalize': {
      const globalMemory = new DesignMemoryManager(GLOBAL_MEMORY_DIR);
      const profile = await memory.copyProfileTo(command.profileId, globalMemory);
      return [
        `已加入全局 StyleProfile：${profile.name}`,
        `profile_id: ${profile.id}`,
        `全局位置：${GLOBAL_MEMORY_DIR}/design-profiles/${profile.id}.json`,
        '其他项目可用 /design use-global <profile-id> 引入并启用。',
      ].join('\n');
    }

    case 'globals': {
      const globalMemory = new DesignMemoryManager(GLOBAL_MEMORY_DIR);
      const profiles = await globalMemory.getProfiles();
      if (profiles.length === 0) {
        return '暂无全局 StyleProfile。可在项目中确认风格后运行 /design globalize <profile-id>。';
      }
      return [
        '全局 StyleProfile：',
        ...profiles.map((profile) => `- ${profile.id}：${profile.name}`),
      ].join('\n');
    }

    case 'use-global': {
      const globalMemory = new DesignMemoryManager(GLOBAL_MEMORY_DIR);
      const profile = await globalMemory.copyProfileTo(command.profileId, memory);
      await runtime.designService.useProfile(profile.id);
      return [
        `已引入并启用全局 StyleProfile：${profile.name}`,
        `profile_id: ${profile.id}`,
        `项目位置：${MEMORY_DIR}/design-profiles/${profile.id}.json`,
      ].join('\n');
    }

    case 'local-url':
      assertLocalDesignUrl(command.url);
      await memory.setLocalUrl(command.url);
      return `已设置本地视觉自评地址：${command.url}`;

    case 'critique': {
      const profile = command.profileId
        ? await memory.getProfile(command.profileId)
        : await memory.getActiveProfile();
      if (!profile) {
        return '没有可用 StyleProfile。请先 /design confirm 再 /design use，或传入 profile_id。';
      }
      const url = command.url ?? await memory.getLocalUrl() ?? runtime.config.designStudy.localUrl;
      if (!url) {
        return '没有本地页面地址。请先运行 /design local-url <url>，或在命令中传入 URL。';
      }
      const critique = await runtime.designService.critique(url, profile, taskId, sessionRef);
      const score = Math.round(critique.score * 100);
      const failures = critique.failures.length > 0
        ? `\n失败项：\n${critique.failures.map((failure) => `- ${failure}`).join('\n')}`
        : '';
      return `视觉自评分数：${score}%（阈值 ${Math.round(runtime.config.designStudy.criticThreshold * 100)}%）${failures}`;
    }
  }
}

function formatDesignEvidence(candidate: DesignCandidate): string {
  const viewports = candidate.screenshots.map((shot) => `${shot.viewport} ${shot.width}x${shot.height}`);
  const roles = countBy(candidate.samples.map((sample) => sample.role));
  const tokens = candidate.tokens;
  return [
    '检查证据：',
    `- 来源 URL：${candidate.source_urls.join(', ')}`,
    `- 截图：${candidate.screenshots.length} 张（${viewports.join('；') || '无'}）`,
    `- computed style 样本：${candidate.samples.length} 个（${formatCounts(roles)}）`,
    `- 颜色：背景 ${tokens.colors.background.length} / 文本 ${tokens.colors.text.length} / 强调 ${tokens.colors.accent.length}`,
    `- 字体权重：${JSON.stringify(tokens.fontWeight)}`,
    `- 边框：${JSON.stringify(tokens.border)}`,
    `- 圆角：${tokens.radius.slice(0, 6).join(', ') || '未提取'}`,
    `- 阴影：${tokens.shadow.slice(0, 4).join(', ') || '未提取'}`,
    `- 组件模式：${Object.keys(candidate.component_patterns).join(', ') || '未识别'}`,
    '- 审计位置：memory/design-candidates.json',
  ].join('\n');
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return '无';
  return entries.map(([key, count]) => `${key}:${count}`).join(', ');
}

async function maybeRunAutomaticDesignCritique(runtime: RuntimeState, taskDescription: string): Promise<string | null> {
  if (!runtime.config.features.designStudy) return null;
  if (automaticDesignCritiqueFailures >= runtime.config.designStudy.maxCriticRetries) return null;
  if (!isUiImplementationTask(taskDescription)) return null;

  const memory = DesignMemoryManager.getInstance(MEMORY_DIR);
  const profile = await memory.getActiveProfile();
  const url = await memory.getLocalUrl() ?? runtime.config.designStudy.localUrl;
  if (!profile || !url) return null;

  try {
    const critique = await runtime.designService.critique(
      url,
      profile,
      `task_${Date.now()}`,
      `session_${Date.now()}`,
    );
    const score = Math.round(critique.score * 100);
    if (!critique.revision_required) {
      automaticDesignCritiqueFailures = 0;
      return `[DesignCritic] 视觉一致性 ${score}%，已通过当前 StyleProfile。`;
    }
    automaticDesignCritiqueFailures++;
    return [
      `[DesignCritic] 视觉一致性 ${score}%，低于阈值 ${Math.round(runtime.config.designStudy.criticThreshold * 100)}%。`,
      '下一轮 UI 修改请优先修正：',
      ...critique.failures.map((failure) => `- ${failure}`),
    ].join('\n');
  } catch (err) {
    return `[DesignCritic] 自评失败：${err instanceof Error ? err.message : String(err)}`;
  }
}

function isUiImplementationTask(taskDescription: string): boolean {
  return /\b(ui|ux|css|html|frontend|front-end|react|vue|svelte|tailwind|style|styles|component|layout|page|screen|website|web app)\b/i.test(taskDescription)
    || /(前端|页面|网页|样式|视觉|界面|组件|布局|按钮|卡片|移动端|响应式)/.test(taskDescription);
}

async function reloadConfig(): Promise<StudentAgentConfig> {
  // 先加载全局 env（~/.student-agent/.env），再用项目 .env 覆盖
  await loadEnvFile({ cwd: GLOBAL_CONFIG_DIR, filename: '.env', override: true });
  const initialConfig = await loadStudentAgentConfig({ cwd: CWD });
  await loadEnvFile({ cwd: CWD, filename: initialConfig.envFile, override: true });
  return loadStudentAgentConfig({ cwd: CWD });
}

async function createRuntime(config: StudentAgentConfig): Promise<RuntimeState> {
  const model = buildModel(config);
  const abortRef = { abort: () => {} };
  const { hooks, escalation, resetFileGuard, setFileGuardMode } = buildHooks(config, abortRef);

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
  const designMemory = DesignMemoryManager.getInstance(MEMORY_DIR);
  const designService = new DesignStudyService({
    memory: designMemory,
    nativeExtractor: new NativePlaywrightExtractor({
      navigationTimeoutMs: config.playwright.navigationTimeoutMs,
      renderWaitMs: config.playwright.renderWaitMs,
    }),
    extractorMode: config.designStudy.extractorMode,
    dembrandtCommand: config.designStudy.dembrandtCommand,
    criticThreshold: config.designStudy.criticThreshold,
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
    designService,
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
): Promise<'model' | 'embedding' | 'cancel'> {
  const answer = (await rl.question(
    [
      '设置项：',
      '  1) 模型 Provider / API Key',
      '  2) 向量模型',
      '  q) 取消',
      '选择 [1]: ',
    ].join('\n'),
  )).trim().toLowerCase();

  if (answer === 'q' || answer === 'quit' || answer === 'cancel') {
    return 'cancel';
  }
  if (answer === '2' || answer === 'embedding' || answer === 'vector' || answer === '向量模型') {
    return 'embedding';
  }
  return 'model';
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
    const critiqueMessage = await maybeRunAutomaticDesignCritique(runtime, currentTaskDescription);
    if (critiqueMessage) {
      console.log(chalk.yellow('\n' + critiqueMessage));
    }

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
