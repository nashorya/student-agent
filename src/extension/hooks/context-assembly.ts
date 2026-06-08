import { buildHardcodedSections, buildPreferencesSection, legacyMemoryHook, renderMemoryPrompt } from './memory.js';
import { ContextBuilder } from '../../memory/recall/context-builder.js';
import { JsonlMemoryStore } from '../../memory/recall/jsonl-memory-store.js';
import { RecallRouter } from '../../memory/recall/recall-router.js';
import { RECALL_LIMITS, selectL1Tier } from '../../memory/recall/tier-selector.js';
import { TaskLedgerManager } from '../../memory/tasks/task-ledger-manager.js';
import { TasksManager } from '../../memory/tasks/manager.js';
import type {
  BuiltContext,
  ContextSection,
  L1Tier,
  L1TierInput,
  RecallBundle,
  RecallRouterInput,
} from '../../memory/recall/types.js';
import type { SignalKind } from '../../memory/signals/types.js';

export interface ContextAssemblyOptions {
  memoryDir: string;
  useNewPipeline: boolean;
}

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

export function createContextAssemblyHook(options: ContextAssemblyOptions) {
  return async (): Promise<string> => {
    if (!options.useNewPipeline) {
      return legacyMemoryHook(options.memoryDir);
    }
    return newPipelineHook(options.memoryDir);
  };
}

export async function newPipelineHook(memoryDir: string): Promise<string> {
  const hardcoded = await buildHardcodedSections(memoryDir);
  const task = await TasksManager.getInstance(memoryDir).getActive();

  if (!task) {
    const preferences = await buildPreferencesSection(memoryDir);
    return renderMemoryPrompt([hardcoded, preferences ?? '']);
  }

  const tierInput = buildL1TierInput(task.working_memory);
  const tierDecision = selectL1Tier(tierInput);
  const taskLedger = await new TaskLedgerManager(memoryDir, task.id).toLedgerInput();

  const recallBundle = await new RecallRouter(new JsonlMemoryStore({ memoryDir })).recall({
    taskId: task.id,
    currentTaskId: task.id,
    currentRunId: task.working_memory.runId,
    excludeTaskIds: [task.id],
    excludeRunIds: [task.working_memory.runId],
    tier: tierDecision.tier,
    phase: task.working_memory.phase,
    goal: task.working_memory.goal,
    currentStep: task.working_memory.currentStep,
    recentErrors: task.working_memory.recentErrors.map((error) => ({
      source: error.source,
      pattern: error.pattern,
    })),
    recentSignals: task.working_memory.recentSignals.flatMap((signal) => {
      const kind = normalizeSignalKind(signal.kind);
      return kind ? [{ kind, summary: signal.summary }] : [];
    }),
    taskLedger,
    recentRawTurns: [],
  } satisfies RecallRouterInput);

  const built = new ContextBuilder().build({
    workingMemory: task.working_memory,
    recallBundle: applyRecallLimits(recallBundle, tierDecision.tier),
    taskLedger,
    tier: tierDecision.tier,
  });

  return renderMemoryPrompt([
    hardcoded,
    renderBuiltContext(built, tierDecision.reason),
  ]);
}

function renderBuiltContext(context: BuiltContext, tierReason?: string): string {
  const sections = context.sections.map(renderContextSection);
  const diagnostics = [
    `Tier: ${context.tier}`,
    `Tier reason: ${tierReason ?? 'unknown'}`,
    `Total estimated tokens: ${context.totalEstimatedTokens}`,
    `Truncated sections: ${context.truncated.length > 0 ? context.truncated.join(', ') : 'none'}`,
  ].join('\n');
  return [
    '## Context Assembly（新记忆管线，按优先级组装）',
    '',
    ...sections,
    '',
    '### context_assembly_diagnostics',
    diagnostics,
  ].join('\n');
}

function renderContextSection(section: ContextSection): string {
  return [
    `### ${section.name}`,
    `priority: ${section.priority}`,
    `estimatedTokens: ${section.estimatedTokens}`,
    '',
    section.content,
  ].join('\n');
}

function normalizeSignalKind(kind: string): SignalKind | null {
  return SIGNAL_KINDS.has(kind as SignalKind) ? kind as SignalKind : null;
}

function buildL1TierInput(workingMemory: { recentErrors: unknown[]; recentSignals: Array<{ kind: string }> }): L1TierInput {
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
