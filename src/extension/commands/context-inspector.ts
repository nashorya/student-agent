import { ContextBuilder } from '../../memory/recall/context-builder.js';
import { JsonlMemoryStore } from '../../memory/recall/jsonl-memory-store.js';
import { RecallRouter } from '../../memory/recall/recall-router.js';
import { RECALL_LIMITS, selectL1Tier, TIER_BUDGETS } from '../../memory/recall/tier-selector.js';
import { TaskLedgerManager } from '../../memory/tasks/task-ledger-manager.js';
import { TasksManager } from '../../memory/tasks/manager.js';
import type {
  L1Tier,
  L1TierInput,
  RecallBundle,
  RecallRouterInput,
  RecalledItem,
} from '../../memory/recall/types.js';
import type { SignalKind } from '../../memory/signals/types.js';
import type { TaskLedgerInput } from '../../memory/tasks/task-ledger.js';
import type { TaskWorkingMemory } from '../../memory/tasks/types.js';

export interface ContextInspectorResult {
  tier: L1Tier;
  tierReason: string;
  budget: number;

  workingMemory: {
    taskId: string | null;
    phase: string | null;
    goal: string | null;
    currentStep: string | null;
    recentErrorCount: number;
    recentSignalCount: number;
  };

  ledger: {
    factCount: number;
    confirmedCount: number;
    tentativeCount: number;
    rejectionCount: number;
    hardRejectionCount: number;
    softRejectionCount: number;
    openQuestionCount: number;
  };

  recall: {
    strategyGenes: { count: number; limit: number };
    preferences: { count: number; limit: number };
    docFindings: { count: number; limit: number };
    historicalSnapshots: { count: number; limit: number };
    artifactRefs: { count: number; limit: number };
  };

  topItem: {
    id: string;
    total: number;
    dimensions: {
      trigger: number;
      keyword: number;
      recency: number;
      relevance: number;
      metadata: number;
      evidence: number;
    };
    ranking?: NonNullable<RecalledItem['ranking']>;
  } | null;

  diagnostics: {
    queryText: string;
    triggerSummary: string;
    totalCandidates: number;
    droppedCount: number;
    estimatedTokens: number;
    truncatedSections: string[];
    piSchemaRenderMode: string;
    fullPiSchemaRendered: boolean;
    evalAutonomyRuleEnabled: boolean;
    anthropicExecutionOverrideEnabled: boolean;
  };
}

const QUERY_TEXT_LIMIT = 160;
const SIGNAL_KINDS = new Set<SignalKind>([
  'tool_error',
  'toolguard_block',
  'fileguard_block',
  'hashline_rejection',
  'hashline_recovery',
  'user_correction',
  'turn_intake_degraded',
  'lostness_hard',
  'lostness_soft',
]);

export async function inspectContext(memoryDir: string): Promise<ContextInspectorResult> {
  const task = await TasksManager.getInstance(memoryDir).getActive();
  if (!task) return emptyInspection();

  const workingMemory = task.working_memory;
  const tierDecision = selectL1Tier(buildL1TierInput(workingMemory));
  const taskLedger = await new TaskLedgerManager(memoryDir, task.id).toLedgerInput();
  const recallInput = makeRecallInput(task.id, workingMemory, taskLedger, tierDecision.tier);
  const recallBundle = await new RecallRouter(new JsonlMemoryStore({ memoryDir, readOnly: true })).recall(recallInput);
  const limitedBundle = applyRecallLimits(recallBundle, tierDecision.tier);
  const built = new ContextBuilder().build({
    workingMemory,
    recallBundle: limitedBundle,
    taskLedger,
    tier: tierDecision.tier,
  });

  return {
    tier: tierDecision.tier,
    tierReason: tierDecision.reason,
    budget: TIER_BUDGETS[tierDecision.tier].totalBudget,
    workingMemory: {
      taskId: task.id,
      phase: workingMemory.phase,
      goal: workingMemory.goal,
      currentStep: workingMemory.currentStep,
      recentErrorCount: workingMemory.recentErrors.length,
      recentSignalCount: workingMemory.recentSignals.length,
    },
    ledger: summarizeLedger(taskLedger),
    recall: summarizeRecall(limitedBundle, tierDecision.tier),
    topItem: findTopItem(limitedBundle),
    diagnostics: {
      queryText: truncate(recallBundle.diagnostics.queryText, QUERY_TEXT_LIMIT),
      triggerSummary: summarizeTrigger(recallBundle.diagnostics.triggerUsed),
      totalCandidates: recallBundle.diagnostics.totalCandidates,
      droppedCount: recallBundle.diagnostics.dropped.length,
      estimatedTokens: built.totalEstimatedTokens,
      truncatedSections: built.truncated,
      piSchemaRenderMode: built.piSchemaRenderMode,
      fullPiSchemaRendered: built.fullPiSchemaRendered,
      evalAutonomyRuleEnabled: built.evalAutonomyEnabled,
      anthropicExecutionOverrideEnabled: built.anthropicExecutionOverrideEnabled,
    },
  };
}

export function formatContextInspection(result: ContextInspectorResult): string {
  return [
    '=== Context Inspector ===',
    '',
    `[L1 Tier] ${result.tier} (reason: ${result.tierReason})`,
    `[L1 Budget] ${result.budget} tokens total`,
    '',
    '[L2 Working Memory]',
    `  Task: ${display(result.workingMemory.taskId)}`,
    `  Phase: ${display(result.workingMemory.phase)}`,
    `  Goal: ${display(result.workingMemory.goal)}`,
    `  Current Step: ${display(result.workingMemory.currentStep)}`,
    `  Recent Errors: ${result.workingMemory.recentErrorCount}`,
    `  Recent Signals: ${result.workingMemory.recentSignalCount}`,
    '',
    '[L2 Task Ledger]',
    `  Facts: ${result.ledger.factCount} (${result.ledger.confirmedCount} confirmed, ${result.ledger.tentativeCount} tentative)`,
    `  Rejections: ${result.ledger.rejectionCount} active (${result.ledger.hardRejectionCount} hard, ${result.ledger.softRejectionCount} soft)`,
    `  Open Questions: ${result.ledger.openQuestionCount}`,
    '',
    '[L3 Recall Results]',
    `  Strategy Genes: ${result.recall.strategyGenes.count}/${result.recall.strategyGenes.limit}`,
    `  Preferences: ${result.recall.preferences.count}/${result.recall.preferences.limit}`,
    `  Doc Findings: ${result.recall.docFindings.count}/${result.recall.docFindings.limit}`,
    `  Historical Snapshots: ${result.recall.historicalSnapshots.count}/${result.recall.historicalSnapshots.limit}`,
    `  Artifact Refs: ${result.recall.artifactRefs.count}/${result.recall.artifactRefs.limit}`,
    '',
    '[L3 Scoring]',
    `  ${formatTopItem(result.topItem)}`,
    '',
    '[Diagnostics]',
    `  Query text: "${truncate(result.diagnostics.queryText, QUERY_TEXT_LIMIT)}"`,
    `  Trigger: ${result.diagnostics.triggerSummary}`,
    `  Total candidates: ${result.diagnostics.totalCandidates}, dropped: ${result.diagnostics.droppedCount}`,
    `  Estimated prompt tokens: ${result.diagnostics.estimatedTokens}`,
    `  Truncated sections: ${result.diagnostics.truncatedSections.length > 0 ? result.diagnostics.truncatedSections.join(', ') : 'none'}`,
    `  Pi schema render mode: ${result.diagnostics.piSchemaRenderMode}`,
    `  Full pi schema rendered: ${result.diagnostics.fullPiSchemaRendered}`,
    `  Eval autonomy rule enabled: ${result.diagnostics.evalAutonomyRuleEnabled}`,
    `  Anthropic execution override enabled: ${result.diagnostics.anthropicExecutionOverrideEnabled}`,
  ].join('\n');
}

function emptyInspection(): ContextInspectorResult {
  return {
    tier: 'minimal',
    tierReason: 'no active task',
    budget: TIER_BUDGETS.minimal.totalBudget,
    workingMemory: {
      taskId: null,
      phase: null,
      goal: null,
      currentStep: null,
      recentErrorCount: 0,
      recentSignalCount: 0,
    },
    ledger: {
      factCount: 0,
      confirmedCount: 0,
      tentativeCount: 0,
      rejectionCount: 0,
      hardRejectionCount: 0,
      softRejectionCount: 0,
      openQuestionCount: 0,
    },
    recall: {
      strategyGenes: { count: 0, limit: 0 },
      preferences: { count: 0, limit: 0 },
      docFindings: { count: 0, limit: 0 },
      historicalSnapshots: { count: 0, limit: 0 },
      artifactRefs: { count: 0, limit: 0 },
    },
    topItem: null,
    diagnostics: {
      queryText: '',
      triggerSummary: 'signalKinds: none, paths: none',
      totalCandidates: 0,
      droppedCount: 0,
      estimatedTokens: 0,
      truncatedSections: [],
      piSchemaRenderMode: 'summary',
      fullPiSchemaRendered: false,
      evalAutonomyRuleEnabled: false,
      anthropicExecutionOverrideEnabled: false,
    },
  };
}

function makeRecallInput(
  taskId: string,
  workingMemory: TaskWorkingMemory,
  taskLedger: TaskLedgerInput,
  tier: L1Tier,
): RecallRouterInput {
  return {
    taskId,
    currentTaskId: taskId,
    currentRunId: workingMemory.runId,
    excludeTaskIds: [taskId],
    excludeRunIds: [workingMemory.runId],
    tier,
    phase: workingMemory.phase,
    goal: workingMemory.goal,
    currentStep: workingMemory.currentStep,
    recentErrors: workingMemory.recentErrors.map((error) => ({
      source: error.source,
      pattern: error.pattern,
    })),
    recentSignals: workingMemory.recentSignals.flatMap((signal) => {
      const kind = normalizeSignalKind(signal.kind);
      return kind ? [{ kind, summary: signal.summary }] : [];
    }),
    taskLedger,
    recentRawTurns: [],
  };
}

function buildL1TierInput(workingMemory: TaskWorkingMemory): L1TierInput {
  return {
    hasActiveTask: true,
    isSimpleConfirmation: false,
    hasPendingToolResult: false,
    hasRecentError: workingMemory.recentErrors.length > 0,
    recentErrorCount: workingMemory.recentErrors.length,
    hasOpenQuestion: false,
    hasLostnessTrigger: workingMemory.recentSignals.some((signal) =>
      signal.kind === 'lostness_hard' || signal.kind === 'lostness_soft',
    ),
    hasUserCorrection: workingMemory.recentSignals.some((signal) => signal.kind === 'user_correction'),
    hasRejectedAssumptionRisk: false,
    isRecoveryMode: false,
    nextActionIsWrite: false,
  };
}

function summarizeLedger(ledger: TaskLedgerInput): ContextInspectorResult['ledger'] {
  return {
    factCount: ledger.confirmedFacts.length,
    confirmedCount: ledger.confirmedFacts.filter((fact) => fact.confidence === 'confirmed').length,
    tentativeCount: ledger.confirmedFacts.filter((fact) => fact.confidence === 'tentative').length,
    rejectionCount: ledger.rejectedAssumptions.length,
    hardRejectionCount: ledger.rejectedAssumptions.filter((rejection) => rejection.severity === 'hard').length,
    softRejectionCount: ledger.rejectedAssumptions.filter((rejection) => rejection.severity === 'soft').length,
    openQuestionCount: ledger.openQuestions.length,
  };
}

function summarizeRecall(bundle: RecallBundle, tier: L1Tier): ContextInspectorResult['recall'] {
  const limits = RECALL_LIMITS[tier];
  return {
    strategyGenes: { count: bundle.knacks.length, limit: limits.knacks },
    preferences: { count: bundle.preferences.length, limit: limits.preferences },
    docFindings: { count: bundle.docFindings.length, limit: limits.docFindings },
    historicalSnapshots: { count: bundle.historicalTaskSnapshots.length, limit: limits.runArchiveRefs },
    artifactRefs: { count: bundle.artifactRefs.length, limit: limits.artifactRefs },
  };
}

function findTopItem(bundle: RecallBundle): ContextInspectorResult['topItem'] {
  const items = [
    ...bundle.knacks,
    ...bundle.preferences,
    ...bundle.docFindings,
    ...bundle.historicalTaskSnapshots,
    ...bundle.artifactRefs,
    ...bundle.runArchiveRefs,
  ];
  const top = items.reduce<RecalledItem | null>((best, item) => {
    if (!best || item.score.total > best.score.total) return item;
    return best;
  }, null);
  if (!top) return null;
  return {
    id: top.id,
    total: top.score.total,
    dimensions: {
      trigger: top.score.dimensions.trigger,
      keyword: top.score.dimensions.keyword,
      recency: top.score.dimensions.recency,
      relevance: top.score.dimensions.relevance,
      metadata: top.score.dimensions.metadata,
      evidence: top.score.dimensions.evidence,
    },
    ...(top.reason.startsWith('knack_rank:') && top.ranking ? { ranking: top.ranking } : {}),
  };
}

function applyRecallLimits(bundle: RecallBundle, tier: L1Tier): RecallBundle {
  const limits = RECALL_LIMITS[tier];
  return {
    ...bundle,
    knacks: bundle.knacks.slice(0, limits.knacks),
    preferences: bundle.preferences.slice(0, limits.preferences),
    docFindings: bundle.docFindings.slice(0, limits.docFindings),
    historicalTaskSnapshots: bundle.historicalTaskSnapshots.slice(0, limits.runArchiveRefs),
    artifactRefs: bundle.artifactRefs.slice(0, limits.artifactRefs),
    runArchiveRefs: bundle.runArchiveRefs.slice(0, limits.runArchiveRefs),
  };
}

function summarizeTrigger(trigger: RecallBundle['diagnostics']['triggerUsed']): string {
  return [
    `signalKinds: ${formatList(trigger.signalKinds)}`,
    `paths: ${formatList(trigger.paths)}`,
  ].join(', ');
}

function normalizeSignalKind(kind: string): SignalKind | null {
  return SIGNAL_KINDS.has(kind as SignalKind) ? kind as SignalKind : null;
}

function formatTopItem(topItem: ContextInspectorResult['topItem']): string {
  if (!topItem) return 'Top item: none';
  const base = `Top item: ${topItem.id} (total: ${formatScore(topItem.total)}, trigger: ${formatScore(topItem.dimensions.trigger)}, keyword: ${formatScore(topItem.dimensions.keyword)}, recency: ${formatScore(topItem.dimensions.recency)}, relevance: ${formatScore(topItem.dimensions.relevance)}, metadata: ${formatScore(topItem.dimensions.metadata)}, evidence: ${formatScore(topItem.dimensions.evidence)})`;
  if (!topItem.ranking) return base;
  return `${base}\n  Knack ranking: repoMatch=${topItem.ranking.repoMatch}, similarity=${formatScore(topItem.ranking.similarity)} (${topItem.ranking.similaritySource}), reuse=${topItem.ranking.reuseCount}, confidence=${topItem.ranking.confidence}, antiRepeat=${topItem.ranking.antiRepeat}`;
}

function formatScore(value: number): string {
  return value.toFixed(3);
}

function formatList(values?: readonly string[]): string {
  return values && values.length > 0 ? values.join(', ') : 'none';
}

function display(value: string | null): string {
  return value && value.length > 0 ? value : 'none';
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}
