import type { AgentEvent } from '@mariozechner/pi-agent-core';
import type {
  EvalContextAssemblyTrace,
  EvalContextTokenEffect,
  ProtectedEvalEvent,
  EvalTokenUsage,
  EvalTokenUsageEvent,
} from '../evals/types.js';
import type { CompletionSelfCheckResult } from './completion-self-check.js';

export interface NonInteractiveRunSummary {
  status: 'success' | 'failed';
  exitCode: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  provider?: string;
  model?: string;
  errorMessage?: string;
  turnCount: number;
  tokenUsage: EvalTokenUsage;
  usageEvents: EvalTokenUsageEvent[];
  protectedEvents: ProtectedEvalEvent[];
  guardRuleCounts: Record<string, number>;
  contextAssemblyTraces?: EvalContextAssemblyTrace[];
  contextTokenEffect?: EvalContextTokenEffect;
  workingMemorySnapshot?: import('../memory/tasks/types.js').TaskWorkingMemory;
  selfCheck: CompletionSelfCheckResult;
}

export class NonInteractiveUsageCollector {
  private readonly tokenUsage: EvalTokenUsage = emptyTokenUsage();
  private readonly events: EvalTokenUsageEvent[] = [];

  handleEvent(event: AgentEvent): void {
    if (event.type !== 'message_end') return;
    const record = event as unknown as Record<string, unknown>;
    if (!isRecord(record.message)) return;
    const message = record.message;
    if (message.role !== 'assistant' || !isRecord(message.usage)) return;
    const usage = usageFromRaw(message.usage);
    addUsage(this.tokenUsage, message.usage);
    this.events.push({
      index: this.events.length + 1,
      usage,
    });
  }

  usage(): EvalTokenUsage {
    return cloneTokenUsage(this.tokenUsage);
  }

  usageEvents(): EvalTokenUsageEvent[] {
    return this.events.map((event) => ({
      index: event.index,
      usage: cloneTokenUsage(event.usage),
    }));
  }
}

export function createNonInteractiveSummary(options: {
  status: 'success' | 'failed';
  exitCode: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  provider?: string;
  model?: string;
  errorMessage?: string;
  usage: EvalTokenUsage;
  usageEvents: EvalTokenUsageEvent[];
  contextAssemblyTraces?: EvalContextAssemblyTrace[];
  contextTokenEffect?: EvalContextTokenEffect;
  workingMemorySnapshot?: import('../memory/tasks/types.js').TaskWorkingMemory;
  protectedEvents?: ProtectedEvalEvent[];
  selfCheck: CompletionSelfCheckResult;
}): NonInteractiveRunSummary {
  const protectedEvents = cloneJson(options.protectedEvents ?? []);
  return {
    status: options.status,
    exitCode: options.exitCode,
    startedAt: options.startedAt,
    endedAt: options.endedAt,
    durationMs: options.durationMs,
    provider: options.provider,
    model: options.model,
    errorMessage: options.errorMessage,
    turnCount: options.usageEvents.length,
    tokenUsage: cloneTokenUsage(options.usage),
    usageEvents: options.usageEvents.map((event) => ({
      index: event.index,
      usage: cloneTokenUsage(event.usage),
    })),
    protectedEvents,
    guardRuleCounts: countGuardRules(protectedEvents),
    contextAssemblyTraces: cloneJson(options.contextAssemblyTraces),
    contextTokenEffect: cloneJson(options.contextTokenEffect),
    workingMemorySnapshot: cloneJson(options.workingMemorySnapshot),
    selfCheck: cloneJson(options.selfCheck),
  };
}

function countGuardRules(events: ProtectedEvalEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    if (event.source !== 'toolguard' || !event.blocked || !event.ruleName) continue;
    counts[event.ruleName] = (counts[event.ruleName] ?? 0) + 1;
  }
  return counts;
}

export function emptyTokenUsage(): EvalTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUsd: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function usageFromRaw(raw: Record<string, unknown>): EvalTokenUsage {
  const usage = emptyTokenUsage();
  addUsage(usage, raw);
  return usage;
}

function addUsage(target: EvalTokenUsage, raw: Record<string, unknown>): void {
  target.inputTokens += numberValue(raw.input);
  target.outputTokens += numberValue(raw.output);
  target.cacheReadTokens += numberValue(raw.cacheRead);
  target.cacheWriteTokens += numberValue(raw.cacheWrite);
  target.totalTokens += numberValue(raw.totalTokens);

  const cost = isRecord(raw.cost) ? raw.cost : {};
  target.costUsd.input = roundCost(target.costUsd.input + numberValue(cost.input));
  target.costUsd.output = roundCost(target.costUsd.output + numberValue(cost.output));
  target.costUsd.cacheRead = roundCost(target.costUsd.cacheRead + numberValue(cost.cacheRead));
  target.costUsd.cacheWrite = roundCost(target.costUsd.cacheWrite + numberValue(cost.cacheWrite));
  target.costUsd.total = roundCost(target.costUsd.total + numberValue(cost.total));
}

function cloneTokenUsage(usage: EvalTokenUsage): EvalTokenUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    totalTokens: usage.totalTokens,
    costUsd: { ...usage.costUsd },
  };
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function roundCost(value: number): number {
  return Number(value.toFixed(8));
}

function cloneJson<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
