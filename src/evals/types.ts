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

export interface EvalTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
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
  tokenUsage: EvalTokenUsage;
  taskState?: EvalTaskStateTrace;
  /** Protected eval events collected during the run (hashline, signal, toolguard). */
  protectedEvents?: ProtectedEvalEvent[];
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

/**
 * A protected eval event records safety-relevant actions taken by the
 * Student Agent infrastructure (hashline, signal pipeline, toolguard).
 * These events are written by internal logic only — never exposed to the
 * agent's prompt — and are collected into the eval trace for offline audit.
 */
export interface ProtectedEvalEvent {
  /** Which subsystem produced this event. */
  source: "hashline" | "signal" | "toolguard";
  /** Discriminated event type within the source (e.g. 'stale_rejection', 'recovery_success'). */
  type: string;
  /** File path the event relates to, if applicable. */
  path?: string;
  /** Rule name that triggered the event (e.g. 'empty_bash' for toolguard). */
  ruleName?: string;
  /** Opaque provenance payload — source-specific metadata about why the event fired. */
  provenance?: unknown;
  /** Evidence reference — a stable key (hash, trace ID, etc.) linking to the underlying data. */
  evidenceRef?: string;
  /** Whether the action was blocked (prevented from completing). */
  blocked?: boolean;
  /** Whether a shell process was actually spawned (for bash-related events). */
  shellSpawned?: boolean;
  /** ISO-8601 timestamp automatically added by emitProtectedEvent. */
  timestamp: string;
}
