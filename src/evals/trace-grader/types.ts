export type TraceGradeStatus = 'pass' | 'fail' | 'warning';

export interface TraceGraderConfig {
  requireToolCall?: boolean;
  requireFileChange?: boolean;
  requireValidationCommand?: boolean;

  minToolCalls?: number;
  minFileWrites?: number;

  validationCommandPatterns?: string[];
  writeToolNames?: string[];
  readToolNames?: string[];

  allowWarnings?: boolean;
}

export interface TraceGradeCheck {
  id: string;
  status: TraceGradeStatus;
  message: string;
  evidence?: string[];
}

export interface TraceGradeSummary {
  toolCallCount: number;
  readToolCallCount: number;
  writeToolCallCount: number;
  validationCommandCount: number;
  touchedFiles: string[];
  hasFileChangeSignal: boolean;
  hasFinalSuccessClaim: boolean;
  askedUserBeforeFirstToolCall: boolean;
  stoppedAfterPlanWithoutAction: boolean;
}

export interface TraceGradeResult {
  status: TraceGradeStatus;
  summary: TraceGradeSummary;
  checks: TraceGradeCheck[];
}
