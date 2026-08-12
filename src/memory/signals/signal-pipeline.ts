import { drainProtectedEvents } from '../../core/hashline/event-emitter.js';
import type { PostToolCallContext } from '../../core/pi-bridge/types.js';
import type { ProtectedEvalEvent } from '../../evals/types.js';
import { TasksManager } from '../tasks/manager.js';
import type {
  TaskWorkingMemoryRecentError,
  TaskWorkingMemoryRecentSignal,
} from '../tasks/types.js';
import { appendSignal } from './signal-store.js';
import type { Signal, SignalKind } from './types.js';

export interface SignalPipelineOptions {
  memoryDir?: string;
  tasksManager?: TasksManager;
  onProtectedEvents?: (events: ProtectedEvalEvent[]) => void;
  onSignals?: (signals: Signal[]) => void;
}

export function createSignalPipeline(options: SignalPipelineOptions = {}) {
  const tasksManager = options.tasksManager ?? TasksManager.getInstance();

  async function processAfterToolCall(ctx: PostToolCallContext): Promise<void> {
    try {
      const protectedEvents = drainProtectedEvents();
      options.onProtectedEvents?.(protectedEvents);
      const signals = collectSignals(ctx, protectedEvents);

      for (const signal of signals) {
        await appendSignal(signal, options.memoryDir);
      }

      if (signals.length === 0) return;
      options.onSignals?.(signals);

      const activeTask = await tasksManager.getActive();
      if (!activeTask) return;

      const errors = signals
        .filter(isErrorSignal)
        .map(signalToRecentError);
      const signalEntries = signals.map(signalToRecentSignal);

      if (errors.length > 0) {
        await tasksManager.updateWorkingMemory(activeTask.id, { recentErrors: errors });
      }
      if (signalEntries.length > 0) {
        await tasksManager.updateWorkingMemory(activeTask.id, { recentSignals: signalEntries });
      }
    } catch (err) {
      console.warn('[SignalPipeline] failed to process signal:', err instanceof Error ? err.message : String(err));
    }
  }

  return { processAfterToolCall };
}

function collectSignals(
  ctx: PostToolCallContext,
  protectedEvents: ProtectedEvalEvent[],
): Signal[] {
  const signals: Signal[] = [];
  const now = new Date().toISOString();

  if (ctx.isError) {
    signals.push({
      id: makeSignalId('tool_error', now),
      kind: 'tool_error',
      severity: 'medium',
      summary: truncate(ctx.resultText, 200),
      toolName: ctx.toolName,
      toolCallId: ctx.toolCallId,
      pattern: extractErrorPattern(ctx.resultText),
      evidenceRef: ctx.toolCallId,
      createdAt: now,
    });
  }

  for (const event of protectedEvents) {
    const signal = protectedEventToSignal(event);
    if (signal) signals.push(signal);
  }

  return signals;
}

function protectedEventToSignal(event: ProtectedEvalEvent): Signal | null {
  const base = {
    id: makeSignalId(event.type, event.timestamp),
    path: event.path,
    ruleName: event.ruleName,
    provenance: event.provenance,
    evidenceRef: event.evidenceRef,
    createdAt: event.timestamp,
  };

  if (event.source === 'toolguard' && event.blocked) {
    return {
      ...base,
      kind: 'toolguard_block',
      severity: 'medium',
      summary: `ToolGuard blocked: ${event.ruleName ?? event.type}`,
    };
  }

  if (event.source === 'hashline') {
    if (event.type === 'stale_rejection') {
      return {
        ...base,
        kind: 'hashline_rejection',
        severity: 'high',
        summary: `Hashline stale rejection: ${event.path ?? 'unknown'}`,
      };
    }
    if (event.type === 'recovery_success' || event.type === 'recovery_failure') {
      return {
        ...base,
        kind: 'hashline_recovery',
        severity: 'low',
        summary: `Hashline ${event.type}: ${event.path ?? 'unknown'}`,
      };
    }
  }

  if (event.type === 'fileguard_block' || (event.source === 'signal' && event.type === 'fileguard_block')) {
    return {
      ...base,
      kind: 'fileguard_block',
      severity: 'medium',
      summary: `FileGuard blocked: ${event.path ?? 'unknown'}`,
    };
  }

  return null;
}

function isErrorSignal(signal: Signal): boolean {
  return signal.kind === 'tool_error'
    || signal.kind === 'toolguard_block'
    || signal.kind === 'fileguard_block'
    || signal.kind === 'hashline_rejection';
}

function signalToRecentError(signal: Signal): TaskWorkingMemoryRecentError {
  return {
    id: signal.id,
    source: signalKindToErrorSource(signal.kind),
    pattern: signal.pattern ?? signal.summary,
    summary: signal.summary,
    recoveryHint: signal.recoveryHint,
    evidenceRef: signal.evidenceRef,
    createdAt: signal.createdAt,
  };
}

function signalToRecentSignal(signal: Signal): TaskWorkingMemoryRecentSignal {
  return {
    id: signal.id,
    kind: signal.kind,
    summary: signal.summary,
    severity: signal.severity,
    evidenceRef: signal.evidenceRef,
    createdAt: signal.createdAt,
  };
}

function signalKindToErrorSource(kind: SignalKind): TaskWorkingMemoryRecentError['source'] {
  switch (kind) {
    case 'tool_error':
      return 'tool';
    case 'toolguard_block':
      return 'toolguard';
    case 'fileguard_block':
      return 'fileguard';
    case 'hashline_rejection':
      return 'hashline';
    default:
      return 'runtime';
  }
}

function extractErrorPattern(text: string): string {
  return (text.split('\n')[0] ?? '').slice(0, 100);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function makeSignalId(kind: string, timestamp: string): string {
  return `sig_${kind}_${Date.now()}_${hashString(timestamp)}_${Math.random().toString(36).slice(2, 6)}`;
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
