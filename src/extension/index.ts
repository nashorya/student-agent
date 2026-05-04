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
import { stdin as input, stdout as output } from 'node:process';
import { join } from 'node:path';
import chalk from 'chalk';
import { getModel, getModels } from '@mariozechner/pi-ai';
import { loadEnvFile } from '../core/env.js';
import { loadStudentAgentConfig } from '../core/config/loader.js';
import type { StudentAgentConfig } from '../core/config/types.js';
import { createStudentSession, type StudentAgentHooks } from '../core/pi-bridge/session-factory.js';
import { Context7Client } from '../knowledge/context7-client.js';
import { createSnapshotHook, getLastSnapshotId, restoreSnapshot } from './hooks/snapshot.js';
import { FailureEscalationContext } from './hooks/failure-escalation.js';
import { createMemoryHook } from './hooks/memory.js';
import { createReflectHook, markReflectBaseline } from './hooks/reflect.js';
import { createQualityWatchdogHook } from './hooks/quality-watchdog.js';
import { QualityFeedbackManager, parseFeedbackCommand } from '../watchdog/feedback-collector.js';
import { EventRenderer } from '../cli/event-renderer.js';
import { parseCommand, getHelpText, COMMANDS } from '../cli/command-parser.js';
import { printBanner } from '../cli/banner.js';

// ── 配置 ──────────────────────────────────────────────

const CWD = process.cwd();
const MEMORY_DIR = join(CWD, 'memory');

/** 当前任务描述（用于 ReflectAgent 和失败升级的诊断报告） */
let currentTaskDescription = '';

// ── 构建模型 ──────────────────────────────────────────

function buildModel(config: StudentAgentConfig) {
  const defaultModel = getModel('anthropic', 'claude-sonnet-4-6');
  const configuredModel = getModels(config.model.provider).find((model) => model.id === config.model.name);
  const baseModel = configuredModel ?? defaultModel;
  return {
    ...baseModel,
    baseUrl: config.model.baseUrl ?? baseModel.baseUrl,
  };
}

// ── 组装 Hooks ────────────────────────────────────────

function buildHooks(config: StudentAgentConfig): { hooks: StudentAgentHooks; escalation: FailureEscalationContext } {
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
    getLastSnapshotId,
    restoreSnapshot,
  });

  const hooks: StudentAgentHooks = {
    onBeforeToolCall: createSnapshotHook(CWD),
    onAfterToolCall: escalation.createHook(),
    buildMemoryPrompt: createMemoryHook(MEMORY_DIR),
    onSessionEnd: async (ctx) => {
      await reflectHook(ctx);
      await watchdogHook?.(ctx);
    },
  };

  return { hooks, escalation };
}

// ── 主入口 ─────────────────────────────────────────────

async function main(): Promise<void> {
  const initialConfig = await loadStudentAgentConfig({ cwd: CWD });
  await loadEnvFile({ cwd: CWD, filename: initialConfig.envFile });
  const config = await loadStudentAgentConfig({ cwd: CWD });

  const model = buildModel(config);
  const { hooks, escalation } = buildHooks(config);

  const { session, agent } = await createStudentSession({
    cwd: CWD,
    model,
    hooks,
    llm: {
      timeoutMs: config.llm.requestTimeoutMs,
      maxTokens: config.llm.maxOutputTokens,
      maxRetries: config.llm.maxRetries,
      maxRetryDelayMs: config.llm.maxRetryDelayMs,
    },
  });

  // ── 订阅 AgentEvent 流 ───────────────────────────

  const renderer = new EventRenderer();
  agent.subscribe((event) => {
    renderer.handleEvent(event);
  });

  // ── REPL ─────────────────────────────────────────

  printBanner();

  const rl = createInterface({
    input,
    output,
    completer: (line: string) => {
      const hits = COMMANDS.filter((c) => c.startsWith(line));
      return [hits.length ? hits : COMMANDS, line] as [string[], string];
    }
  });

  while (true) {
    const userInput = await rl.question(chalk.cyan('\n❯ '));
    if (!userInput.trim()) continue;

    // 清除刚才用户输入的行，用灰色背景重新打印全宽
    const cols = process.stdout.columns || 80;
    const styledInput = `❯ ${userInput}`.padEnd(cols);
    // 回退一行 (\x1b[1A)，清除 (\x1b[2K)，回到行首 (\r)，打印，换行
    process.stdout.write(`\x1b[1A\x1b[2K\r${chalk.bgGray.white(styledInput)}\n`);

    // ── Slash command 处理 ────────────────────────

    const command = parseCommand(userInput);
    if (command) {
      switch (command.type) {
        case 'quit':
          renderer.cleanup();
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
          console.log(chalk.dim(`  模型: ${config.model.provider}/${config.model.name}`));
          console.log(chalk.dim(`  LLM 超时: ${config.llm.requestTimeoutMs}ms`));
          continue;

        case 'candidates':
          // TODO: 接入 PreferenceCandidatesManager
          console.log(chalk.dim('  候选查看功能待实现'));
          continue;

        case 'feedback':
          if (config.features.qualityWatchdog) {
            await QualityFeedbackManager.getInstance(MEMORY_DIR).append({
              task_id: `manual_${Date.now()}`,
              session_ref: `session_${Date.now()}`,
              task_description: currentTaskDescription,
              rating: command.rating,
              comment: command.comment,
            });
            console.log(chalk.green('✓ 已记录质量反馈'));
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

    const feedback = config.features.qualityWatchdog ? parseFeedbackCommand(userInput) : null;
    if (feedback) {
      await QualityFeedbackManager.getInstance(MEMORY_DIR).append({
        task_id: `manual_${Date.now()}`,
        session_ref: `session_${Date.now()}`,
        task_description: currentTaskDescription,
        rating: feedback.rating,
        comment: feedback.comment,
      });
      console.log(chalk.green('✓ 已记录质量反馈'));
      continue;
    }

    // ── 正常任务提交 ──────────────────────────────

    currentTaskDescription = userInput;
    escalation.initTask(userInput, CWD);
    markReflectBaseline();

    try {
      await session.prompt(userInput);
      await agent.waitForIdle();

      // 流式输出已在 subscribe 回调中完成。
      // waitForIdle 确保所有工具执行和 hooks 完成后再回到 REPL。

      if (agent.state.errorMessage) {
        console.error(chalk.red(`[Agent Error] ${agent.state.errorMessage}`));
      }
    } catch (err) {
      console.error(
        chalk.red('Task error:'),
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  rl.close();
}

main().catch((err: unknown) => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
