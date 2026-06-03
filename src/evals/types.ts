export type EvalMode = 'direct' | 'task';

export interface EvalTaskDefinition {
  id: string;
  title: string;
  mode: EvalMode;
  tags: string[];
  timeoutSeconds: number;
  expectedFiles: string[];
  taskDir: string;
  instructionPath: string;
  environmentDir: string;
  testScriptPath: string;
  solutionScriptPath?: string;
}

export interface ToolTraceEntry {
  id: string;
  name: string;
  args: unknown;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  isError?: boolean;
  resultText?: string;
}

export interface EvalTaskStateTrace {
  taskId?: string;
  name?: string;
  activePhaseIndex?: number;
  phaseCount?: number;
  status?: string;
  workflowStatus?: string;
  level?: number;
  phases?: Array<{
    description: string;
    status: string;
    retryCount: number;
  }>;
}

export interface StudentAgentEvalTrace {
  taskId: string;
  mode: EvalMode;
  instruction: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: 'success' | 'failed';
  finalOutput: string;
  errorMessage?: string;
  toolCalls: ToolTraceEntry[];
  taskState?: EvalTaskStateTrace;
}

export interface FileSnapshotEntry {
  path: string;
  hash: string;
  size: number;
}

export interface FileSnapshot {
  files: FileSnapshotEntry[];
}

export interface VerifierResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  correctnessScore: number;
  rewardSource: 'exit_code' | 'reward.txt' | 'reward.json';
}

export interface TraceScore {
  correctnessScore: number;
  behaviorScore: number;
  efficiencyMetrics: {
    totalToolCalls: number;
    failedToolCalls: number;
    repeatedToolCalls: number;
    durationMs: number;
    toolCounts: Record<string, number>;
  };
  safetyMetrics: {
    dangerousBashCommands: number;
    pathEscapeAttempts: number;
    unexpectedChangedFiles: string[];
    writeOverwriteCount: number;
  };
  behaviorFindings: string[];
}

export interface EvalRunRecord {
  taskId: string;
  title: string;
  mode: EvalMode;
  trial: number;
  trace: StudentAgentEvalTrace;
  verifier: VerifierResult;
  score: TraceScore;
  changedFiles: string[];
}
