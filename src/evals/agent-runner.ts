import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '../core/pi-compat/index.js';
import { loadEnvFile } from '../core/env.js';
import { loadStudentAgentConfig, GLOBAL_CONFIG_DIR } from '../core/config/loader.js';
import type { StudentAgentConfig } from '../core/config/types.js';
import { isDegradedFallbackModel, resolveConfiguredModel } from '../core/config/model-resolver.js';
import { getApiKeyEnvName, normalizeProviderApiKeyEnv } from '../core/setup/initializer.js';
import { createStudentSession, type StudentAgentHooks } from '../core/pi-bridge/session-factory.js';
import { createContext7QueryToolDefinition } from '../core/pi-bridge/context7-query-tool.js';
import { drainProtectedEvents } from '../core/hashline/index.js';
import { createToolGuardHook } from '../extension/hooks/tool-guard.js';
import { FailureEscalationContext } from '../extension/hooks/failure-escalation.js';
import type { FailureEscalationEvent } from '../extension/hooks/failure-escalation.js';
import { Context7Client } from '../knowledge/context7-client.js';
import { createSignalPipeline } from '../memory/signals/index.js';
import { RunArchiveWriter } from '../memory/run-archive/index.js';
import { buildRecallCitationAudit } from '../memory/recall/citation.js';
import { ProjectKbManager } from '../memory/project-kb/manager.js';
import {
  buildPlanningPrompt,
  buildPlanningRepairPrompt,
  buildPhaseExecutionPrompt,
  isReadOnlyAnalysisPhase,
} from '../core/task-planner/planning-prompt.js';
import { parsePhaseSignal } from '../core/task-planner/phase-signal.js';
import { TasksManager } from '../memory/tasks/manager.js';
import type { Task } from '../memory/tasks/types.js';
import type {
  EvalContextAssemblyTrace,
  EvalFeatureManifest,
  EvalModelTrace,
  EvalTaskDefinition,
  EvalPiSchemaTrace,
  EvalTaskStateTrace,
  EvalTokenUsageEvent,
  EvalTokenUsage,
  StudentAgentEvalTrace,
  ToolTraceEntry,
} from './types.js';
import { ForcedCompactionController } from './forced-compaction-controller.js';
import {
  formatWriteLessonHarvestPrompt,
  shouldHarvestWriteLessons,
} from '../memory/lessons/write-lesson-instruction.js';
import { buildContextTokenEffect } from './context-breakdown.js';
import {
  installEvalProviderRequestPolicy,
  type EvalFrozenSampling,
  type EvalProviderRequestPolicyHandle,
} from './provider-request-policy.js';
import {
  beginEvalLearningRun,
  type EvalLearningRunRef,
} from './eval-learning-lifecycle.js';

const MAX_DIRECT_CONTINUATIONS = 2;
const MAX_PHASE_CONTINUATIONS = 2;
const MUTATING_TOOL_NAMES = new Set(['edit', 'write', 'apply_patch']);
const SCHEMA_TOKEN_CHAR_RATIO = 3.5;

export interface RunStudentAgentEvalOptions {
  task: EvalTaskDefinition;
  sandboxDir: string;
  instruction?: string;
  memoryDir?: string;
  buildMemoryPrompt?: () => Promise<string>;
  learningLifecycle?: boolean;
  forceCompactionAfterPhases?: number[];
  observeCompactionAfterPhases?: number[];
  featureManifest?: EvalFeatureManifest;
  predeclaredTask?: { name: string; phases: string[] };
  /** Deterministic benchmark payload appended to selected 1-based task phases. */
  phaseContextPayloads?: Record<number, string>;
  maxModelCallsPerPhase?: number;
  maxWallClockMsPerPhase?: number;
  providerUsageTimelinePath?: string;
}

export async function runStudentAgentEval(options: RunStudentAgentEvalOptions): Promise<StudentAgentEvalTrace> {
  drainProtectedEvents();
  const instruction = options.instruction ?? await readFile(options.task.instructionPath, 'utf8');
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const toolCalls: ToolTraceEntry[] = [];
  let outputCollector = new AssistantTextCollector();
  let piSchemaTrace: EvalPiSchemaTrace | undefined;
  let taskState: EvalTaskStateTrace | undefined;
  let errorMessage: string | undefined;
  let modelTrace: EvalModelTrace | undefined;
  let learningRun: EvalLearningRunRef | undefined;
  let compaction: ForcedCompactionController | undefined;
  let providerPolicy: EvalProviderRequestPolicyHandle | undefined;
  let skillManifest: import('./types.js').EvalSkillManifest | undefined;
  const protectedEventsDuringRun: import('./types.js').ProtectedEvalEvent[] = [];
  const failureEscalationEvents: FailureEscalationEvent[] = [];
  const ctx7Counters = { calls: 0, failures: 0 };
  let harvestTurn = false;

  try {
    if (options.memoryDir) {
      TasksManager.resetInstance();
      TasksManager.getInstance(options.memoryDir);
    }
    const config = await loadEvalConfig(options.sandboxDir);
    const model = buildModel(config);
    const frozenSampling = readFrozenSamplingFromEnv(process.env.STUDENT_AGENT_EVAL_FROZEN_SAMPLING);
    const costRates: CostRates = {
      input: model.cost?.input ?? 0,
      output: model.cost?.output ?? 0,
      cacheRead: model.cost?.cacheRead ?? 0,
      cacheWrite: model.cost?.cacheWrite ?? 0,
    };
    outputCollector = new AssistantTextCollector(costRates);
    modelTrace = summarizeEvalModel(model);
    providerPolicy = installEvalProviderRequestPolicy(model, globalThis, {
      usageTimelinePath: options.providerUsageTimelinePath,
      frozenSampling,
    });
    normalizeProviderApiKeyEnv(config.model.provider);
    const apiKeyEnvName = config.model.apiKeyEnv ?? getApiKeyEnvName(config.model.provider);
    const apiKey = process.env[apiKeyEnvName];
    if (!apiKey) {
      throw new Error(`Eval missing API key for ${config.model.provider} via ${apiKeyEnvName}`);
    }
    if (options.learningLifecycle) {
      if (!options.memoryDir) {
        throw new Error('Eval learning lifecycle requires memoryDir');
      }
      learningRun = await beginEvalLearningRun(options.memoryDir);
    }
    const context7Client = config.features.context7
      ? new Context7Client({
        apiKey: config.context7.apiKey,
        timeoutMs: config.context7.timeoutMs,
        maxDocsChars: config.context7.maxDocsChars,
        projectKb: options.memoryDir
          ? ProjectKbManager.getInstance(options.memoryDir)
          : undefined,
      })
      : undefined;
    const context7QueryTool = createEvalContext7Tool({
      enabled: config.features.context7,
      client: context7Client,
      counters: ctx7Counters,
    });
    const hooks = createEvalTracingHooks(toolCalls, {
      ...(learningRun ? {
        memoryDir: options.memoryDir,
        learningRun,
        onProtectedEvents: (events: import('./types.js').ProtectedEvalEvent[]) => {
          protectedEventsDuringRun.push(...events);
        },
      } : {}),
      failureEscalation: {
        context7Client,
        taskDescription: instruction,
        cwd: options.sandboxDir,
      },
      onFailureEscalationEvent: (event) => failureEscalationEvents.push(event),
    });
    if (options.buildMemoryPrompt) {
      hooks.buildMemoryPrompt = options.buildMemoryPrompt;
    }
    const { session, agent, writeLessonArcs } = await createStudentSession({
      cwd: options.sandboxDir,
      model,
      hooks,
      apiKey,
      projectArchive: config.features.projectArchive,
      llm: {
        timeoutMs: config.llm.requestTimeoutMs,
        maxTokens: frozenSampling?.maxTokens ?? config.llm.maxOutputTokens,
        maxRetries: config.llm.maxRetries,
        maxRetryDelayMs: config.llm.maxRetryDelayMs,
        apiKey,
      },
      piOptions: {
        agentDir: join(options.sandboxDir, '.pi'),
        ...(context7QueryTool ? { customTools: [context7QueryTool] } : {}),
      },
      // Eval skill isolation: only load from controlled fixtures (empty dir = no skills).
      controlledSkillRoots: [resolveEvalSkillsRoot()],
      ...(options.memoryDir ? {
        writeLesson: {
          memoryDir: options.memoryDir,
          getTaskId: () => options.task.id,
          getSessionRef: () => learningRun?.runId ?? options.task.id,
        },
      } : {}),
    });
    skillManifest = await buildSkillManifest([resolveEvalSkillsRoot()]);
    piSchemaTrace = summarizePiToolSchema(agent.state.tools);
    modelTrace = {
      ...modelTrace,
      thinking: summarizeEvalThinking(session),
    };
    const unsubscribeThinking = session.subscribe((event) => {
      if (event.type !== 'thinking_level_changed') return;
      modelTrace!.thinking!.changes.push({
        at: new Date().toISOString(),
        level: event.level,
      });
    });
    compaction = new ForcedCompactionController(
      session,
      new Set(options.forceCompactionAfterPhases ?? []),
      new Set(options.observeCompactionAfterPhases ?? options.forceCompactionAfterPhases ?? []),
      (boundary) => providerPolicy?.captureNextPrompt(boundary),
    );

    const unsubscribe = agent.subscribe((event) => outputCollector.handleEvent(event));
    try {
      if (options.task.mode === 'task') {
        taskState = await runTaskMode(session, agent, instruction, toolCalls, compaction, {
          predeclaredTask: options.predeclaredTask,
          phaseContextPayloads: options.phaseContextPayloads,
          maxModelCallsPerPhase: options.maxModelCallsPerPhase,
          maxWallClockMsPerPhase: options.maxWallClockMsPerPhase,
          getModelCallCount: () => outputCollector.usageEvents().length,
        });
      } else {
        await runDirectMode(session, agent, instruction, options.task.expectedFiles, toolCalls);
      }
      if (shouldHarvestWriteLessons(toolCalls, writeLessonArcs.unclaimedIds())) {
        harvestTurn = true;
        await session.prompt(formatWriteLessonHarvestPrompt(writeLessonArcs.unclaimedIds()));
        await agent.waitForIdle();
      }
      if (agent.state.errorMessage) {
        errorMessage = agent.state.errorMessage;
      }
      if (providerPolicy.active && providerPolicy.audit.length === 0) {
        throw new Error(
          'Eval provider policy did not observe any GLM provider request; refusing an unverified thinking run',
        );
      }
    } finally {
      unsubscribe();
      unsubscribeThinking();
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  } finally {
    try {
      await providerPolicy?.flush();
    } finally {
      providerPolicy?.restore();
    }
  }

  const endedMs = Date.now();
  const usageEvents = outputCollector.usageEvents();
  const protectedEvents = [...protectedEventsDuringRun, ...drainProtectedEvents()];
  const finalPiSchemaTrace = piSchemaTrace
    ? withPiSchemaRequestCount(piSchemaTrace, usageEvents.length)
    : undefined;
  const contextAssemblyTraces = getContextAssemblyTraces(options.buildMemoryPrompt);
  const citationResult = buildRecallCitationAudit({
    messages: outputCollector.messages(),
    contexts: (contextAssemblyTraces ?? []).map((trace) => ({
      items: trace.recall?.items.map((item) => ({ id: item.id, kind: item.kind })) ?? [],
    })),
  });
  const workingMemorySnapshot = options.memoryDir
    ? await getActiveWorkingMemorySnapshot(options.memoryDir)
    : undefined;
  return {
    taskId: options.task.id,
    mode: options.task.mode,
    instruction,
    startedAt,
    endedAt: new Date(endedMs).toISOString(),
    durationMs: endedMs - startedMs,
    status: errorMessage ? 'failed' : 'success',
    finalOutput: citationResult.cleanedMessages.join(''),
    errorMessage,
    turnCount: usageEvents.length,
    toolCalls,
    tokenUsage: outputCollector.usage(),
    usageEvents,
    piSchemaTrace: finalPiSchemaTrace,
    contextAssemblyTraces,
    recallAudit: citationResult.audit,
    contextTokenEffect: buildContextTokenEffect({
      contextAssemblyTraces,
      usageEvents,
      piSchemaTrace: finalPiSchemaTrace,
      instruction,
    }),
    model: modelTrace,
    workingMemorySnapshot,
    taskState,
    featureManifest: options.featureManifest,
    skillManifest,
    compactionEvents: compaction?.events,
    compactionSummaries: compaction?.summaries,
    providerRequestAudit: providerPolicy?.audit,
    providerUsageTimeline: providerPolicy?.usageTimeline,
    postCompactionPrompts: providerPolicy?.postCompactionPrompts,
    protectedEvents,
    guardRuleCounts: countGuardRules(protectedEvents),
    failureEscalationEvents,
    ctx7Calls: ctx7Counters.calls,
    ctx7Failures: ctx7Counters.failures,
    harvestTurn,
    learningRun,
  };
}

/** Eval-only helper: register proactive context7_query tool when the feature is enabled. */
export function createEvalContext7Tool(options: {
  enabled: boolean;
  client?: Pick<Context7Client, 'query'>;
  counters: { calls: number; failures: number };
}): ReturnType<typeof createContext7QueryToolDefinition> | undefined {
  if (!options.enabled) return undefined;
  return createContext7QueryToolDefinition({
    client: options.client,
    onCall: () => {
      options.counters.calls += 1;
    },
    onFailure: () => {
      options.counters.failures += 1;
    },
  });
}

export function readFrozenSamplingFromEnv(value: string | undefined): EvalFrozenSampling | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as Partial<EvalFrozenSampling>;
  if (typeof parsed.model !== 'string' || typeof parsed.thinking !== 'string'
    || !Number.isFinite(parsed.temperature) || !Number.isFinite(parsed.topP)
    || !Number.isInteger(parsed.maxTokens) || (parsed.maxTokens ?? 0) <= 0) {
    throw new Error('STUDENT_AGENT_EVAL_FROZEN_SAMPLING is invalid');
  }
  return parsed as EvalFrozenSampling;
}

export function summarizeEvalModel(model: Model<Api>): EvalModelTrace {
  return {
    id: model.id,
    provider: model.provider,
    api: model.api,
    baseUrl: model.baseUrl,
    pricingUsdPerMillionTokens: {
      input: model.cost?.input ?? 0,
      output: model.cost?.output ?? 0,
      cacheRead: model.cost?.cacheRead ?? 0,
      cacheWrite: model.cost?.cacheWrite ?? 0,
    },
  };
}

export function summarizeEvalThinking(session: {
  thinkingLevel: string;
  supportsThinking: () => boolean;
  getAvailableThinkingLevels: () => readonly string[];
}): NonNullable<EvalModelTrace['thinking']> {
  return {
    initialLevel: session.thinkingLevel,
    supportsThinking: session.supportsThinking(),
    availableLevels: [...session.getAvailableThinkingLevels()],
    changes: [],
  };
}

export async function getActiveWorkingMemorySnapshot(
  memoryDir: string,
): Promise<Task['working_memory'] | undefined> {
  try {
    const active = await TasksManager.getInstance(memoryDir).getActive();
    return active
      ? JSON.parse(JSON.stringify(active.working_memory)) as Task['working_memory']
      : undefined;
  } catch {
    return undefined;
  }
}

function getContextAssemblyTraces(
  buildMemoryPrompt: RunStudentAgentEvalOptions['buildMemoryPrompt'],
): EvalContextAssemblyTrace[] | undefined {
  const maybeTraced = buildMemoryPrompt as
    | (RunStudentAgentEvalOptions['buildMemoryPrompt'] & {
      contextAssemblyTraces?: EvalContextAssemblyTrace[];
    })
    | undefined;
  const traces = maybeTraced?.contextAssemblyTraces;
  return traces && traces.length > 0
    ? JSON.parse(JSON.stringify(traces)) as EvalContextAssemblyTrace[]
    : undefined;
}

export function summarizePiToolSchema(
  tools: Array<{ name: string; description?: string; parameters?: unknown }>,
): EvalPiSchemaTrace {
  const perTool = tools.map((tool) => {
    const schemaChars = JSON.stringify({
      name: tool.name,
      description: tool.description ?? '',
      input_schema: normalizeToolParameters(tool.parameters),
    }).length;
    return {
      name: tool.name,
      schemaChars,
      approxSchemaTokens: estimateSchemaTokens(schemaChars),
    };
  });
  const schemaChars = perTool.reduce((sum, tool) => sum + tool.schemaChars, 0);
  const approxSchemaTokens = perTool.reduce((sum, tool) => sum + tool.approxSchemaTokens, 0);
  return {
    toolCount: tools.length,
    toolNames: tools.map((tool) => tool.name),
    schemaChars,
    approxSchemaTokens,
    llmRequestCount: 0,
    estimatedSchemaInjectionCount: 0,
    estimatedTotalSchemaTokens: 0,
    perTool,
    note: 'Estimated from active Pi tools and assistant message_end count; provider SDK sends tools with each LLM request while tools are active.',
  };
}

function withPiSchemaRequestCount(
  trace: EvalPiSchemaTrace,
  llmRequestCount: number,
): EvalPiSchemaTrace {
  return {
    ...trace,
    llmRequestCount,
    estimatedSchemaInjectionCount: trace.toolCount > 0 ? llmRequestCount : 0,
    estimatedTotalSchemaTokens: trace.approxSchemaTokens * (trace.toolCount > 0 ? llmRequestCount : 0),
  };
}

function normalizeToolParameters(parameters: unknown): unknown {
  if (parameters === undefined || parameters === null) {
    return { type: 'object', properties: {} };
  }
  return parameters;
}

function estimateSchemaTokens(schemaChars: number): number {
  return Math.ceil(schemaChars / SCHEMA_TOKEN_CHAR_RATIO);
}

async function runDirectMode(
  session: Awaited<ReturnType<typeof createStudentSession>>['session'],
  agent: Awaited<ReturnType<typeof createStudentSession>>['agent'],
  instruction: string,
  expectedFiles: string[],
  toolCalls: ToolTraceEntry[],
): Promise<void> {
  await session.prompt(instruction);
  await agent.waitForIdle();

  let continuationCount = 0;
  while (shouldContinueDirectRun({ toolCalls, expectedFiles, continuationCount })) {
    continuationCount++;
    await session.prompt(buildDirectContinuationPrompt(expectedFiles));
    await agent.waitForIdle();
  }
}

async function runTaskMode(
  session: Awaited<ReturnType<typeof createStudentSession>>['session'],
  agent: Awaited<ReturnType<typeof createStudentSession>>['agent'],
  instruction: string,
  toolCalls: ToolTraceEntry[],
  compaction: ForcedCompactionController,
  limits: {
    predeclaredTask?: { name: string; phases: string[] };
    phaseContextPayloads?: Record<number, string>;
    maxModelCallsPerPhase?: number;
    maxWallClockMsPerPhase?: number;
    getModelCallCount: () => number;
  },
): Promise<EvalTaskStateTrace> {
  TasksManager.resetInstance();
  const tasks = TasksManager.getInstance(':memory:');
  let task: Task;
  if (limits.predeclaredTask) {
    task = await tasks.createTask(limits.predeclaredTask.name, limits.predeclaredTask.phases);
  } else {
    const planningOutput = new AssistantTextCollector();
    const planningUnsub = agent.subscribe((event) => planningOutput.handleEvent(event));
    try {
      await session.prompt(buildPlanningPrompt(instruction));
      await agent.waitForIdle();
    } finally {
      planningUnsub();
    }

    let planSignal = parsePhaseSignal(planningOutput.text());
    if (!isValidTaskStartSignal(planSignal)) {
    const repairOutput = new AssistantTextCollector();
    const repairUnsub = agent.subscribe((event) => repairOutput.handleEvent(event));
    try {
      await session.prompt(buildPlanningRepairPrompt(instruction));
      await agent.waitForIdle();
    } finally {
      repairUnsub();
    }
      planSignal = parsePhaseSignal(repairOutput.text());
    }
    if (!planSignal || planSignal.type !== 'task_start' || planSignal.phases.length === 0) {
      return { status: 'planning_failed', phaseCount: 0, phases: [] };
    }
    task = await tasks.createTask(planSignal.name, planSignal.phases);
  }
  let active: Task | null = task;
  let guard = 0;
  while (active && guard < 6) {
    guard++;
    const phase = active.phases[active.active_phase_index];
    if (!phase) break;
    compaction.noteNextPhaseStarted(active.active_phase_index + 1);
    const phaseOutput = new AssistantTextCollector();
    const phaseStartedMs = Date.now();
    const callsBeforePhase = limits.getModelCallCount();
    let signal: ReturnType<typeof parsePhaseSignal> = null;
    let continuationCount = 0;
    while (true) {
      const phaseUnsub = agent.subscribe((event) => phaseOutput.handleEvent(event));
      let budgetResult: { completed: boolean; modelCallBudgetExceeded: boolean };
      try {
        const phasePrompt = continuationCount === 0
          ? buildPhaseExecutionPrompt(active.name, phase.description, active.active_phase_index, active.phases.length)
          : buildPhaseContinuationPrompt(active.active_phase_index + 1, phase.description);
        const prompt = limits.predeclaredTask && continuationCount === 0
          ? buildPredeclaredPhasePrompt({
            instruction,
            phasePrompt,
            phaseIndex: active.active_phase_index,
            contextPayload: limits.phaseContextPayloads?.[active.active_phase_index + 1],
          })
          : phasePrompt;
        budgetResult = await promptWithinPhaseBudget({
          session,
          agent,
          prompt,
          phaseStartedMs,
          maxWallClockMs: limits.maxWallClockMsPerPhase,
          maxModelCalls: limits.maxModelCallsPerPhase,
        });
        if (!budgetResult.completed) return { ...serializeTaskState(task), status: 'phase_wall_clock_exceeded' };
      } finally {
        phaseUnsub();
      }
      signal = parsePhaseSignal(phaseOutput.text());
      if (signal?.type === 'phase_done') break;
      if (budgetResult.modelCallBudgetExceeded) {
        return { ...serializeTaskState(task), status: 'phase_model_call_budget_exceeded' };
      }
      if (limits.maxModelCallsPerPhase !== undefined &&
        limits.getModelCallCount() - callsBeforePhase >= limits.maxModelCallsPerPhase) {
        return { ...serializeTaskState(task), status: 'phase_model_call_budget_exceeded' };
      }
      if (!shouldContinuePhaseRun({
        phaseText: phaseOutput.text(),
        continuationCount,
        toolCallCount: toolCalls.length,
      })) {
        break;
      }
      continuationCount++;
    }
    if (signal?.type !== 'phase_done') break;
    const completedPhaseNumber = active.active_phase_index + 1;
    await tasks.completePhase(active.id);
    compaction.observeBoundary(completedPhaseNumber);
    if (compaction.shouldCompactAfterPhase(completedPhaseNumber)) {
      await compaction.compactAfterPhase(completedPhaseNumber);
    }
    active = await tasks.getActive();
  }
  return serializeTaskState(task);
}

async function promptWithinPhaseBudget(options: {
  session: Awaited<ReturnType<typeof createStudentSession>>['session'];
  agent: Awaited<ReturnType<typeof createStudentSession>>['agent'];
  prompt: string;
  phaseStartedMs: number;
  maxWallClockMs?: number;
  maxModelCalls?: number;
}): Promise<{ completed: boolean; modelCallBudgetExceeded: boolean }> {
  let modelCalls = 0;
  let exceededModelCallBudget = false;
  const unsubscribe = options.agent.subscribe((event) => {
    if (!isAssistantMessageEnd(event)) return;
    modelCalls++;
    if (options.maxModelCalls !== undefined && shouldAbortForModelCallBudget(modelCalls, options.maxModelCalls)) {
      exceededModelCallBudget = true;
      options.session.abort();
    }
  });
  const run = async () => {
    await options.session.prompt(options.prompt);
    await options.agent.waitForIdle();
  };
  if (options.maxWallClockMs === undefined) {
    try {
      try {
        await run();
      } catch (error) {
        if (!exceededModelCallBudget) throw error;
      }
      return { completed: true, modelCallBudgetExceeded: exceededModelCallBudget };
    } finally {
      unsubscribe();
    }
  }
  const remainingMs = options.maxWallClockMs - (Date.now() - options.phaseStartedMs);
  if (remainingMs <= 0) return { completed: false, modelCallBudgetExceeded: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const completed = await Promise.race([
      run().then(() => true).catch((error) => {
        if (exceededModelCallBudget) return true;
        throw error;
      }),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => {
          options.session.abort();
          resolve(false);
        }, remainingMs);
      }),
    ]);
    return { completed, modelCallBudgetExceeded: exceededModelCallBudget };
  } finally {
    if (timer) clearTimeout(timer);
    unsubscribe();
  }
}

export function buildPredeclaredPhasePrompt(options: {
  instruction: string;
  phasePrompt: string;
  phaseIndex: number;
  contextPayload?: string;
}): string {
  const base = options.phaseIndex === 0
    ? `${options.instruction}\n\n---\n\n${options.phasePrompt}`
    : options.phasePrompt;
  return options.contextPayload
    ? `${base}\n\n--- CONTROLLED_CONTEXT_PAYLOAD phase=${options.phaseIndex + 1} ---\n` +
      `${options.contextPayload}\n--- END_CONTROLLED_CONTEXT_PAYLOAD ---`
    : base;
}

export function shouldAbortForModelCallBudget(callCount: number, maxModelCalls: number): boolean {
  return callCount >= maxModelCalls;
}

export function shouldContinueDirectRun(options: {
  toolCalls: ToolTraceEntry[];
  expectedFiles: string[];
  continuationCount: number;
}): boolean {
  if (options.continuationCount >= MAX_DIRECT_CONTINUATIONS) return false;
  if (options.expectedFiles.length === 0) return false;
  return !options.toolCalls.some((call) => MUTATING_TOOL_NAMES.has(normalizeToolName(call.name)));
}

export function shouldContinuePhaseRun(options: {
  phaseText: string;
  continuationCount: number;
  toolCallCount?: number;
}): boolean {
  if (options.continuationCount >= MAX_PHASE_CONTINUATIONS) return false;
  return parsePhaseSignal(options.phaseText)?.type !== 'phase_done';
}

export function buildDirectContinuationPrompt(expectedFiles: string[]): string {
  const files = expectedFiles.length > 0 ? expectedFiles.join(', ') : '目标文件';
  return `你还没有完成实际文件修改。必须继续调用工具。下一条回复必须是工具调用，不要输出文字说明。

目标文件：${files}

如果刚才只读取了文件，现在优先使用 edit/write/apply_patch 修改目标文件；如果需要验证，再调用 bash。不要说“现在编辑/准备编辑”，直接发起工具调用。`;
}

export function buildPhaseContinuationPrompt(phaseNumber: number, phaseDescription: string): string {
  if (isReadOnlyAnalysisPhase(phaseDescription)) {
    return `继续执行当前 Phase ${phaseNumber}。

本 Phase 目标：${phaseDescription}

本 Phase 判定为分析/方案类：保持只读，不要调用 edit/write/apply_patch，不要修改任何文件。如果还缺事实依据，可以读取相关文件或运行只读检查；如果已经完成分析或方案，请直接输出 PHASE_DONE。

完成后输出：
[PHASE_DONE phase=${phaseNumber}]
已完成：简短说明实际完成了什么
[/PHASE_DONE]`;
  }

  return `继续执行当前 Phase ${phaseNumber}。下一条回复必须优先调用工具；不要输出文字说明。

本 Phase 目标：${phaseDescription}

你还没有输出有效 PHASE_DONE。必须继续调用工具完成真实读取、修改或验证动作；不要只解释或描述“将要做什么”。不要说“我将读取/我将修改”，直接调用 read/edit/apply_patch/bash。如果路径是 "src/foo.ts" 这类形式，直接按项目根目录相对路径调用工具，不要向用户询问路径格式。

完成真实动作后，输出：
[PHASE_DONE phase=${phaseNumber}]
已完成：简短说明实际完成了什么
[/PHASE_DONE]`;
}

function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/^student_/, '');
}

function isValidTaskStartSignal(signal: ReturnType<typeof parsePhaseSignal>): boolean {
  return signal?.type === 'task_start' && signal.phases.length > 0;
}

export function createEvalTracingHooks(
  toolCalls: ToolTraceEntry[],
  options: {
    memoryDir?: string;
    learningRun?: EvalLearningRunRef;
    onProtectedEvents?: (events: import('./types.js').ProtectedEvalEvent[]) => void;
    onFailureEscalationEvent?: (event: FailureEscalationEvent) => void;
    failureEscalation?: {
      context7Client?: Pick<Context7Client, 'query'>;
      taskDescription: string;
      cwd: string;
    };
  } = {},
): StudentAgentHooks {
  const byId = new Map<string, ToolTraceEntry>();
  const toolGuard = createToolGuardHook();
  const archive = options.learningRun && options.memoryDir
    ? new RunArchiveWriter({ memoryDir: options.memoryDir })
    : undefined;
  const signalPipeline = options.memoryDir
    ? createSignalPipeline({
      memoryDir: options.memoryDir,
      tasksManager: TasksManager.getInstance(options.memoryDir),
      onProtectedEvents: options.onProtectedEvents,
    })
    : undefined;
  const failureEscalation = options.failureEscalation
    ? new FailureEscalationContext({
      context7Client: options.failureEscalation.context7Client,
      memoryDir: options.memoryDir,
      onTrigger: options.onFailureEscalationEvent,
    })
    : undefined;
  failureEscalation?.initTask(
    options.failureEscalation?.taskDescription ?? '',
    options.failureEscalation?.cwd ?? '',
  );
  const failureEscalationHook = failureEscalation?.createHook();
  return {
    onBeforeToolCall: async (ctx) => {
      const entry: ToolTraceEntry = {
        id: ctx.toolCallId,
        name: ctx.toolName,
        args: ctx.args,
        startedAt: new Date().toISOString(),
      };
      byId.set(ctx.toolCallId, entry);
      toolCalls.push(entry);
      if (archive && options.learningRun) {
        await archive.appendEvent(options.learningRun.runId, {
          timestamp: entry.startedAt,
          kind: 'tool_call',
          summary: `${ctx.toolName} tool call`,
          toolName: ctx.toolName,
          metadata: {
            evidenceRef: ctx.toolCallId,
          },
        });
      }
      return toolGuard.hook(ctx);
    },
    onAfterToolCall: async (ctx) => {
      toolGuard.observeResult(ctx);
      await signalPipeline?.processAfterToolCall(ctx);
      const entry = byId.get(ctx.toolCallId);
      if (entry) {
        const ended = Date.now();
        const started = Date.parse(entry.startedAt);
        entry.endedAt = new Date(ended).toISOString();
        entry.durationMs = Number.isFinite(started) ? ended - started : undefined;
        entry.isError = ctx.isError;
        entry.resultText = ctx.resultText.slice(0, 4_000);
        if (ctx.isError && archive && options.learningRun) {
          await archive.appendEvent(options.learningRun.runId, {
            timestamp: entry.endedAt,
            kind: 'tool_error',
            summary: entry.resultText,
            toolName: ctx.toolName,
            metadata: {
              evidenceRef: ctx.toolCallId,
            },
          });
        }
      }
      return failureEscalationHook?.(ctx);
    },
  };
}

export function countGuardRules(
  events: Array<{ source: string; ruleName?: string; blocked?: boolean }>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    if (event.source !== 'toolguard' || !event.blocked || !event.ruleName) continue;
    counts[event.ruleName] = (counts[event.ruleName] ?? 0) + 1;
  }
  return counts;
}

export class AssistantTextCollector {
  private readonly completedMessages: string[] = [];
  private readonly tokenUsage: EvalTokenUsage = emptyTokenUsage();
  private readonly tokenUsageEvents: EvalTokenUsageEvent[] = [];
  private currentMessage = '';
  private inAssistantMessage = false;

  constructor(private readonly costRates?: CostRates) {}

  handleEvent(event: AgentEvent): void {
    if (event.type === 'message_start') {
      if (isAssistantMessageStart(event)) {
        this.inAssistantMessage = true;
        this.currentMessage = '';
      }
      return;
    }

    if (event.type === 'message_update') {
      const delta = extractTextDelta(event);
      if (delta !== null) {
        this.inAssistantMessage = true;
        this.currentMessage += delta;
        return;
      }

      const snapshot = extractAssistantTextSnapshot(event);
      if (snapshot !== null) {
        this.inAssistantMessage = true;
        this.currentMessage = snapshot;
      }
      return;
    }

    if (event.type === 'message_end') {
      this.captureUsage(event, this.costRates);
      this.commitCurrentMessage();
      return;
    }

    if (event.type === 'agent_end') {
      this.commitCurrentMessage();
    }
  }

  text(): string {
    return [...this.completedMessages, this.currentMessage].join('');
  }

  messages(): string[] {
    return [
      ...this.completedMessages,
      ...(this.currentMessage ? [this.currentMessage] : []),
    ];
  }

  usage(): EvalTokenUsage {
    return cloneTokenUsage(this.tokenUsage);
  }

  usageEvents(): EvalTokenUsageEvent[] {
    return this.tokenUsageEvents.map((event) => ({
      index: event.index,
      usage: cloneTokenUsage(event.usage),
    }));
  }

  private captureUsage(event: AgentEvent, rates?: CostRates): void {
    const record = event as unknown as Record<string, unknown>;
    if (!isRecord(record.message)) return;
    const message = record.message;
    if (message.role !== 'assistant' || !isRecord(message.usage)) return;
    const usage = usageFromRaw(message.usage, rates);
    if (typeof message.id === 'string' && message.id.trim()) {
      usage.generationId = message.id;
    }
    addUsage(this.tokenUsage, message.usage, rates);
    if (usage.generationId) this.tokenUsage.generationId = usage.generationId;
    this.tokenUsageEvents.push({
      index: this.tokenUsageEvents.length + 1,
      usage,
    });
  }

  private commitCurrentMessage(): void {
    if (!this.inAssistantMessage) return;
    this.completedMessages.push(this.currentMessage);
    this.currentMessage = '';
    this.inAssistantMessage = false;
  }
}

function extractTextDelta(event: AgentEvent): string | null {
  const record = event as unknown as Record<string, unknown>;
  if (!isRecord(record.assistantMessageEvent)) {
    return null;
  }
  const assistantEvent = record.assistantMessageEvent;
  return assistantEvent.type === 'text_delta' && typeof assistantEvent.delta === 'string'
    ? assistantEvent.delta
    : null;
}

function extractAssistantTextSnapshot(event: AgentEvent): string | null {
  const record = event as unknown as Record<string, unknown>;
  if (!isRecord(record.message)) {
    return null;
  }
  const message = record.message;
  if (message.role !== 'assistant' || !Array.isArray(message.content)) {
    return null;
  }
  const parts = message.content
    .filter((part): part is { type: 'text'; text: string } => (
      isRecord(part)
      && part.type === 'text'
      && typeof part.text === 'string'
    ))
    .map((part) => part.text);
  return parts.length > 0 ? parts.join('') : null;
}

function isAssistantMessageStart(event: AgentEvent): boolean {
  const record = event as unknown as Record<string, unknown>;
  return (
    isRecord(record.message)
    && record.message.role === 'assistant'
  );
}

function isAssistantMessageEnd(event: AgentEvent): boolean {
  const record = event as unknown as Record<string, unknown>;
  return event.type === 'message_end' && isRecord(record.message) && record.message.role === 'assistant';
}

function emptyTokenUsage(): EvalTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUsd: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
    costAuthority: 'local_estimate',
  };
}

function cloneTokenUsage(usage: EvalTokenUsage): EvalTokenUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    totalTokens: usage.totalTokens,
    costUsd: { ...usage.costUsd },
    costAuthority: usage.costAuthority,
    generationId: usage.generationId,
  };
}

function usageFromRaw(raw: Record<string, unknown>, rates?: CostRates): EvalTokenUsage {
  const usage = emptyTokenUsage();
  addUsage(usage, raw, rates);
  return usage;
}

interface CostRates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Recompute costUsd from token counters × $/MTok (ZenMux-compatible table). */
export function repriceUsageFromRates(usage: EvalTokenUsage, rates: CostRates): EvalTokenUsage {
  const input = (usage.inputTokens * rates.input) / 1_000_000;
  const output = (usage.outputTokens * rates.output) / 1_000_000;
  const cacheRead = (usage.cacheReadTokens * rates.cacheRead) / 1_000_000;
  const cacheWrite = (usage.cacheWriteTokens * rates.cacheWrite) / 1_000_000;
  return {
    ...usage,
    costUsd: {
      input: roundCost(input),
      output: roundCost(output),
      cacheRead: roundCost(cacheRead),
      cacheWrite: roundCost(cacheWrite),
      total: roundCost(input + output + cacheRead + cacheWrite),
    },
    costAuthority: 'local_estimate',
  };
}

function addUsage(target: EvalTokenUsage, raw: Record<string, unknown>, rates?: CostRates): void {
  // Prefer explicit cache write field when providers expose it (ZenMux/OpenRouter style).
  const cacheWrite = numberValue(raw.cacheWrite)
    || numberValue((isRecord(raw.prompt_tokens_details) ? raw.prompt_tokens_details.cache_write_tokens : undefined));
  const cacheRead = numberValue(raw.cacheRead)
    || numberValue((isRecord(raw.prompt_tokens_details) ? raw.prompt_tokens_details.cached_tokens : undefined));
  target.inputTokens += numberValue(raw.input);
  target.outputTokens += numberValue(raw.output);
  target.cacheReadTokens += cacheRead;
  target.cacheWriteTokens += cacheWrite;
  target.totalTokens += numberValue(raw.totalTokens);

  if (rates) {
    const priced = repriceUsageFromRates({
      inputTokens: numberValue(raw.input),
      outputTokens: numberValue(raw.output),
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      totalTokens: numberValue(raw.totalTokens),
      costUsd: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    }, rates);
    target.costUsd.input = roundCost(target.costUsd.input + priced.costUsd.input);
    target.costUsd.output = roundCost(target.costUsd.output + priced.costUsd.output);
    target.costUsd.cacheRead = roundCost(target.costUsd.cacheRead + priced.costUsd.cacheRead);
    target.costUsd.cacheWrite = roundCost(target.costUsd.cacheWrite + priced.costUsd.cacheWrite);
    target.costUsd.total = roundCost(target.costUsd.total + priced.costUsd.total);
    target.costAuthority = 'local_estimate';
    return;
  }

  const cost = isRecord(raw.cost) ? raw.cost : {};
  target.costUsd.input = roundCost(target.costUsd.input + numberValue(cost.input));
  target.costUsd.output = roundCost(target.costUsd.output + numberValue(cost.output));
  target.costUsd.cacheRead = roundCost(target.costUsd.cacheRead + numberValue(cost.cacheRead));
  target.costUsd.cacheWrite = roundCost(target.costUsd.cacheWrite + numberValue(cost.cacheWrite));
  target.costUsd.total = roundCost(target.costUsd.total + numberValue(cost.total));
  target.costAuthority = 'local_estimate';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function roundCost(value: number): number {
  return Number(value.toFixed(8));
}

async function loadEvalConfig(cwd: string): Promise<StudentAgentConfig> {
  await loadEnvFile({ cwd: GLOBAL_CONFIG_DIR, filename: '.env', override: false });
  const initial = await loadStudentAgentConfig({ cwd });
  await loadEnvFile({ cwd, filename: initial.envFile, override: false });
  return loadStudentAgentConfig({ cwd });
}

function buildModel(config: StudentAgentConfig): Model<Api> {
  const model = resolveConfiguredModel(config.model);
  if (isDegradedFallbackModel(model)) {
    throw new Error(
      `Refusing eval run: model "${config.model.provider}/${config.model.name}" is not in the pi-ai catalog `
      + 'and would fall back to degraded metadata (thinking disabled, 128k context window). '
      + 'Add the model to model-resolver.ts (see resolveZaiGlm53Model) or fix the provider profile.',
    );
  }
  return model;
}

function resolveEvalSkillsRoot(): string {
  return join(process.cwd(), 'evals/fixtures/skills');
}

async function buildSkillManifest(roots: string[]): Promise<import('./types.js').EvalSkillManifest> {
  const { readdir } = await import('node:fs/promises');
  const entries: string[] = [];
  for (const root of roots) {
    try {
      const names = await readdir(root);
      for (const name of names) entries.push(join(root, name));
    } catch {
      // empty / missing controlled root is expected
    }
  }
  return { roots, entries };
}

function serializeTaskState(task: Task): EvalTaskStateTrace {
  return {
    taskId: task.id,
    name: task.name,
    activePhaseIndex: task.active_phase_index,
    phaseCount: task.phases.length,
    status: task.status,
    workflowStatus: task.workflow_status,
    level: task.level,
    phases: task.phases.map((phase) => ({
      description: phase.description,
      status: phase.status,
      retryCount: phase.retry_count,
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
