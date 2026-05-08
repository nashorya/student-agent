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
import { EventRenderer } from '../cli/event-renderer.js';
import { parseCommand, getHelpText, COMMANDS } from '../cli/command-parser.js';
import { printBanner } from '../cli/banner.js';
import { startTUI, isTTY } from '../tui/index.js';
import { TasksManager } from '../memory/tasks/manager.js';
import { parsePhaseSignal } from '../core/task-planner/phase-signal.js';
import { detectNegativeFeedback } from '../core/task-planner/feedback-detector.js';
import { classifyIntent } from '../core/task-planner/intent-classifier.js';
import { buildTaskContextPrefix } from '../core/task-planner/task-context-builder.js';
import { buildCtx7RetryContext } from '../core/task-planner/ctx7-retry-builder.js';
import { buildPlanningPrompt, buildPhaseExecutionPrompt } from '../core/task-planner/planning-prompt.js';

// ── 配置 ──────────────────────────────────────────────

const CWD = process.env.STUDENT_AGENT_CWD ?? process.cwd();
const MEMORY_DIR = join(CWD, 'memory');

// 早期检测：CWD 为根目录会导致 memory/ 写入 /memory（需要 root 权限）
if (CWD === '/') {
  console.error('[StudentAgent] 错误：工作目录为文件系统根目录（/）。');
  console.error('  请从项目目录运行：cd /path/to/project && npm run dev');
  console.error('  或设置 STUDENT_AGENT_CWD 环境变量指向项目目录。');
  process.exit(1);
}

/** 当前任务描述（用于 ReflectAgent 和失败升级的诊断报告） */
let currentTaskDescription = '';

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
    let resolveSubmit: ((value: string) => void) | null = null;

    const tui = startTUI({
      onSubmit: (value) => { resolveSubmit?.(value); },
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
      const userInput = await new Promise<string>((resolve) => { resolveSubmit = resolve; });
      if (!userInput.trim()) continue;

      tui.bridge.addMessage('user', userInput);

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
            if (runtime.config.features.qualityWatchdog) {
              await QualityFeedbackManager.getInstance(MEMORY_DIR).append({
                task_id: `manual_${Date.now()}`,
                session_ref: `session_${Date.now()}`,
                task_description: currentTaskDescription,
                rating: command.rating,
                comment: command.comment,
              });
              tui.bridge.addMessage('system', 'OK: 已记录质量反馈');
            } else {
              tui.bridge.addMessage('system', 'qualityWatchdog 未启用');
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
        await QualityFeedbackManager.getInstance(MEMORY_DIR).append({
          task_id: `manual_${Date.now()}`,
          session_ref: `session_${Date.now()}`,
          task_description: currentTaskDescription,
          rating: feedback.rating,
          comment: feedback.comment,
        });
        tui.bridge.addMessage('system', 'OK: 已记录质量反馈');
        continue;
      }

      // ── 正常任务提交 ──────────────────────────────

      const tasksMgr = TasksManager.getInstance(MEMORY_DIR);
      const activeTask = await tasksMgr.getActive();

      const feedbackSignal = detectNegativeFeedback(userInput);
      if (feedbackSignal.isNegative && activeTask) {
        const phase = activeTask.phases[activeTask.active_phase_index];
        await tasksMgr.incrementRetry(activeTask.id, feedbackSignal.extractedText);

        let ctx7Docs = '';
        if (phase && phase.retry_count >= 2 && runtime.config.features.context7) {
          const ctx7Client = new Context7Client({
            apiKey: runtime.config.context7.apiKey,
            timeoutMs: runtime.config.context7.timeoutMs,
            maxDocsChars: runtime.config.context7.maxDocsChars,
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

          let planText = '';
          const planUnsub = runtime.agent.subscribe((event) => {
            if (event.type === 'message_update' && event.message.role === 'assistant') {
              const textContent = event.message.content.find((c) => c.type === 'text');
              if (textContent && textContent.type === 'text') planText = textContent.text;
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

          const planSignal = parsePhaseSignal(planText);

          if (!planSignal || planSignal.type !== 'task_start') {
            tui.bridge.addMessage('system', '[规划失败] Agent 未输出 TASK_START 信号，请重试或换个描述方式。');
            continue;
          }

          const newTask = await tasksMgr.createTask(planSignal.name, planSignal.phases);
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

          let exec1Text = '';
          const exec1Unsub = runtime.agent.subscribe((event) => {
            if (event.type === 'message_update' && event.message.role === 'assistant') {
              const textContent = event.message.content.find((c) => c.type === 'text');
              if (textContent && textContent.type === 'text') exec1Text = textContent.text;
            }
          });

          try {
            runtime.resetFileGuard();
            currentTaskDescription = planSignal.name;
            runtime.escalation.initTask(currentTaskDescription, CWD);
            await runtime.session.prompt(phase1Prompt);
            await runtime.agent.waitForIdle();
            tui.bridge.updateTaskStatus({ state: 'idle' });
            if (runtime.agent.state.errorMessage) {
              tui.bridge.addMessage('system', `[Agent Error] ${runtime.agent.state.errorMessage}`);
            }
          } catch (err) {
            tui.bridge.updateTaskStatus({ state: 'failed' });
            tui.bridge.addMessage('system', `Phase 1 执行失败: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            exec1Unsub();
          }

          const exec1Signal = parsePhaseSignal(exec1Text);
          if (exec1Signal?.type === 'phase_done') {
            await tasksMgr.completePhase(newTask.id);
            const remaining = await tasksMgr.getActive();
            if (remaining) {
              tui.bridge.addMessage('system', `[Phase 1 完成] 进入 Phase 2，发送任意内容继续。`);
            } else {
              tui.bridge.addMessage('system', `[任务完成] ${planSignal.name}`);
              tui.bridge.clearTaskStatus();
            }
          }
        } else {
          let agentLastOutput = '';
          const tempUnsubscribe = runtime.agent.subscribe((event) => {
            if (event.type === 'message_update' && event.message.role === 'assistant') {
              const textContent = event.message.content.find((c) => c.type === 'text');
              if (textContent && textContent.type === 'text') {
                agentLastOutput = textContent.text;
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
            const signal = parsePhaseSignal(agentLastOutput);

            if (signal?.type === 'phase_done') {
              await tasksMgr.completePhase(activeTask.id);
              const updatedTask = await tasksMgr.getActive();
              if (updatedTask) {
                tui.bridge.addMessage('system', `[Phase ${signal.phaseIndex + 1} 完成] 进入下一 Phase`);
              } else {
                tui.bridge.addMessage('system', `[任务完成] ${activeTask.name}`);
                tui.bridge.clearTaskStatus();
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
        const hits = COMMANDS.filter((c) => c.startsWith(line));
        return [hits.length ? hits : COMMANDS, line] as [string[], string];
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
            if (runtime.config.features.qualityWatchdog) {
              await QualityFeedbackManager.getInstance(MEMORY_DIR).append({
                task_id: `manual_${Date.now()}`,
                session_ref: `session_${Date.now()}`,
                task_description: currentTaskDescription,
                rating: command.rating,
                comment: command.comment,
              });
              console.log(chalk.green('OK: 已记录质量反馈'));
            } else {
              console.log(chalk.dim('  qualityWatchdog 未启用'));
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
        await QualityFeedbackManager.getInstance(MEMORY_DIR).append({
          task_id: `manual_${Date.now()}`,
          session_ref: `session_${Date.now()}`,
          task_description: currentTaskDescription,
          rating: feedback.rating,
          comment: feedback.comment,
        });
        console.log(chalk.green('OK: 已记录质量反馈'));
        continue;
      }

      // ── 正常任务提交 ──────────────────────────────

      const tasksMgr = TasksManager.getInstance(MEMORY_DIR);
      const activeTask = await tasksMgr.getActive();

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
          let agentLastOutput = '';
          const tempUnsubscribe = runtime.agent.subscribe((event) => {
            if (event.type === 'message_update' && event.message.role === 'assistant') {
              const textContent = event.message.content.find((c) => c.type === 'text');
              if (textContent && textContent.type === 'text') {
                agentLastOutput = textContent.text;
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

          const signal = parsePhaseSignal(agentLastOutput);

          if (signal?.type === 'task_start') {
            await tasksMgr.createTask(signal.name, signal.phases);
            console.log(chalk.green(`\n  [任务已创建] ${signal.name}，共 ${signal.phases.length} 个 Phase`));
          } else if (signal?.type === 'phase_done' && activeTask) {
            await tasksMgr.completePhase(activeTask.id);
            const updatedTask = await tasksMgr.getActive();
            if (updatedTask) {
              console.log(chalk.green(`\n  [Phase ${signal.phaseIndex + 1} 完成] 进入下一 Phase`));
            } else {
              console.log(chalk.green(`\n  [任务完成] ${activeTask.name}`));
            }
          }
        } else {
          // 继续当前任务或其他操作
          let agentLastOutput = '';
          const tempUnsubscribe = runtime.agent.subscribe((event) => {
            if (event.type === 'message_update' && event.message.role === 'assistant') {
              const textContent = event.message.content.find((c) => c.type === 'text');
              if (textContent && textContent.type === 'text') {
                agentLastOutput = textContent.text;
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

          if (activeTask) {
            const signal = parsePhaseSignal(agentLastOutput);

            if (signal?.type === 'phase_done') {
              await tasksMgr.completePhase(activeTask.id);
              const updatedTask = await tasksMgr.getActive();
              if (updatedTask) {
                console.log(chalk.green(`\n  [Phase ${signal.phaseIndex + 1} 完成] 进入下一 Phase`));
              } else {
                console.log(chalk.green(`\n  [任务完成] ${activeTask.name}`));
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
