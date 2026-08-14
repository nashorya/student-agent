/**
 * Pi Session 工厂 — 用 Pi SDK 创建 AgentSession 并注入 Student Agent 的钩子。
 * 开发期入口：Student Agent 拥有进程，用 createAgentSession() SDK。
 * 稳定后可封装为 Pi Extension。
 */

import { join } from 'node:path';
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  type CreateAgentSessionOptions,
  type CreateAgentSessionResult,
  type AgentSession,
} from '@earendil-works/pi-coding-agent';
import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '../pi-compat/index.js';
import { createApplyPatchToolDefinition } from './apply-patch-tool.js';
import { createArchiveRecordToolDefinition } from './archive-tool.js';
import { createHashlineStore, StudentAgentFilesystem } from '../hashline/index.js';
import { createStudentBashToolDefinition } from './bash-timeout-tool.js';
import {
  createWriteLessonToolDefinition,
  recordWriteLessonAfterToolCall,
  recordWriteLessonBeforeToolCall,
} from './write-lesson-tool.js';
import { getProjectMemoryDir } from '../paths.js';
import { buildWriteLessonPromptSuffix } from '../../memory/lessons/write-lesson-instruction.js';
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
import { TasksManager } from '../../memory/tasks/manager.js';
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
   * Pi 的 hasConfiguredAuth 不认识自定义 provider，需通过 modelRuntime.setRuntimeApiKey 注入。
   */
  apiKey?: string;
  /** Whether agents may stage durable project archive records. */
  projectArchive?: boolean;
  /**
   * Eval skill isolation: only load skills from these roots.
   * When set (even to []), disables default agentDir/home skill discovery.
   */
  controlledSkillRoots?: string[];
  /** 额外传递给 Pi 的选项 */
  piOptions?: Partial<CreateAgentSessionOptions>;
  /**
   * Context for write_lesson. Task/session/repo are factory-supplied, never model-supplied.
   * Defaults: memoryDir = getProjectMemoryDir(), taskId/sessionRef = unknown_*.
   */
  writeLesson?: {
    memoryDir?: string;
    getTaskId?: () => string;
    getSessionRef?: () => string;
    repo?: string;
  };
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
  const {
    cwd = process.cwd(),
    model,
    hooks,
    llm,
    apiKey,
    projectArchive = true,
    controlledSkillRoots,
    piOptions = {},
    writeLesson,
  } = options;

  const hashlineStore = createHashlineStore();
  const hashlineFs = new StudentAgentFilesystem(cwd);
  const tasksManager = TasksManager.getInstance();
  const sessionEvents: Array<Record<string, unknown>> = [];
  const writeLessonMemoryDir = writeLesson?.memoryDir ?? getProjectMemoryDir();

  const customTools: CreateAgentSessionOptions['customTools'] = [
    ...(piOptions.customTools ?? []),
    createStudentListFilesToolDefinition(cwd),
    createStudentGlobToolDefinition(cwd),
    createStudentSearchFilesToolDefinition(cwd),
    createStudentReadManyToolDefinition(cwd),
    createStudentBashToolDefinition(cwd),
    createStudentReadToolDefinition(cwd, { store: hashlineStore, tasksManager }),
    createStudentEditToolDefinition(cwd, { store: hashlineStore, fs: hashlineFs, tasksManager }),
    createStudentWriteToolDefinition(cwd),
    createApplyPatchToolDefinition(cwd, { tasksManager }),
    createWriteLessonToolDefinition({
      memoryDir: writeLessonMemoryDir,
      getTaskId: writeLesson?.getTaskId ?? (() => 'unknown_task'),
      getSessionRef: writeLesson?.getSessionRef ?? (() => 'unknown_session'),
      repo: writeLesson?.repo,
      sessionEvents,
    }),
    ...(projectArchive ? [createArchiveRecordToolDefinition(cwd)] : []),
  ] as CreateAgentSessionOptions['customTools'];

  const agentOptions: CreateAgentSessionOptions = {
    cwd,
    model,
    sessionManager: piOptions.sessionManager ?? SessionManager.inMemory(),
    ...piOptions,
    customTools,
  };

  const isolateSkills = controlledSkillRoots !== undefined;
  const isolatedAgentDir = isolateSkills
    ? join(cwd, '.pi-eval-agent')
    : (piOptions.agentDir ?? getAgentDir());

  const memoryPrompt = hooks.buildMemoryPrompt ? await hooks.buildMemoryPrompt() : '';
  const writeLessonSuffix = buildWriteLessonPromptSuffix();

  // Always install a loader so WRITE_LESSON_INSTRUCTION is appended even when
  // buildMemoryPrompt is empty. Use appendSystemPromptOverride (not
  // systemPromptOverride) so the default tool-list prompt stays intact.
  if (memoryPrompt || isolateSkills || writeLessonSuffix) {
    if (piOptions.resourceLoader) {
      throw new Error('buildMemoryPrompt/controlledSkillRoots/write_lesson cannot combine with custom Pi resourceLoader yet');
    }

    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: isolatedAgentDir,
      settingsManager: piOptions.settingsManager,
      // Lock skills to controlled roots only (empty dir → empty <available_skills>).
      noSkills: isolateSkills,
      additionalSkillPaths: isolateSkills ? controlledSkillRoots : undefined,
      // Pi base (tools/skills) is run-stable; student memory already orders
      // static→breakpoint→dynamic so the mutable suffix is last for prefix cache.
      systemPromptOverride: memoryPrompt
        ? (base) => [base, memoryPrompt].filter((part): part is string => Boolean(part)).join('\n\n')
        : undefined,
      appendSystemPromptOverride: (base) => [...base, writeLessonSuffix].filter(Boolean),
    });
    await resourceLoader.reload();
    agentOptions.resourceLoader = resourceLoader;
  }

  const piResult = await createAgentSession(agentOptions);

  const { session } = piResult;
  const { agent } = session;

  // 为自定义 provider 注册 API Key。
  // Pi 的 hasConfiguredAuth 只认识内置 provider 的 env var，
  // 对未知 provider 需通过 modelRuntime.setRuntimeApiKey 注入运行时 API Key。
  if (apiKey && model) {
    await session.modelRuntime.setRuntimeApiKey(model.provider, apiKey);
  }

  applyLlmRequestLimits(agent, llm);

  // ── Wire beforeToolCall (always: write_lesson event buffer) ──

  {
    const originalBeforeToolCall = agent.beforeToolCall;
    agent.beforeToolCall = async (piCtx, signal) => {
      const preCtx = toPreToolCallContext(piCtx);
      recordWriteLessonBeforeToolCall(sessionEvents, {
        toolCallId: preCtx.toolCallId,
        toolName: preCtx.toolName,
      });
      if (hooks.onBeforeToolCall) {
        const studentDecision = await hooks.onBeforeToolCall(preCtx);
        if (studentDecision?.block) {
          return studentDecision;
        }
      }
      return originalBeforeToolCall?.call(agent, piCtx, signal);
    };
  }

  // ── Wire afterToolCall (always: write_lesson event buffer) ──

  {
    const originalAfterToolCall = agent.afterToolCall;
    agent.afterToolCall = async (piCtx, signal) => {
      const originalResult = await originalAfterToolCall?.call(agent, piCtx, signal);
      const postCtx = toPostToolCallContext(piCtx);
      recordWriteLessonAfterToolCall(sessionEvents, {
        toolCallId: postCtx.toolCallId,
        toolName: postCtx.toolName,
        isError: postCtx.isError,
      });
      if (hooks.onAfterToolCall) {
        const decision = await hooks.onAfterToolCall(postCtx);
        if (decision) {
          const piDecision = toAfterToolCallResult(decision);
          return { ...originalResult, ...piDecision };
        }
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

  const originalStreamFn = agent.streamFunction;
  agent.streamFunction = (model, context, options) => {
    const longCache = Boolean(
      (model as { compat?: { supportsLongCacheRetention?: boolean } }).compat
        ?.supportsLongCacheRetention,
    );
    return originalStreamFn(model, context, {
      ...options,
      timeoutMs: options?.timeoutMs ?? limits.timeoutMs,
      maxTokens: options?.maxTokens ?? limits.maxTokens,
      maxRetries: options?.maxRetries ?? limits.maxRetries,
      maxRetryDelayMs: options?.maxRetryDelayMs ?? limits.maxRetryDelayMs,
      apiKey: options?.apiKey ?? limits.apiKey,
      // Prefer 1h prompt cache when provider/model supports it (C-2 TTL).
      cacheRetention: options?.cacheRetention ?? (longCache ? 'long' : undefined),
    });
  };
}
