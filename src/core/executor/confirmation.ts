import type { ConfirmationDecision, ConfirmationProvider } from './types.js';
import { logger } from '../../tui/logger.js';

export class AlwaysAllowProvider implements ConfirmationProvider {
  async confirm(_op: { toolName: string; input: unknown; reason: string }): Promise<boolean> {
    return true;
  }
}

export class LogAndDenyProvider implements ConfirmationProvider {
  async confirm(op: { toolName: string; input: unknown; reason: string }): Promise<boolean> {
    logger.warn(`[executor] high-risk op blocked: ${op.toolName} — ${op.reason}`);
    return false;
  }
}

export interface PromptConfirmationProviderOptions {
  prompt: (question: string) => Promise<string>;
  isInteractive: () => boolean;
}

export class PromptConfirmationProvider implements ConfirmationProvider {
  constructor(private readonly options: PromptConfirmationProviderOptions) {}

  async confirm(op: { toolName: string; input: unknown; reason: string }): Promise<ConfirmationDecision> {
    if (!this.options.isInteractive()) {
      return false;
    }

    const answer = await this.options.prompt(formatConfirmationQuestion(op));
    return parseConfirmationAnswer(answer);
  }
}

export function parseConfirmationAnswer(answer: string): ConfirmationDecision {
  const normalized = answer.trim().toLowerCase();
  if (['y', 'yes', '确认', 'allow', 'ok'].includes(normalized)) {
    return true;
  }
  if (['a', 'always', '本会话', 'session'].includes(normalized)) {
    return 'always';
  }
  return false;
}

function formatConfirmationQuestion(op: { toolName: string; input: unknown; reason: string }): string {
  return [
    '高风险工具调用需要确认',
    `工具：${op.toolName}`,
    `原因：${op.reason}`,
    `参数：${summarizeInput(op.input)}`,
    '输入 y/yes/确认 放行一次；a/always/本会话 本会话放行同类操作；其他或回车阻断。',
    '> ',
  ].join('\n');
}

function summarizeInput(input: unknown): string {
  const rendered = typeof input === 'string' ? input : stableStringify(input);
  return rendered.length <= 1_000 ? rendered : `${rendered.slice(0, 1_000)}...`;
}

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return stringifyValue(value, seen);
}

function stringifyValue(value: unknown, seen: WeakSet<object>): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? String(value);
  }
  if (seen.has(value)) {
    return '"[Circular]"';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyValue(item, seen)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stringifyValue(record[key], seen)}`);
  return `{${entries.join(',')}}`;
}
