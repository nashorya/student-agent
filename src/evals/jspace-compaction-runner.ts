import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  EvalFeatureManifest,
  EvalProviderRequestAuditEntry,
  EvalProviderUsageTimelineEntry,
  EvalTaskDefinition,
  EvalTokenUsage,
  StudentAgentEvalTrace,
  VerifierResult,
} from './types.js';
import type { CompactionProbeEvent } from './forced-compaction-controller.js';
import {
  createContextRuntimeBuildMemoryPrompt,
  seedContextRuntimeEvalMemory,
} from './context-runtime-runner.js';

export type JspaceCompactionArm = 'plain' | 'current';
export type NeutralityMode = 'strict' | 'tolerant';

export interface RunStructure {
  modelCalls: number;
  toolSequence: string[];
  boundaryMsgCounts: number[];
  perCheck: Record<string, boolean>;
}

export interface NeutralityResult {
  neutral: boolean;
  mode: NeutralityMode;
  inconclusive?: boolean;
  failedOn?: 'runStatus' | 'runValidity' | 'forcedCompaction' | 'modelCalls' | 'toolSequence' |
    'boundaryMsgCounts' | 'perCheck' | 'baselineVariance';
  divergedAtStep?: number;
  control?: unknown;
  noOp?: unknown;
  reason: string;
}

export interface ThinkingEvidenceSummary {
  requestCount: number;
  requestPolicyCompliant: boolean;
  thinkingRequested: boolean;
  responsesInspected: number;
  responsesWithReasoning: number;
  reasoningChars: number;
  reasoningTokens: number;
  thinkingActive: boolean;
  verdict: 'active' | 'requested_but_not_observed' | 'not_requested';
}

export interface EffectiveParamsSummary {
  requestCount: number;
  consistent: boolean;
  model: string | null;
  thinking: { type: string } | null;
  temperature: number | null;
  do_sample: boolean | null;
}

export interface ProviderTokenUsageSummary {
  promptTokens: number;
  cachedPromptTokens: number;
  uncachedPromptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  peakPromptTokens: number;
  estimatedCostUsd: number | null;
  listPriceEquivalentCny: number | null;
  billingMode: 'coding_plan_subscription' | 'pay_as_you_go_or_unknown';
  source: 'provider_response' | 'pi_usage_fallback';
  providerResponsesWithUsage: number;
  costBasis: string;
}

export interface BoundaryContextUsageSummary {
  targetPromptTokens: { min: number; max: number };
  allBoundariesMeasured: boolean;
  allWithinTarget: boolean | null;
  boundaries: Array<{
    boundary: string;
    observedAt: string;
    requestIndex: number | null;
    promptTokens: number | null;
    withinTarget: boolean | null;
  }>;
}

const GLM_5_2_LIST_PRICE_CNY_PER_MILLION = {
  uncachedPrompt: 8,
  cachedPrompt: 2,
  completion: 28,
} as const;

/**
 * Produces a per-run token ledger from response-side provider usage. The Pi
 * aggregate remains a fallback because provider usage is the closest evidence
 * to what Z.AI actually counted. Coding Plan is subscription billed, so the
 * public pay-as-you-go equivalent is kept separate from the real bill.
 */
export function summarizeProviderTokenUsage(
  audit: EvalProviderRequestAuditEntry[],
  piUsage: EvalTokenUsage,
): ProviderTokenUsageSummary {
  const withUsage = audit.filter((entry) =>
    entry.response?.promptTokens !== undefined || entry.response?.completionTokens !== undefined);
  const providerBacked = withUsage.length > 0;
  const promptTokens = providerBacked
    ? withUsage.reduce((sum, entry) => sum + (entry.response?.promptTokens ?? 0), 0)
    : piUsage.inputTokens;
  const cachedPromptTokens = providerBacked
    ? withUsage.reduce((sum, entry) => sum + (entry.response?.cachedPromptTokens ?? 0), 0)
    : piUsage.cacheReadTokens;
  const completionTokens = providerBacked
    ? withUsage.reduce((sum, entry) => sum + (entry.response?.completionTokens ?? 0), 0)
    : piUsage.outputTokens;
  const reasoningTokens = audit.reduce((sum, entry) =>
    sum + (entry.response?.reasoningTokens ?? 0), 0);
  const uncachedPromptTokens = Math.max(0, promptTokens - cachedPromptTokens);
  const totalTokens = promptTokens + completionTokens;
  const peakPromptTokens = audit.reduce((peak, entry) =>
    Math.max(peak, entry.response?.promptTokens ?? 0), 0);
  const billingMode = audit.some((entry) => entry.url.includes('/api/coding/'))
    ? 'coding_plan_subscription'
    : 'pay_as_you_go_or_unknown';
  const listPriceEquivalentCny = audit.some((entry) => entry.model === 'glm-5.2')
    ? roundCost(
      uncachedPromptTokens * GLM_5_2_LIST_PRICE_CNY_PER_MILLION.uncachedPrompt / 1_000_000 +
      cachedPromptTokens * GLM_5_2_LIST_PRICE_CNY_PER_MILLION.cachedPrompt / 1_000_000 +
      completionTokens * GLM_5_2_LIST_PRICE_CNY_PER_MILLION.completion / 1_000_000,
    )
    : null;
  return {
    promptTokens,
    cachedPromptTokens,
    uncachedPromptTokens,
    completionTokens,
    reasoningTokens,
    totalTokens,
    peakPromptTokens,
    estimatedCostUsd: piUsage.costUsd.total > 0 ? piUsage.costUsd.total : null,
    listPriceEquivalentCny,
    billingMode,
    source: providerBacked ? 'provider_response' : 'pi_usage_fallback',
    providerResponsesWithUsage: withUsage.length,
    costBasis: billingMode === 'coding_plan_subscription'
      ? 'Actual marginal cost is covered by Coding Plan and cannot be inferred per run; CNY is a public pay-as-you-go list-price equivalent.'
      : 'USD comes from Pi model pricing when configured; CNY is a GLM-5.2 public list-price equivalent.',
  };
}

export function summarizeBoundaryContextUsage(
  audit: EvalProviderRequestAuditEntry[],
  events: CompactionProbeEvent[],
  targetPromptTokens = { min: 50_000, max: 80_000 },
): BoundaryContextUsageSummary {
  const boundaries = events
    .filter((event): event is Extract<CompactionProbeEvent, { kind: 'boundary_observed' }> =>
      event.kind === 'boundary_observed')
    .map((event) => {
      const boundaryTime = Date.parse(event.observedAt);
      const request = [...audit].reverse().find((entry) =>
        Date.parse(entry.at) <= boundaryTime && entry.response?.promptTokens !== undefined);
      const promptTokens = request?.response?.promptTokens ?? null;
      return {
        boundary: event.boundary,
        observedAt: event.observedAt,
        requestIndex: request?.index ?? null,
        promptTokens,
        withinTarget: promptTokens === null
          ? null
          : promptTokens >= targetPromptTokens.min && promptTokens <= targetPromptTokens.max,
      };
    });
  const allBoundariesMeasured = boundaries.length > 0 &&
    boundaries.every((boundary) => boundary.promptTokens !== null);
  return {
    targetPromptTokens,
    allBoundariesMeasured,
    allWithinTarget: allBoundariesMeasured
      ? boundaries.every((boundary) => boundary.withinTarget === true)
      : null,
    boundaries,
  };
}

export function summarizeEffectiveParams(
  audit: EvalProviderRequestAuditEntry[],
): EffectiveParamsSummary {
  const models = unique(audit.map((entry) => entry.model));
  const thinkingTypes = unique(audit.map((entry) => {
    const thinking = entry.thinking;
    return thinking && typeof thinking === 'object' && !Array.isArray(thinking)
      ? String((thinking as { type?: unknown }).type)
      : '';
  }));
  const temperatures = unique(audit.map((entry) => entry.temperature));
  const doSampleValues = unique(audit.map((entry) => entry.doSample));
  const consistent = audit.length > 0 &&
    audit.every((entry) => entry.compliant) &&
    models.length === 1 && thinkingTypes.length === 1 &&
    temperatures.length === 1 && doSampleValues.length === 1;
  return {
    requestCount: audit.length,
    consistent,
    model: models.length === 1 ? models[0] : null,
    thinking: thinkingTypes.length === 1 && thinkingTypes[0]
      ? { type: thinkingTypes[0] }
      : null,
    temperature: temperatures.length === 1 && typeof temperatures[0] === 'number'
      ? temperatures[0]
      : null,
    do_sample: doSampleValues.length === 1 && typeof doSampleValues[0] === 'boolean'
      ? doSampleValues[0]
      : null,
  };
}

export interface JspaceRunValidity {
  valid: boolean;
  status: 'complete' | 'incomplete' | 'aborted' | 'compaction_ineffective' |
    'invalid_probe_leakage';
  expectedBoundaries: string[];
  observedBoundaries: string[];
  reasons: string[];
  annotations: string[];
}

export function assessJspaceRunValidity(
  trace: Pick<StudentAgentEvalTrace, 'status' | 'mode' | 'taskState' | 'compactionEvents'> &
    Partial<Pick<StudentAgentEvalTrace, 'toolCalls'>>,
  expectedPhaseBoundaries: number[],
  verifier?: Pick<VerifierResult, 'perCheck'>,
  options: {
    requireEffectiveCompaction?: boolean;
    rejectSealedMaterialReads?: boolean;
  } = {},
): JspaceRunValidity {
  const expectedBoundaries = expectedPhaseBoundaries.map((phase) => `phase:${phase}`);
  const observedBoundaries = (trace.compactionEvents ?? [])
    .filter((event) => event.kind === 'boundary_observed')
    .map((event) => event.boundary);
  const reasons: string[] = [];
  const annotations: string[] = [];
  const perCheckValues = Object.values(verifier?.perCheck ?? {});
  const allChecksPassed = perCheckValues.length > 0 && perCheckValues.every(Boolean);
  if (trace.status === 'failed') annotations.push('agent trace failed');
  let taskLifecycleComplete = trace.mode !== 'task';
  if (trace.mode === 'task') {
    const incompletePhases = trace.taskState?.phases
      ?.map((phase, index) => ({ phase: index + 1, status: phase.status }))
      .filter((phase) => phase.status !== 'completed') ?? [];
    taskLifecycleComplete = trace.taskState?.status === 'completed' && incompletePhases.length === 0;
    if (!taskLifecycleComplete) {
      annotations.push(`task state is ${trace.taskState?.status ?? 'missing'}, expected completed`);
      if (incompletePhases.length > 0) {
        annotations.push(`incomplete phases: ${incompletePhases.map((phase) =>
          `${phase.phase}:${phase.status}`).join(', ')}`);
      }
    }
  }
  const missingBoundaries = expectedBoundaries.filter((boundary) =>
    !observedBoundaries.includes(boundary));
  const boundariesComplete = missingBoundaries.length === 0;
  const completedByOutcomeEvidence = allChecksPassed && boundariesComplete;
  const compactionReasons = options.requireEffectiveCompaction
    ? expectedBoundaries.flatMap((boundary) => {
      const event = (trace.compactionEvents ?? []).find((candidate): candidate is Extract<
        CompactionProbeEvent,
        { kind: 'forced_compaction' }
      > => candidate.kind === 'forced_compaction' && candidate.boundary === boundary);
      return ineffectiveCompactionReasons(boundary, event);
    })
    : [];
  const leakageReasons = options.rejectSealedMaterialReads
    ? sealedMaterialReadReasons(trace.toolCalls ?? [], trace.compactionEvents ?? [])
    : [];
  const valid = compactionReasons.length === 0 && leakageReasons.length === 0 && boundariesComplete &&
    ((trace.status === 'success' && taskLifecycleComplete) || completedByOutcomeEvidence);
  if (!valid) {
    reasons.push(...compactionReasons);
    reasons.push(...leakageReasons);
    if (trace.status === 'failed') reasons.push('agent trace failed');
    if (!taskLifecycleComplete) reasons.push(...annotations);
    if (!boundariesComplete) {
      reasons.push(`missing boundary observations: ${missingBoundaries.join(', ')}`);
    }
  } else if (completedByOutcomeEvidence && !taskLifecycleComplete) {
    annotations.push('accepted as complete because all verifier checks passed and all boundaries were observed');
  }
  return {
    valid,
    status: valid
      ? 'complete'
      : compactionReasons.length > 0
        ? 'compaction_ineffective'
        : leakageReasons.length > 0
          ? 'invalid_probe_leakage'
        : trace.status === 'failed'
          ? 'aborted'
          : 'incomplete',
    expectedBoundaries,
    observedBoundaries,
    reasons,
    annotations,
  };
}

const SEALED_MATERIAL_PATHS = [
  'docs/migration-map.md',
  'docs/ledgers/phase-1/',
  'docs/ledgers/phase-2/',
] as const;

function sealedMaterialReadReasons(
  toolCalls: StudentAgentEvalTrace['toolCalls'],
  events: CompactionProbeEvent[],
): string[] {
  const phaseTwo = events.find((event): event is Extract<
    CompactionProbeEvent,
    { kind: 'forced_compaction' }
  > => event.kind === 'forced_compaction' && event.boundary === 'phase:2' &&
    event.status === 'completed');
  if (!phaseTwo) return [];
  const sealedAt = Date.parse(
    phaseTwo.nextPhaseStartedAt ?? phaseTwo.completedAt ?? phaseTwo.requestedAt,
  );
  return toolCalls.flatMap((call) => {
    if (Date.parse(call.startedAt) < sealedAt) return [];
    return sealedPathsReferencedBy(call).map((path) =>
      `sealed material reread after phase:2 via ${call.name}: ${path}`);
  });
}

function sealedPathsReferencedBy(call: StudentAgentEvalTrace['toolCalls'][number]): string[] {
  if (!call.args || typeof call.args !== 'object' || Array.isArray(call.args)) return [];
  const args = call.args as { path?: unknown; paths?: unknown; command?: unknown };
  const toolName = normalizeToolName(call.name);
  const values = toolName === 'read' && typeof args.path === 'string'
    ? [args.path]
    : toolName === 'read_many' && Array.isArray(args.paths)
      ? args.paths.filter((path): path is string => typeof path === 'string')
      : toolName === 'bash' && typeof args.command === 'string'
        ? [args.command]
        : [];
  if ((toolName === 'bash' || toolName === 'search_files') && call.resultText) {
    values.push(call.resultText);
  }
  return SEALED_MATERIAL_PATHS.filter((sealedPath) =>
    values.some((value) => value.replaceAll('\\', '/').includes(sealedPath)));
}

export function annotateCompactionPromptTokens(
  events: CompactionProbeEvent[],
  timeline: EvalProviderUsageTimelineEntry[],
): void {
  const ordered = [...timeline].sort((left, right) =>
    Date.parse(left.ts) - Date.parse(right.ts) || left.seq - right.seq);
  for (const event of events) {
    if (event.kind !== 'forced_compaction') continue;
    const requestedAt = Date.parse(event.requestedAt);
    const nextPhaseStartedAt = event.nextPhaseStartedAt
      ? Date.parse(event.nextPhaseStartedAt)
      : Date.parse(event.completedAt ?? event.requestedAt);
    const before = [...ordered].reverse().find((entry) => Date.parse(entry.ts) <= requestedAt);
    const after = ordered.find((entry) => Date.parse(entry.ts) >= nextPhaseStartedAt);
    event.state.promptTokensBefore = before?.promptTokens ?? null;
    event.state.promptTokensAfter = after?.promptTokens ?? null;
  }
}

function ineffectiveCompactionReasons(
  boundary: string,
  event: Extract<CompactionProbeEvent, { kind: 'forced_compaction' }> | undefined,
): string[] {
  if (!event || event.status !== 'completed') {
    return [`${boundary}: forced compaction did not complete`];
  }
  const reasons: string[] = [];
  const { messagesBefore, messagesAfter, promptTokensBefore, promptTokensAfter } = event.state;
  if (messagesBefore === null || messagesAfter === null || messagesAfter >= messagesBefore) {
    reasons.push(`${boundary}: messages did not decrease after forced compaction`);
  }
  if (promptTokensBefore === null || promptTokensAfter === null || promptTokensBefore <= 0 ||
    promptTokensAfter > promptTokensBefore * 0.6) {
    reasons.push(`${boundary}: prompt tokens did not decrease by at least 40 percent`);
  }
  return reasons;
}

export function summarizeThinkingEvidence(
  audit: EvalProviderRequestAuditEntry[],
): ThinkingEvidenceSummary {
  const thinkingRequested = audit.length > 0 && audit.every((entry) =>
    entry.thinking && typeof entry.thinking === 'object' &&
    !Array.isArray(entry.thinking) &&
    (entry.thinking as { type?: unknown }).type === 'enabled');
  const responsesInspected = audit.filter((entry) => entry.response?.inspected).length;
  const responsesWithReasoning = audit.filter((entry) =>
    entry.response?.hasReasoningContent).length;
  const reasoningChars = audit.reduce((sum, entry) =>
    sum + (entry.response?.reasoningChars ?? 0), 0);
  const reasoningTokens = audit.reduce((sum, entry) =>
    sum + (entry.response?.reasoningTokens ?? 0), 0);
  const thinkingActive = thinkingRequested && responsesWithReasoning > 0;
  return {
    requestCount: audit.length,
    requestPolicyCompliant: audit.length > 0 && audit.every((entry) => entry.compliant),
    thinkingRequested,
    responsesInspected,
    responsesWithReasoning,
    reasoningChars,
    reasoningTokens,
    thinkingActive,
    verdict: thinkingActive
      ? 'active'
      : thinkingRequested
        ? 'requested_but_not_observed'
        : 'not_requested',
  };
}

export function buildJspaceFeatureManifest(arm: JspaceCompactionArm): EvalFeatureManifest {
  const current = arm === 'current';
  return {
    arm,
    piBuiltInCompaction: true,
    contextRuntime: current,
    memorySystemPrefix: current,
    taskLedgerModelInjection: current,
    recallModelInjection: current,
    checkpointInjection: false,
    jspaceInjection: false,
  };
}

export async function prepareJspaceArm(options: {
  arm: JspaceCompactionArm;
  task: EvalTaskDefinition;
  sandboxDir: string;
  instruction: string;
}): Promise<{
  featureManifest: EvalFeatureManifest;
  memoryDir?: string;
  buildMemoryPrompt?: () => Promise<string>;
}> {
  const featureManifest = buildJspaceFeatureManifest(options.arm);
  if (options.arm === 'plain') return { featureManifest };

  const memoryDir = join(options.sandboxDir, '.jspace-current-memory');
  await seedContextRuntimeEvalMemory({
    memoryDir,
    task: options.task,
    instruction: options.instruction,
  });
  return {
    featureManifest,
    memoryDir,
    buildMemoryPrompt: createContextRuntimeBuildMemoryPrompt('context_runtime', memoryDir),
  };
}

export function extractRunStructure(
  trace: Pick<StudentAgentEvalTrace,
    'turnCount' | 'usageEvents' | 'toolCalls' | 'compactionEvents' | 'providerRequestAudit'>,
  verifier: Pick<VerifierResult, 'exitCode' | 'correctnessScore' | 'perCheck'>,
): RunStructure {
  const observedBoundaries = (trace.compactionEvents ?? [])
    .filter((event): event is Extract<CompactionProbeEvent, { kind: 'boundary_observed' }> =>
      event.kind === 'boundary_observed');
  return {
    modelCalls: trace.providerRequestAudit?.length ?? trace.usageEvents?.length ?? trace.turnCount ?? 0,
    toolSequence: trace.toolCalls.map((call) => normalizeToolName(call.name)),
    boundaryMsgCounts: observedBoundaries.map((event) => event.state.messages ?? -1),
    perCheck: verifier.perCheck ?? {
      verifierExitCode: verifier.exitCode === 0,
      verifierCorrectness: verifier.correctnessScore === 1,
    },
  };
}

export function noOpNeutralityResult(input: {
  mode: NeutralityMode;
  control: { status: 'success' | 'failed' | 'incomplete' | 'aborted'; structure: RunStructure };
  noOp: {
    status: 'success' | 'failed' | 'incomplete' | 'aborted';
    structure: RunStructure;
    compactionEvents: CompactionProbeEvent[];
  };
}): NeutralityResult {
  const base = { mode: input.mode };
  if (input.control.status !== 'success' || input.noOp.status !== 'success') {
    return {
      ...base,
      neutral: false,
      inconclusive: true,
      failedOn: 'runValidity',
      control: input.control.status,
      noOp: input.noOp.status,
      reason: 'control and no-op must both complete successfully',
    };
  }
  const forcedEvents = input.noOp.compactionEvents.filter((event) =>
    event.kind === 'forced_compaction');
  if (forcedEvents.length > 0) {
    return {
      ...base,
      neutral: false,
      failedOn: 'forcedCompaction',
      control: 0,
      noOp: forcedEvents.length,
      reason: 'no-op emitted a forced compaction event',
    };
  }

  return compareRunStructures(input.mode, input.control.structure, input.noOp.structure);
}

export function compareRunStructures(
  mode: NeutralityMode,
  control: RunStructure,
  noOp: RunStructure,
): NeutralityResult {
  const base = { mode };
  if (!recordsEqual(control.perCheck, noOp.perCheck)) {
    return failed(base, 'perCheck', control.perCheck, noOp.perCheck,
      'named verifier checks diverged');
  }
  const modelCallLimit = mode === 'strict' ? 0 : 2;
  if (Math.abs(control.modelCalls - noOp.modelCalls) > modelCallLimit) {
    return failed(base, 'modelCalls', control.modelCalls, noOp.modelCalls,
      `model call difference exceeds ${modelCallLimit}`);
  }

  const divergence = firstDivergence(control.toolSequence, noOp.toolSequence);
  if (mode === 'strict' && divergence !== undefined) {
    return failed(base, 'toolSequence', control.toolSequence, noOp.toolSequence,
      'tool sequences diverged', divergence + 1);
  }
  if (mode === 'tolerant' && sharedPrefixRatio(control.toolSequence, noOp.toolSequence) < 0.8) {
    return failed(base, 'toolSequence', control.toolSequence, noOp.toolSequence,
      'tool sequence shared prefix is below 80%', (divergence ?? 0) + 1);
  }

  const boundaryCountsMatch = mode === 'strict'
    ? arraysEqual(control.boundaryMsgCounts, noOp.boundaryMsgCounts)
    : control.boundaryMsgCounts.length === noOp.boundaryMsgCounts.length;
  if (!boundaryCountsMatch) {
    const boundaryDivergence = firstDivergence(control.boundaryMsgCounts, noOp.boundaryMsgCounts);
    return failed(base, 'boundaryMsgCounts', control.boundaryMsgCounts, noOp.boundaryMsgCounts,
      mode === 'strict'
        ? 'boundary message counts diverged'
        : 'control and no-op observed different boundary counts',
      boundaryDivergence === undefined ? undefined : boundaryDivergence + 1);
  }

  return {
    ...base,
    neutral: true,
    reason: mode === 'strict'
      ? 'control and no-op structures match exactly'
      : 'control and no-op structures satisfy tolerant thresholds',
  };
}

export async function writeJspaceRunArtifacts(outputDir: string, artifacts: {
  featureManifest: EvalFeatureManifest;
  compactionEvents: unknown;
  usageEvents: unknown;
  toolTrace: unknown;
  verifierResult: unknown;
  sandboxPath?: string;
  model?: unknown;
  providerRequestAudit?: unknown;
  runStructure?: unknown;
  thinkingEvidence?: unknown;
  runValidity?: unknown;
  effectiveParams?: unknown;
  tokenUsage?: unknown;
  contextVolume?: unknown;
  compactionSummaries?: Record<string, string>;
  postCompactionPrompts?: Record<string, string>;
  resultScope?: 'pipeline_only' | 'formal_eval';
}): Promise<void> {
  const textArtifacts = [
    ...boundaryTextArtifacts('compaction-summary', artifacts.compactionSummaries),
    ...boundaryTextArtifacts('post-compaction-prompt', artifacts.postCompactionPrompts),
  ];
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeJson(join(outputDir, 'feature-manifest.json'), artifacts.featureManifest),
    writeJson(join(outputDir, 'compaction-events.json'), artifacts.compactionEvents),
    writeJson(join(outputDir, 'usage-events.json'), artifacts.usageEvents),
    writeJson(join(outputDir, 'tool-trace.json'), artifacts.toolTrace),
    writeJson(join(outputDir, 'verifier-result.json'), artifacts.verifierResult),
    writeJson(join(outputDir, 'model.json'), artifacts.model ?? null),
    writeJson(join(outputDir, 'provider-request-audit.json'), artifacts.providerRequestAudit ?? []),
    writeJson(join(outputDir, 'run-structure.json'), artifacts.runStructure ?? null),
    writeJson(join(outputDir, 'thinking-evidence.json'), artifacts.thinkingEvidence ?? null),
    writeJson(join(outputDir, 'run-validity.json'), artifacts.runValidity ?? null),
    writeJson(join(outputDir, 'effective-params.json'), artifacts.effectiveParams ?? null),
    writeJson(join(outputDir, 'token-usage.json'), artifacts.tokenUsage ?? null),
    writeJson(join(outputDir, 'context-volume.json'), artifacts.contextVolume ?? null),
    writeJson(join(outputDir, 'run.json'), {
      sandboxPath: artifacts.sandboxPath,
      result_scope: artifacts.resultScope ?? 'formal_eval',
    }),
    ...textArtifacts.map(({ filename, content }) =>
      writeFile(join(outputDir, filename), `${content}\n`, 'utf8')),
  ]);
}

function boundaryTextArtifacts(
  prefix: string,
  values: Record<string, string> | undefined,
): Array<{ filename: string; content: string }> {
  return Object.entries(values ?? {}).map(([boundary, content]) => ({
    filename: `${prefix}-${boundary.replace(/[^a-zA-Z0-9._-]/gu, '-')}.txt`,
    content,
  }));
}

function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/^student_/, '');
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function firstDivergence<T>(left: T[], right: T[]): number | undefined {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    if (left[index] !== right[index]) return index;
  }
  return undefined;
}

function sharedPrefixRatio(left: string[], right: string[]): number {
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) return 1;
  return (firstDivergence(left, right) ?? maxLength) / maxLength;
}

function arraysEqual<T>(left: T[], right: T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function recordsEqual(left: Record<string, boolean>, right: Record<string, boolean>): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return arraysEqual(leftKeys, rightKeys) && leftKeys.every((key) => left[key] === right[key]);
}

function failed(
  base: { mode: NeutralityMode },
  failedOn: NonNullable<NeutralityResult['failedOn']>,
  control: unknown,
  noOp: unknown,
  reason: string,
  divergedAtStep?: number,
): NeutralityResult {
  return {
    ...base,
    neutral: false,
    failedOn,
    ...(divergedAtStep === undefined ? {} : { divergedAtStep }),
    control,
    noOp,
    reason,
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
