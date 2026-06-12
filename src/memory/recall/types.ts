import type { SignalKind } from '../signals/types.js';
import type { TaskLedgerInput } from '../tasks/task-ledger.js';
import type { TaskWorkingMemory } from '../tasks/types.js';
import type { ScoringContext } from './scoring.js';

export type RecallableMemoryKind =
  | 'knack'
  | 'preference'
  | 'doc_finding'
  | 'artifact_ref'
  | 'run_archive_ref';

export interface RecallTrigger {
  signalKinds?: SignalKind[];
  paths?: string[];
  toolNames?: string[];
  ruleNames?: string[];
  keywords?: string[];
  scopes?: string[];
  tags?: string[];
}

export interface RecallMetadata {
  trigger: RecallTrigger;
  applicableWhen: string[];
  doNotApplyWhen: string[];
  tags?: string[];
  sourceRefs?: string[];
  updatedAt?: string;
}

export interface DocFinding {
  id: string;
  title: string;
  summary: string;
  source: string;
  recall: RecallMetadata;
  evidenceRefs?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RecallQueryMetadataFilter {
  kinds?: RecallableMemoryKind[];
  statuses?: string[];
  scopes?: string[];
  tags?: string[];
  sources?: string[];
}

export interface RecallQuery {
  text?: string;
  trigger?: RecallTrigger;
  metadata?: RecallQueryMetadataFilter;
  limit?: number;
  includeVectorSearch?: false;
}

export interface RecallRouterInput {
  taskId: string;
  currentTaskId?: string;
  currentRunId?: string;
  excludeRunIds?: string[];
  excludeTaskIds?: string[];
  tier?: L1Tier;
  phase: string;
  goal: string;
  currentStep: string;
  nextTool?: string;
  currentFile?: string;
  recentErrors: Array<{ source: string; pattern?: string }>;
  recentSignals: Array<{ kind: SignalKind; summary: string }>;
  taskLedger?: TaskLedgerInput;
  recentRawTurns: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface RecallScore {
  dimensions: {
    trigger: number;
    keyword: number;
    recency: number;
    relevance: number;
    metadata: number;
    evidence: number;
  };
  total: number;
  /**
   * @deprecated Use dimensions.metadata instead.
   */
  metadata: number;
  /**
   * @deprecated Use dimensions.trigger instead.
   */
  trigger: number;
  /**
   * @deprecated Use dimensions.keyword instead.
   */
  keyword: number;
  /**
   * @deprecated Vector scoring is not used in Recall Scoring v2.
   */
  vector: number;
}

export interface RecallableMemoryItem {
  id: string;
  kind: RecallableMemoryKind;
  subtype?: string;
  summary: string;
  recall: RecallMetadata;
  metadata: {
    status?: string;
    scope?: string;
    source?: string;
    tags?: string[];
    taskId?: string;
    runId?: string;
    keyFiles?: Array<{ path: string; role?: string }>;
    errorPatterns?: string[];
    createdAt?: string;
    updatedAt?: string;
    evidenceRefs?: string[];
  };
  payload: unknown;
}

export interface MemoryRecallResult {
  item: RecallableMemoryItem;
  score: RecallScore;
}

export interface RecalledItem {
  id: string;
  kind: RecallableMemoryKind;
  subtype?: string;
  summary: string;
  reason: string;
  score: RecallScore;
}

export interface RecallBundle {
  knacks: RecalledItem[];
  preferences: RecalledItem[];
  docFindings: RecalledItem[];
  historicalTaskSnapshots: RecalledItem[];
  artifactRefs: RecalledItem[];
  runArchiveRefs: RecalledItem[];
  diagnostics: {
    queryText: string;
    triggerUsed: RecallTrigger;
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
  };
}

export interface ContextBuilderInput {
  workingMemory: TaskWorkingMemory;
  recallBundle: RecallBundle;
  taskLedger?: RecallRouterInput['taskLedger'];
  maxTokenBudget?: number;
  tier?: L1Tier;
  runMode?: ContextRunMode;
  piSchemaRenderMode?: PiSchemaRenderMode;
}

export interface ContextSection {
  name: string;
  priority: number;
  content: string;
  estimatedTokens: number;
}

export interface BuiltContext {
  tier: L1Tier;
  sections: ContextSection[];
  totalEstimatedTokens: number;
  truncated: string[];
  runMode: ContextRunMode;
  piSchemaRenderMode: PiSchemaRenderMode;
  evalAutonomyEnabled: boolean;
  fullPiSchemaRendered: boolean;
  anthropicExecutionOverrideEnabled: boolean;
}

export type L1Tier = 'minimal' | 'standard' | 'heavy';
export type ContextRunMode = 'interactive' | 'eval' | 'yolo';
export type PiSchemaRenderMode = 'none' | 'summary' | 'full';

export interface L1SectionBudget {
  systemRules: number;
  toolRules: number;
  taskSpec: number;
  hardConstraints: number;
  taskLedger: number;
  workingMemory: number;
  recentErrors: number;
  recentSignals: number;
  knacks: number;
  preferences: number;
  docFindings: number;
  artifactRefs: number;
  runArchiveRefs: number;
  historicalTaskSnapshots?: number;
  recentRawTurns: number;
  currentUserMessageReserve: number;
}

export interface L1TierBudget {
  tier: L1Tier;
  totalBudget: number;
  sectionBudgets: L1SectionBudget;
}

export interface L1TierInput {
  hasActiveTask: boolean;
  isSimpleConfirmation: boolean;
  hasPendingToolResult: boolean;
  hasRecentError: boolean;
  recentErrorCount: number;
  hasOpenQuestion: boolean;
  hasLostnessTrigger: boolean;
  hasUserCorrection: boolean;
  hasRejectedAssumptionRisk: boolean;
  isRecoveryMode: boolean;
  nextActionIsWrite: boolean;
  isEvalFailureAnalysis?: boolean;
  isHarnessModification?: boolean;
  recentToolThrashingCount?: number;
}

export interface RecallLimits {
  knacks: number;
  docFindings: number;
  preferences: number;
  artifactRefs: number;
  runArchiveRefs: number;
}

export interface RecallIndexEntry {
  id: string;
  kind: RecallableMemoryKind;
  summary: string;
  sourcePath: string;
  recall: RecallMetadata;
  metadata: RecallableMemoryItem['metadata'];
}

export interface RecallIndex {
  version: 1;
  updatedAt: string;
  entries: RecallIndexEntry[];
}

export interface MemoryStore {
  refreshIndex(): Promise<RecallIndex>;
  search(query: RecallQuery, context?: ScoringContext): Promise<MemoryRecallResult[]>;
  loadTaskSnapshots(options?: {
    limit?: number;
    excludeRunIds?: string[];
    excludeTaskIds?: string[];
  }): Promise<RecallableMemoryItem[]>;
}
