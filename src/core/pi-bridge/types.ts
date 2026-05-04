/**
 * Pi-Bridge 边界类型：把 Pi 的钩子参数/返回值转换为 Student Agent 内部领域类型。
 * 只做类型映射，不承载业务策略。
 */

import type {
  BeforeToolCallContext,
  AfterToolCallContext,
  AfterToolCallResult,
  AgentEvent,
  AgentMessage,
} from '@mariozechner/pi-agent-core';

// ── beforeToolCall 边界 ─────────────────────────────

/** Student Agent 视角的"工具调用前"上下文 */
export interface PreToolCallContext {
  /** 工具名称 */
  toolName: string;
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具参数 */
  args: unknown;
}

/** Student Agent 视角的工具调用前决策 */
export interface PreToolCallDecision {
  /** 阻止工具执行 */
  block?: boolean;
  /** 阻止原因，会作为错误 tool result 返回给模型 */
  reason?: string;
}

/** 从 Pi 的 BeforeToolCallContext 提取 Student Agent 需要的字段 */
export function toPreToolCallContext(piCtx: BeforeToolCallContext): PreToolCallContext {
  return {
    toolName: piCtx.toolCall.name,
    toolCallId: piCtx.toolCall.id,
    args: piCtx.args,
  };
}

// ── afterToolCall 边界 ──────────────────────────────

/** Student Agent 视角的"工具调用后"上下文 */
export interface PostToolCallContext {
  /** 工具名称 */
  toolName: string;
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具参数 */
  args: unknown;
  /** 工具执行是否出错 */
  isError: boolean;
  /** 工具返回的文本内容 */
  resultText: string;
}

/** 从 Pi 的 AfterToolCallContext 提取 Student Agent 需要的字段 */
export function toPostToolCallContext(piCtx: AfterToolCallContext): PostToolCallContext {
  const resultText = piCtx.result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

  return {
    toolName: piCtx.toolCall.name,
    toolCallId: piCtx.toolCall.id,
    args: piCtx.args,
    isError: piCtx.isError,
    resultText,
  };
}

// ── afterToolCall 返回值转换 ────────────────────────

/** Student Agent 失败升级的决策结果 */
export interface EscalationDecision {
  /** 替换 tool result 的文本内容（注入恢复指令或诊断报告） */
  overrideContent?: string;
  /** 是否标记为错误 */
  isError?: boolean;
  /** 是否终止当前回合（Attempt 3 时为 true） */
  terminate?: boolean;
}

/** 将 Student Agent 的失败升级决策转换为 Pi 的 AfterToolCallResult */
export function toAfterToolCallResult(
  decision: EscalationDecision,
): AfterToolCallResult {
  const result: AfterToolCallResult = {};
  if (decision.overrideContent !== undefined) {
    result.content = [{ type: 'text', text: decision.overrideContent }];
  }
  if (decision.isError !== undefined) {
    result.isError = decision.isError;
  }
  if (decision.terminate !== undefined) {
    result.terminate = decision.terminate;
  }
  return result;
}

// ── agent_end 边界 ──────────────────────────────────

/** Student Agent 视角的"会话结束"上下文 */
export interface SessionEndContext {
  /** 本次会话所有消息（用于 ReflectAgent 分析） */
  messages: AgentMessage[];
}

/** 从 Pi 的 agent_end 事件提取会话结束上下文 */
export function toSessionEndContext(
  event: Extract<AgentEvent, { type: 'agent_end' }>,
): SessionEndContext {
  return {
    messages: event.messages,
  };
}
