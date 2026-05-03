export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ErrorCategory =
  | 'environment'
  | 'tool'
  | 'model'
  | 'user_input'
  | 'state_conflict';

export type RestoreReason = 'timeout' | 'before_attempt_1' | null;

export interface AttemptRecord {
  index: 1 | 2 | 3;
  strategy: string;
  result: 'success' | 'failed' | 'skipped';
  reason?: string;
}

/** Cap retained attempt records — context must stay lightweight. */
export const ATTEMPTS_MAX = 5;
/** Cap retained raw-error / stack length stored in context. */
export const RAW_ERROR_MAX = 500;

export interface MachineContext {
  taskId: string | null;
  taskDescription: string | null;
  currentAttempt: number;
  /** Opaque SnapshotManager id. */
  snapshotId: string | null;
  restoreReason: RestoreReason;
  failureReason: string | null;
  isHighRiskOperation: boolean;
  timeoutCount: number;

  errorCategory: ErrorCategory | null;
  errorSubtype: string | null;
  attempts: AttemptRecord[];
  lastStrategy: string | null;
  searchIntent: string | null;
}

export type MachineEvent =
  | { type: 'START_TASK'; input: string }
  | { type: 'PLAN_READY'; plan: TaskPlan }
  | { type: 'USER_CONFIRMED' }
  | { type: 'USER_REJECTED'; reason: string }
  | { type: 'EXECUTION_ROUND_COMPLETE'; toolCalls: ToolCall[]; timestamp: number }
  | { type: 'EXECUTION_FAILED'; error: string; cause?: unknown; toolName?: string }
  | { type: 'SNAPSHOT_CREATED'; sha: string }
  | { type: 'USER_INTERRUPT' }
  | { type: 'ATTEMPT_RETRY_SUCCESS' }
  | { type: 'ATTEMPT_RETRY_FAILED'; reason: string }
  | { type: 'SEARCH_INTENT_EXTRACTED'; intent: string | null }
  | { type: 'STUB_SEARCH_RETURNED'; hadResults: boolean }
  | { type: 'DIAGNOSTIC_EMITTED' };

export interface TaskPlan {
  id: string;
  steps: string[];
}

/** Truncate a string to RAW_ERROR_MAX chars; appends ellipsis when cut. */
export function truncateRawError(s: string, max: number = RAW_ERROR_MAX): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

/** Append an attempt record while keeping at most ATTEMPTS_MAX recent entries. */
export function pushAttempt(
  prev: AttemptRecord[],
  next: AttemptRecord,
  max: number = ATTEMPTS_MAX,
): AttemptRecord[] {
  const merged = [...prev, next];
  return merged.length <= max ? merged : merged.slice(merged.length - max);
}
