import { classify } from '../../core/executor/risk-classifier.js';
import type { ConfirmationDecision, ConfirmationProvider } from '../../core/executor/types.js';
import type { PreToolCallContext, PreToolCallDecision } from '../../core/pi-bridge/types.js';

export interface ConfirmationProviderRef {
  current: ConfirmationProvider | null;
}

export interface RiskGuardOptions {
  enabled?: boolean;
  confirmationProviderRef: ConfirmationProviderRef;
}

export interface RiskGuard {
  hook: (ctx: PreToolCallContext) => Promise<PreToolCallDecision | undefined>;
  reset: () => void;
}

const SHELL_TOOL_NAMES = new Set(['bash', 'shell', 'terminal', 'exec_command']);

export function createRiskGuardHook(options: RiskGuardOptions): RiskGuard {
  const enabled = options.enabled ?? true;
  const allowedFingerprints = new Set<string>();

  const hook = async (ctx: PreToolCallContext): Promise<PreToolCallDecision | undefined> => {
    if (!enabled || classify(ctx.toolName, ctx.args) === 'low') {
      return undefined;
    }

    const fingerprint = createRiskFingerprint(ctx.toolName, ctx.args);
    if (allowedFingerprints.has(fingerprint)) {
      return undefined;
    }

    const reason = buildRiskReason(ctx);
    const provider = options.confirmationProviderRef.current;
    if (!provider) {
      return block(reason, '没有可用的交互确认通道，已阻断高风险工具调用。');
    }

    let decision: ConfirmationDecision;
    try {
      decision = await provider.confirm({
        toolName: ctx.toolName,
        input: ctx.args,
        reason,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return block(reason, `确认过程失败，已阻断高风险工具调用：${message}`);
    }

    if (decision === true) {
      return undefined;
    }
    if (decision === 'always') {
      allowedFingerprints.add(fingerprint);
      return undefined;
    }

    return block(reason, '用户拒绝或未确认，已阻断高风险工具调用。');
  };

  return {
    hook,
    reset: () => allowedFingerprints.clear(),
  };
}

export function createRiskFingerprint(toolName: string, args: unknown): string {
  const normalizedToolName = toolName.trim().toLowerCase();
  const command = SHELL_TOOL_NAMES.has(normalizedToolName) ? extractCommand(args) : null;
  if (command) {
    return `${normalizedToolName}:${normalizeCommand(command)}`;
  }
  return `${normalizedToolName}:${stableStringify(args)}`;
}

function block(reason: string, detail: string): PreToolCallDecision {
  return {
    block: true,
    reason: `[RiskGuard] ${detail}\n${reason}`,
  };
}

function buildRiskReason(ctx: PreToolCallContext): string {
  return [
    '检测到高风险工具调用。',
    `工具：${ctx.toolName}`,
    `参数：${summarizeArgs(ctx.args)}`,
  ].join('\n');
}

function summarizeArgs(args: unknown): string {
  const command = extractCommand(args);
  const rendered = command ?? stableStringify(args);
  return rendered.length <= 1_000 ? rendered : `${rendered.slice(0, 1_000)}...`;
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ').toLowerCase();
}

function extractCommand(args: unknown): string | null {
  if (typeof args === 'string') {
    return args.trim() || null;
  }
  if (!isRecord(args)) {
    return null;
  }
  for (const key of ['cmd', 'command', 'script']) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return stringifyValue(value, seen);
}

function stringifyValue(value: unknown, seen: WeakSet<object>): string {
  if (value === undefined) {
    return 'undefined';
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
