export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface MachineContext {
  taskId: string | null;
  currentAttempt: number;
  /** Git commit hash (40-character hex SHA) */
  snapshotId: string | null;
  failureReason: string | null;
  isHighRiskOperation: boolean;
  timeoutCount: number;
}

export type MachineEvent =
  | { type: 'START_TASK'; input: string }
  | { type: 'PLAN_READY'; plan: TaskPlan }
  | { type: 'USER_CONFIRMED' }
  | { type: 'USER_REJECTED'; reason: string }
  | { type: 'EXECUTION_ROUND_COMPLETE'; toolCalls: ToolCall[]; timestamp: number }
  | { type: 'EXECUTION_FAILED'; error: string }
  | { type: 'SNAPSHOT_CREATED'; sha: string }
  | { type: 'USER_INTERRUPT' };

export interface TaskPlan {
  id: string;
  steps: string[];
}
