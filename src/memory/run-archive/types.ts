export type RunEventKind =
  | 'tool_call'
  | 'tool_error'
  | 'toolguard_block'
  | 'hashline_rejection'
  | 'hashline_recovery'
  | 'user_correction'
  | 'lostness_hard'
  | 'lostness_soft'
  | 'state_transition';

export interface RunEvent {
  timestamp: string;
  kind: RunEventKind;
  summary: string;
  toolName?: string;
  path?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkingMemorySnapshot {
  taskId: string;
  runId: string;
  goal: string;
  phase: string;
  finalStep: string;
  completedTodos: {
    id: string;
    label: string;
    evidenceRefs?: string[];
  }[];
  completedTodoCount: number;
  readFiles: string[];
  writtenFiles: string[];
  keyFiles: {
    path: string;
    role: 'read' | 'written' | 'read_and_written';
  }[];
  keySignalSummaries: string[];
  errorPatterns: string[];
  evidenceRefs: string[];
  createdAt: string;
}

export interface TaskOutcome {
  taskId: string;
  runId: string;
  status: 'success' | 'partial' | 'failed' | 'cancelled';
  userAccepted?: boolean;
  userCorrectionCount: number;
  toolErrorCount: number;
  hashlineRejectionCount: number;
  hashlineRecoveryCount: number;
  repeatedToolCallCount: number;
  lostnessTriggerCount: number;
  finalSummary: string;
  evidenceRefs: string[];
  wmSnapshot?: WorkingMemorySnapshot;
  createdAt: string;
}
