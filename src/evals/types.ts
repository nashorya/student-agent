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
  /** local_estimate = recomputed from tokens×rates; gateway = billed amount when known. */
  costAuthority?: 'local_estimate' | 'gateway';
  /** Provider completion id (e.g. ZenMux generation id) when present. */
  generationId?: string;
}

export interface EvalTokenUsageEvent {
  index: number;
  usage: EvalTokenUsage;
}

export interface EvalPiSchemaToolTrace {
  name: string;
  schemaChars: number;
  approxSchemaTokens: number;
}

export interface EvalPiSchemaTrace {
  toolCount: number;
  toolNames: string[];
  schemaChars: number;
  approxSchemaTokens: number;
  llmRequestCount: number;
  estimatedSchemaInjectionCount: number;
  estimatedTotalSchemaTokens: number;
  perTool: EvalPiSchemaToolTrace[];
  note: string;
}

/** Controlled skill isolation manifest for evals (paths relative or absolute under fixtures). */
export interface EvalSkillManifest {
  roots: string[];
  entries: string[];
}

export type EvalContextLayer = 'L0' | 'L1' | 'L2' | 'L3';

export interface EvalContextBreakdownSection {
  layer: EvalContextLayer;
  id: string;
  title: string;
  chars: number;
  estimatedTokens: number;
}

export interface EvalContextLayerSummary {
  layer: EvalContextLayer;
  chars: number;
  estimatedTokens: number;
  sectionCount: number;
  sectionIds: string[];
}

export interface EvalContextAssemblyTrace {
  pipeline: 'legacy' | 'new';
  generatedAt: string;
  runMode?: string;
  piSchemaRenderMode?: string;
  tier?: L1TierString;
  tierReason?: string;
  truncated: string[];
  renderedPromptChars: number;
  renderedPromptEstimatedTokens: number;
  sections: EvalContextBreakdownSection[];
  layers: Record<EvalContextLayer, EvalContextLayerSummary>;
  recall?: EvalRecallTrace;
}

export interface EvalRecallTrace {
  items: Array<{
    id: string;
    kind: string;
    subtype?: string;
    summary: string;
    reason: string;
    score: number;
    ranking?: {
      repoMatch: boolean;
      similarity: number;
      similaritySource: 'embedding' | 'lexical';
      reuseCount: number;
      confidence: number;
      antiRepeat: number;
      eligible: boolean;
      rankReason: string;
    };
  }>;
  diagnostics: {
    queryText: string;
    totalCandidates: number;
    dropped: Array<{ id: string; reason: string }>;
    penalties: Array<{
      id: string;
      reason: string;
      rejectionId?: string;
      assumption?: string;
      severity?: 'hard' | 'soft';
      multiplier?: number;
    }>;
    candidatePool?: {
      scanned: number;
      eligibleKnacks: number;
      truncated: number;
      limit: number;
    };
  };
}

export interface EvalContextTokenEffect {
  observedInputTokens: number;
  observedTotalTokens: number;
  llmRequestCount: number;
  contextPromptEstimatedTokens: number;
  repeatedContextPromptEstimatedTokens: number;
  toolSchemaEstimatedTokens: number;
  instructionEstimatedTokens: number;
  layers: Record<EvalContextLayer, EvalContextLayerSummary>;
  classifiedInputTokens: number;
  unclassifiedInputTokens: number;
  estimatedClassifiedShareOfObservedInput: number;
  note: string;
}

export interface EvalModelTrace {
  id: string;
  provider: string;
  api: string;
  baseUrl: string;
  pricingUsdPerMillionTokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  thinking?: {
    initialLevel: string;
    supportsThinking: boolean;
    availableLevels: string[];
    changes: Array<{ at: string; level: string }>;
  };
}

export interface EvalProviderRequestAuditEntry {
  index: number;
  at: string;
  url: string;
  model: string;
  thinking: unknown;
  temperature: unknown;
  doSample: unknown;
  compliant: boolean;
  error?: string;
  response?: {
    httpStatus: number;
    inspected: boolean;
    hasReasoningContent: boolean;
    reasoningChars: number;
    promptTokens?: number;
    cachedPromptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
    error?: string;
  };
}

export interface EvalProviderUsageTimelineEntry {
  seq: number;
  ts: string;
  promptTokens: number | null;
  cachedPromptTokens: number | null;
  completionTokens: number | null;
}

type L1TierString = 'minimal' | 'standard' | 'heavy';

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

export interface EvalFeatureManifest {
  arm: string;
  piBuiltInCompaction: boolean;
  contextRuntime: boolean;
  memorySystemPrefix: boolean;
  taskLedgerModelInjection: boolean;
  recallModelInjection: boolean;
  checkpointInjection: boolean;
  jspaceInjection: boolean;
  observed?: {
    contextAssemblyTraceCount: number;
    modelMemoryPromptInjected: boolean;
  };
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
  turnCount?: number;
  toolCalls: ToolTraceEntry[];
  tokenUsage: EvalTokenUsage;
  /** Verbatim provider usage payload when the harness exposes one. */
  rawUsage?: Record<string, unknown>;
  usageEvents?: EvalTokenUsageEvent[];
  piSchemaTrace?: EvalPiSchemaTrace;
  contextAssemblyTraces?: EvalContextAssemblyTrace[];
  recallAudit?: import('../memory/recall/citation.js').RecallCitationAudit;
  contextTokenEffect?: EvalContextTokenEffect;
  model?: EvalModelTrace;
  workingMemorySnapshot?: import('../memory/tasks/types.js').TaskWorkingMemory;
  taskState?: EvalTaskStateTrace;
  featureManifest?: EvalFeatureManifest;
  compactionEvents?: import('./forced-compaction-controller.js').CompactionProbeEvent[];
  /** Pi-generated summary text keyed by forced compaction boundary. */
  compactionSummaries?: Record<string, string>;
  /** Sanitized final provider request fields captured by the eval-only fetch policy. */
  providerRequestAudit?: EvalProviderRequestAuditEntry[];
  /** Response-side provider usage appended to the protected per-run JSONL artifact. */
  providerUsageTimeline?: EvalProviderUsageTimelineEntry[];
  /** First complete provider request body after each forced compaction. */
  postCompactionPrompts?: Record<string, string>;
  /** Protected eval events collected during the run (hashline, signal, toolguard). */
  protectedEvents?: ProtectedEvalEvent[];
  /** Protected ToolGuard events grouped by rule name. */
  guardRuleCounts?: Record<string, number>;
  /** Failure-escalation ladder triggers; the experiment's count source. */
  failureEscalationEvents?: import('../extension/hooks/failure-escalation.js').FailureEscalationEvent[];
  /** Count of proactive context7_query tool executes during the run (0 if unused). */
  ctx7Calls?: number;
  /** Count of context7_query executes that degraded to "no docs" (0 if unused). */
  ctx7Failures?: number;
  /** Active run-archive identity when eval learning lifecycle is enabled. */
  learningRun?: {
    taskId: string;
    runId: string;
  };
  /** Controlled skill roots loaded for this eval (should not include home paths). */
  skillManifest?: EvalSkillManifest;
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
  /** Optional named verifier checks for structure-level paired comparisons. */
  perCheck?: Record<string, boolean>;
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
  modifiedFiles: Record<string, string>;
  recallAttribution?: import('./recall-credit-reconciler.js').RecallAttributionResult;
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
