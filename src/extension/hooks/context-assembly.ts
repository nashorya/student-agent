import { buildHardcodedSections, buildPreferencesSection, legacyMemoryHook, renderMemoryPrompt } from './memory.js';
import {
  ANTHROPIC_EXECUTION_OVERRIDE,
  CACHE_PREFIX_BREAKPOINT,
  ContextBuilder,
  EVAL_AUTONOMY_RULE,
  partitionContextSections,
  PI_CONTRACT_SUMMARY,
} from '../../memory/recall/context-builder.js';
import { JsonlMemoryStore } from '../../memory/recall/jsonl-memory-store.js';
import { RecallRouter } from '../../memory/recall/recall-router.js';
import { RECALL_LIMITS, selectL1Tier } from '../../memory/recall/tier-selector.js';
import { TaskLedgerManager } from '../../memory/tasks/task-ledger-manager.js';
import { TasksManager } from '../../memory/tasks/manager.js';
import {
  estimateTextTokens,
  summarizeContextTraceLayers,
} from '../../evals/context-breakdown.js';
import type {
  BuiltContext,
  ContextSection,
  ContextRunMode,
  L1Tier,
  L1TierInput,
  PiSchemaRenderMode,
  RecallBundle,
  RecallableMemoryKind,
  RecallRouterInput,
} from '../../memory/recall/types.js';
import type { SignalKind } from '../../memory/signals/types.js';
import type {
  EvalContextAssemblyTrace,
  EvalContextBreakdownSection,
  EvalContextLayer,
} from '../../evals/types.js';

export interface ContextAssemblyOptions {
  memoryDir: string;
  useNewPipeline: boolean;
  runMode?: ContextRunMode;
  piSchemaRenderMode?: PiSchemaRenderMode;
  onTrace?: (trace: EvalContextAssemblyTrace) => void;
  fullResidentLessons?: () => Promise<Array<{ id: string; summary: string }>>;
  recallKinds?: RecallableMemoryKind[];
  eligibleRunIds?: string[];
  includeHistoricalTaskSnapshots?: boolean;
  forceTier?: L1Tier;
  repository?: string;
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

export type ContextAssemblyHook = (() => Promise<string>) & {
  contextAssemblyTraces: EvalContextAssemblyTrace[];
};

export function createContextAssemblyHook(options: ContextAssemblyOptions): ContextAssemblyHook {
  const contextAssemblyTraces: EvalContextAssemblyTrace[] = [];
  const emitTrace = (trace: EvalContextAssemblyTrace): void => {
    contextAssemblyTraces.push(trace);
    options.onTrace?.(trace);
  };
  const hook = async (): Promise<string> => {
    if (!options.useNewPipeline) {
      const prompt = await legacyMemoryHook(options.memoryDir);
      emitTrace(buildAssemblyTrace({
        pipeline: 'legacy',
        prompt,
        sections: [traceSection('L0', 'legacyMemoryPrompt', 'Legacy memory prompt', prompt)],
        truncated: [],
      }));
      return prompt;
    }
    return newPipelineHook(options.memoryDir, {
      runMode: options.runMode,
      piSchemaRenderMode: options.piSchemaRenderMode,
      onTrace: emitTrace,
      fullResidentLessons: options.fullResidentLessons,
      recallKinds: options.recallKinds,
      eligibleRunIds: options.eligibleRunIds,
      includeHistoricalTaskSnapshots: options.includeHistoricalTaskSnapshots,
      forceTier: options.forceTier,
      repository: options.repository,
    });
  };
  hook.contextAssemblyTraces = contextAssemblyTraces;
  return hook;
}

interface NewPipelineOptions {
  runMode?: ContextRunMode;
  piSchemaRenderMode?: PiSchemaRenderMode;
  onTrace?: (trace: EvalContextAssemblyTrace) => void;
  fullResidentLessons?: () => Promise<Array<{ id: string; summary: string }>>;
  recallKinds?: RecallableMemoryKind[];
  eligibleRunIds?: string[];
  includeHistoricalTaskSnapshots?: boolean;
  forceTier?: L1Tier;
  repository?: string;
}

export async function newPipelineHook(
  memoryDir: string,
  options: NewPipelineOptions = {},
): Promise<string> {
  const hardcoded = await buildHardcodedSections(memoryDir);
  const runMode = options.runMode ?? 'interactive';
  const piSchemaRenderMode = options.piSchemaRenderMode ?? 'summary';
  const task = await TasksManager.getInstance(memoryDir).getActive();

  if (!task) {
    const preferences = await buildPreferencesSection(memoryDir);
    const promptSections = [
      runMode === 'eval' ? EVAL_AUTONOMY_RULE : '',
      runMode === 'eval' ? ANTHROPIC_EXECUTION_OVERRIDE : '',
      piSchemaRenderMode === 'summary' || piSchemaRenderMode === 'full' ? PI_CONTRACT_SUMMARY : '',
      hardcoded,
      preferences ?? '',
    ];
    const prompt = renderMemoryPrompt(promptSections);
    options.onTrace?.(buildAssemblyTrace({
      pipeline: 'new',
      prompt,
      runMode,
      piSchemaRenderMode,
      sections: [
        ...(runMode === 'eval' ? [
          traceSection('L0', 'evalAutonomyRule', 'Eval autonomy rule', EVAL_AUTONOMY_RULE),
          traceSection('L0', 'anthropicExecutionOverride', 'Anthropic execution override', ANTHROPIC_EXECUTION_OVERRIDE),
        ] : []),
        ...((piSchemaRenderMode === 'summary' || piSchemaRenderMode === 'full')
          ? [traceSection('L0', 'piContractSummary', 'Pi contract summary', PI_CONTRACT_SUMMARY)]
          : []),
        traceSection('L0', 'hardcodedSections', 'Hardcoded prompt sections', hardcoded),
        ...(preferences ? [traceSection('L3', 'preferences', 'User preferences', preferences)] : []),
      ],
      truncated: [],
    }));
    return prompt;
  }

  const tierInput = buildL1TierInput(task.working_memory);
  const tierDecision = options.forceTier
    ? { tier: options.forceTier, reason: `forced_${options.forceTier}` }
    : selectL1Tier(tierInput);
  const taskLedger = await new TaskLedgerManager(memoryDir, task.id).toLedgerInput();

  const recallStore = new JsonlMemoryStore({
    memoryDir,
    kinds: options.recallKinds,
    eligibleRunIds: options.eligibleRunIds,
  });
  const recallInput = {
    taskId: task.id,
    currentTaskId: task.id,
    currentRunId: task.working_memory.runId,
    repository: options.repository,
    repositoryHints: [
      task.name,
      task.working_memory.goal,
      task.working_memory.currentStep,
      task.working_memory.hardConstraints,
    ],
    hardConstraints: task.working_memory.hardConstraints,
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
  } satisfies RecallRouterInput;
  const fullResidentLessons = await options.fullResidentLessons?.();
  const recallBundle = await new RecallRouter(recallStore, {
    includeHistoricalTaskSnapshots: options.includeHistoricalTaskSnapshots,
  }).recall(recallInput);
  const limitedRecallBundle = applyRecallLimits(recallBundle, tierDecision.tier);
  if (fullResidentLessons !== undefined) {
    limitedRecallBundle.knacks = [];
  } else {
    await recallStore.recordKnackInjections({
      knackIds: limitedRecallBundle.knacks.map((knack) => knack.id),
      taskId: task.id,
      runId: task.working_memory.runId,
    });
  }
  const built = new ContextBuilder().build({
    workingMemory: task.working_memory,
    recallBundle: limitedRecallBundle,
    taskLedger,
    tier: tierDecision.tier,
    runMode,
    piSchemaRenderMode,
    fullResidentLessons,
  });

  const builtContextText = renderBuiltContext(built, tierDecision.reason);
  const prompt = renderMemoryPrompt([
    hardcoded,
    builtContextText,
  ]);
  const diagnostics = buildBuiltContextDiagnostics(built, tierDecision.reason);
  options.onTrace?.(buildAssemblyTrace({
    pipeline: 'new',
    prompt,
    runMode,
    piSchemaRenderMode,
    tier: tierDecision.tier,
    tierReason: tierDecision.reason,
    sections: [
      traceSection('L0', 'hardcodedSections', 'Hardcoded prompt sections', hardcoded),
      ...built.sections.map((section) =>
        traceSection(
          contextSectionLayer(section.name),
          section.name,
          section.name,
          renderContextSection(section),
        )),
      traceSection('L1', 'contextAssemblyDiagnostics', 'Context assembly diagnostics', diagnostics),
    ],
    truncated: built.truncated,
    recallBundle: limitedRecallBundle,
  }));
  return prompt;
}

function renderBuiltContext(context: BuiltContext, _tierReason?: string): string {
  // Diagnostics stay on the trace side only — do not inject into the subject prompt.
  // Physical order: static prefix → cache breakpoint → dynamic suffix (content unchanged).
  const { staticSections, dynamicSections } = partitionContextSections(context.sections);
  return [
    '## Context Assembly（新记忆管线，按优先级组装）',
    '',
    ...staticSections.map(renderContextSection),
    '',
    CACHE_PREFIX_BREAKPOINT,
    '',
    ...dynamicSections.map(renderContextSection),
  ].join('\n');
}

function buildBuiltContextDiagnostics(context: BuiltContext, tierReason?: string): string {
  return [
    `Tier: ${context.tier}`,
    `Tier reason: ${tierReason ?? 'unknown'}`,
    `Total estimated tokens: ${context.totalEstimatedTokens}`,
    `Truncated sections: ${context.truncated.length > 0 ? context.truncated.join(', ') : 'none'}`,
    `Pi schema render mode: ${context.piSchemaRenderMode}`,
    `Full pi schema rendered: ${context.fullPiSchemaRendered}`,
    `Eval autonomy rule enabled: ${context.evalAutonomyEnabled}`,
    `Anthropic execution override enabled: ${context.anthropicExecutionOverrideEnabled}`,
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

function buildAssemblyTrace(options: {
  pipeline: 'legacy' | 'new';
  prompt: string;
  runMode?: ContextRunMode;
  piSchemaRenderMode?: PiSchemaRenderMode;
  tier?: EvalContextAssemblyTrace['tier'];
  tierReason?: string;
  sections: EvalContextBreakdownSection[];
  truncated: string[];
  recallBundle?: RecallBundle;
}): EvalContextAssemblyTrace {
  const renderedPromptEstimatedTokens = estimateTextTokens(options.prompt);
  const sectionEstimatedTokens = options.sections.reduce((sum, section) => sum + section.estimatedTokens, 0);
  const sectionChars = options.sections.reduce((sum, section) => sum + section.chars, 0);
  const promptWrapperEstimatedTokens = Math.max(0, renderedPromptEstimatedTokens - sectionEstimatedTokens);
  const promptWrapperChars = Math.max(0, options.prompt.length - sectionChars);
  const sections = promptWrapperEstimatedTokens > 0
    ? [
      ...options.sections,
      {
        layer: 'L0' as const,
        id: 'promptWrapperOverhead',
        title: 'Prompt wrapper headings and separators',
        chars: promptWrapperChars,
        estimatedTokens: promptWrapperEstimatedTokens,
      },
    ]
    : options.sections;
  return {
    pipeline: options.pipeline,
    generatedAt: new Date().toISOString(),
    runMode: options.runMode,
    piSchemaRenderMode: options.piSchemaRenderMode,
    tier: options.tier,
    tierReason: options.tierReason,
    truncated: options.truncated,
    renderedPromptChars: options.prompt.length,
    renderedPromptEstimatedTokens,
    sections,
    layers: summarizeContextTraceLayers({ sections }),
    ...(options.recallBundle ? { recall: buildRecallTrace(options.recallBundle) } : {}),
  };
}

function buildRecallTrace(bundle: RecallBundle): NonNullable<EvalContextAssemblyTrace['recall']> {
  const items = [
    ...(bundle.lessons ?? []),
    ...bundle.knacks,
    ...bundle.preferences,
    ...bundle.docFindings,
    ...bundle.historicalTaskSnapshots,
    ...bundle.artifactRefs,
    ...bundle.runArchiveRefs,
  ];
  return {
    items: [...new Map(items.map((item) => [item.id, item])).values()].map((item) => ({
      id: item.id,
      kind: item.kind,
      subtype: item.subtype,
      summary: item.summary,
      reason: item.reason,
      score: item.score.total,
      ...(item.ranking ? { ranking: item.ranking } : {}),
    })),
    diagnostics: {
      queryText: bundle.diagnostics.queryText,
      totalCandidates: bundle.diagnostics.totalCandidates,
      dropped: bundle.diagnostics.dropped,
      penalties: bundle.diagnostics.penalties,
      ...(bundle.diagnostics.candidatePool
        ? { candidatePool: bundle.diagnostics.candidatePool }
        : {}),
    },
  };
}

function traceSection(
  layer: EvalContextLayer,
  id: string,
  title: string,
  content: string,
): EvalContextBreakdownSection {
  return {
    layer,
    id,
    title,
    chars: content.length,
    estimatedTokens: estimateTextTokens(content),
  };
}

function contextSectionLayer(name: string): EvalContextLayer {
  if (
    name === 'evalAutonomyRule'
    || name === 'anthropicExecutionOverride'
    || name === 'piContractSummary'
    || name === 'piSchemaFull'
    || name === 'systemRules'
    || name === 'toolRules'
  ) {
    return 'L0';
  }
  if (name === 'taskSpec' || name === 'hardConstraints' || name === 'currentUserMessage') {
    return 'L1';
  }
  if (
    name === 'taskLedger'
    || name === 'workingMemory'
    || name === 'recentErrors'
    || name === 'recentSignals'
  ) {
    return 'L2';
  }
  return 'L3';
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
    lessons: (bundle.lessons ?? []).slice(0, limits.knacks),
    knacks: bundle.knacks.slice(0, limits.knacks),
    preferences: bundle.preferences.slice(0, limits.preferences),
    docFindings: bundle.docFindings.slice(0, limits.docFindings),
    historicalTaskSnapshots: bundle.historicalTaskSnapshots.slice(0, limits.runArchiveRefs),
    artifactRefs: bundle.artifactRefs.slice(0, limits.artifactRefs),
    runArchiveRefs: bundle.runArchiveRefs.slice(0, limits.runArchiveRefs),
  };
}
