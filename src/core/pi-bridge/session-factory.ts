/**
 * Pi Session 工厂 — 用 Pi SDK 创建 AgentSession 并注入 Student Agent 的钩子。
 * 开发期入口：Student Agent 拥有进程，用 createAgentSession() SDK。
 * 稳定后可封装为 Pi Extension。
 */

import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  type CreateAgentSessionOptions,
  type CreateAgentSessionResult,
  type AgentSession,
} from '@mariozechner/pi-coding-agent';
import type { Agent, AgentEvent } from '@mariozechner/pi-agent-core';
import type { Api, Model } from '@mariozechner/pi-ai';
import { createApplyPatchToolDefinition } from './apply-patch-tool.js';
import { createHashlineStore, StudentAgentFilesystem } from '../hashline/index.js';
import { createStudentBashToolDefinition } from './bash-timeout-tool.js';
import {
  createStudentGlobToolDefinition,
  createStudentListFilesToolDefinition,
  createStudentReadManyToolDefinition,
  createStudentSearchFilesToolDefinition,
} from './student-discovery-tools.js';
import {
  createStudentEditToolDefinition,
  createStudentReadToolDefinition,
  createStudentWriteToolDefinition,
} from './student-file-tools.js';
import {
  toPreToolCallContext,
  toPostToolCallContext,
  type PreToolCallDecision,
  toAfterToolCallResult,
  toSessionEndContext,
} from './types.js';
import type { EscalationDecision, PostToolCallContext, PreToolCallContext, SessionEndContext } from './types.js';

// ── Hook 接口 ───────────────────────────────────────

/** Student Agent 各 hook 模块实现的接口 */
export interface StudentAgentHooks {
  /** 工具调用前（git 快照等） */
  onBeforeToolCall?: (ctx: PreToolCallContext) => Promise<PreToolCallDecision | undefined>;
  /** 工具调用后（失败升级等）；返回 undefined 表示不干预 */
  onAfterToolCall?: (ctx: PostToolCallContext) => Promise<EscalationDecision | undefined>;
  /** 会话结束（ReflectAgent 等） */
  onSessionEnd?: (ctx: SessionEndContext) => Promise<void>;
  /** 构建 system prompt 前缀（记忆注入） */
  buildMemoryPrompt?: () => Promise<string>;
}

export interface LlmRequestLimits {
  timeoutMs?: number;
  maxTokens?: number;
  maxRetries?: number;
  maxRetryDelayMs?: number;
  apiKey?: string;
}

// ── Session 创建 ────────────────────────────────────

export interface CreateStudentSessionOptions {
  /** 工作目录 */
  cwd?: string;
  /** LLM 模型 */
  model?: Model<Api>;
  /** Student Agent 钩子 */
  hooks: StudentAgentHooks;
  /** Provider-level request limits injected into each LLM stream call. */
  llm?: LlmRequestLimits;
  /**
   * 显式 API Key（供自定义 provider 使用）。
   * Pi 的 hasConfiguredAuth 不认识自定义 provider，需通过 registerProvider 注入。
   */
  apiKey?: string;
  /** 额外传递给 Pi 的选项 */
  piOptions?: Partial<CreateAgentSessionOptions>;
}

export interface CreateStudentSessionResult {
  session: AgentSession;
  agent: Agent;
  piResult: CreateAgentSessionResult;
}

/**
 * 创建绑定了 Student Agent 钩子的 Pi Session。
 *
 * - beforeToolCall → hooks.onBeforeToolCall（通过 pi-bridge 转换）
 * - afterToolCall → hooks.onAfterToolCall（通过 pi-bridge 转换）
 * - agent_end 事件 → hooks.onSessionEnd
 * - system prompt 注入 hooks.buildMemoryPrompt 的输出
 */
export async function createStudentSession(
  options: CreateStudentSessionOptions,
): Promise<CreateStudentSessionResult> {
  const { cwd = process.cwd(), model, hooks, llm, apiKey, piOptions = {} } = options;

  const hashlineStore = createHashlineStore();
  const hashlineFs = new StudentAgentFilesystem(cwd);

  const customTools: CreateAgentSessionOptions['customTools'] = [
    ...(piOptions.customTools ?? []),
    createStudentListFilesToolDefinition(cwd),
    createStudentGlobToolDefinition(cwd),
    createStudentSearchFilesToolDefinition(cwd),
    createStudentReadManyToolDefinition(cwd),
    createStudentBashToolDefinition(cwd),
    createStudentReadToolDefinition(cwd, { store: hashlineStore }),
    createStudentEditToolDefinition(cwd, { store: hashlineStore, fs: hashlineFs }),
    createStudentWriteToolDefinition(cwd),
    createApplyPatchToolDefinition(cwd),
  ] as CreateAgentSessionOptions['customTools'];

  const agentOptions: CreateAgentSessionOptions = {
    cwd,
    model,
    sessionManager: piOptions.sessionManager ?? SessionManager.inMemory(),
    ...piOptions,
    customTools,
  };

  if (hooks.buildMemoryPrompt) {
    const memoryPrompt = await hooks.buildMemoryPrompt();
    if (memoryPrompt) {
      if (piOptions.resourceLoader) {
        throw new Error('buildMemoryPrompt cannot be combined with a custom Pi resourceLoader yet');
      }

      const resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir: piOptions.agentDir ?? getAgentDir(),
        settingsManager: piOptions.settingsManager,
        systemPromptOverride: (base) =>
          [memoryPrompt, base].filter((part): part is string => Boolean(part)).join('\n\n'),
      });
      await resourceLoader.reload();
      agentOptions.resourceLoader = resourceLoader;
    }
  }

  const piResult = await createAgentSession(agentOptions);

  const { session } = piResult;
  const { agent } = session;

  // 为自定义 provider 注册 API Key。
  // Pi 的 hasConfiguredAuth 只认识内置 provider 的 env var，
  // 对未知 provider 需通过 registerProvider 把 key 存入 providerRequestConfigs。
  if (apiKey && model) {
    session.modelRegistry.registerProvider(model.provider, { apiKey });
  }

  applyLlmRequestLimits(agent, llm);

  // ── Wire beforeToolCall ─────────────────────────

  if (hooks.onBeforeToolCall) {
    const originalBeforeToolCall = agent.beforeToolCall;
    agent.beforeToolCall = async (piCtx, signal) => {
      // 先执行 Student Agent 的钩子
      const preCtx = toPreToolCallContext(piCtx);
      const studentDecision = await hooks.onBeforeToolCall!(preCtx);
      if (studentDecision?.block) {
        return studentDecision;
      }
      // 再执行原有的 beforeToolCall（如果有）
      return originalBeforeToolCall?.call(agent, piCtx, signal);
    };
  }

  // ── Wire afterToolCall ──────────────────────────

  if (hooks.onAfterToolCall) {
    const originalAfterToolCall = agent.afterToolCall;
    agent.afterToolCall = async (piCtx, signal) => {
      // 先执行原有的 afterToolCall（如果有）
      const originalResult = await originalAfterToolCall?.call(agent, piCtx, signal);

      // 再执行 Student Agent 的失败升级
      const postCtx = toPostToolCallContext(piCtx);
      const decision = await hooks.onAfterToolCall!(postCtx);

      if (decision) {
        // Student Agent 有干预决策，转换为 Pi 的 AfterToolCallResult
        const piDecision = toAfterToolCallResult(decision);
        // 合并：Student Agent 的决策优先于原有的
        return { ...originalResult, ...piDecision };
      }

      return originalResult;
    };
  }

  // ── Wire agent_end 事件 ─────────────────────────

  if (hooks.onSessionEnd) {
    agent.subscribe(async (event: AgentEvent) => {
      if (event.type === 'agent_end') {
        const endCtx = toSessionEndContext(event);
        // 异步执行，不阻塞 Pi 的事件处理
        hooks.onSessionEnd!(endCtx).catch((err: unknown) => {
          console.error(
            '[StudentAgent] onSessionEnd error:',
            err instanceof Error ? err.message : String(err),
          );
        });
      }
    });
  }

  return { session, agent, piResult };
}

export function applyLlmRequestLimits(agent: Agent, limits: LlmRequestLimits | undefined): void {
  if (!limits || Object.values(limits).every((value) => value === undefined)) {
    return;
  }

  const originalStreamFn = agent.streamFn;
  agent.streamFn = (model, context, options) => originalStreamFn(model, context, {
    ...options,
    timeoutMs: options?.timeoutMs ?? limits.timeoutMs,
    maxTokens: options?.maxTokens ?? limits.maxTokens,
    maxRetries: options?.maxRetries ?? limits.maxRetries,
    maxRetryDelayMs: options?.maxRetryDelayMs ?? limits.maxRetryDelayMs,
    apiKey: options?.apiKey ?? limits.apiKey,
  });
}
