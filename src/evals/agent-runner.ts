import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentEvent } from '@mariozechner/pi-agent-core';
import type { Api, Model } from '@mariozechner/pi-ai';
import { loadEnvFile, loadEnvLayersPreservingAmbient } from '../core/env.js';
import { loadStudentAgentConfig, GLOBAL_CONFIG_DIR } from '../core/config/loader.js';
import type { StudentAgentConfig } from '../core/config/types.js';
import { resolveConfiguredModel } from '../core/config/model-resolver.js';
import { getApiKeyEnvName, normalizeProviderApiKeyEnv } from '../core/setup/initializer.js';
import { createStudentSession, type StudentAgentHooks } from '../core/pi-bridge/session-factory.js';
import { drainProtectedEvents } from '../core/hashline/index.js';
import { createToolGuardHook } from '../extension/hooks/tool-guard.js';
import { FailureEscalationContext } from '../extension/hooks/failure-escalation.js';
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
  EvalModelTrace,
  EvalTaskDefinition,
  EvalPiSchemaTrace,
  EvalTaskStateTrace,
  EvalTokenUsageEvent,
  EvalTokenUsage,
  StudentAgentEvalTrace,
  ToolTraceEntry,
} from './types.js';
import { buildContextTokenEffect } from './context-breakdown.js';
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
}

export async function runStudentAgentEval(options: RunStudentAgentEvalOptions): Promise<StudentAgentEvalTrace> {
  drainProtectedEvents();
  const instruction = options.instruction ?? await readFile(options.task.instructionPath, 'utf8');
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const toolCalls: ToolTraceEntry[] = [];
  const outputCollector = new AssistantTextCollector();
  let piSchemaTrace: EvalPiSchemaTrace | undefined;
  let taskState: EvalTaskStateTrace | undefined;
  let errorMessage: string | undefined;
  let modelTrace: EvalModelTrace | undefined;
  let learningRun: EvalLearningRunRef | undefined;
  const protectedEventsDuringRun: import('./types.js').ProtectedEvalEvent[] = [];

  try {
    if (options.memoryDir) {
      TasksManager.resetInstance();
      TasksManager.getInstance(options.memoryDir);
    }
    const config = await loadEvalConfig(options.sandboxDir);
    const model = buildModel(config);
    modelTrace = summarizeEvalModel(model);
    normalizeProviderApiKeyEnv(config.model.provider);
    const apiKey = process.env[getApiKeyEnvName(config.model.provider)];
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
    });
    if (options.buildMemoryPrompt) {
      hooks.buildMemoryPrompt = options.buildMemoryPrompt;
    }
    const { session, agent } = await createStudentSession({
      cwd: options.sandboxDir,
      model,
      hooks,
      apiKey,
      projectArchive: config.features.projectArchive,
      llm: {
        timeoutMs: config.llm.requestTimeoutMs,
        maxTokens: config.llm.maxOutputTokens,
        maxRetries: config.llm.maxRetries,
        maxRetryDelayMs: config.llm.maxRetryDelayMs,
        apiKey,
      },
      piOptions: {
        agentDir: join(options.sandboxDir, '.pi'),
      },
    });
    piSchemaTrace = summarizePiToolSchema(agent.state.tools);

    const unsubscribe = agent.subscribe((event) => outputCollector.handleEvent(event));
    try {
      if (options.task.mode === 'task') {
        taskState = await runTaskMode(session, agent, instruction, toolCalls);
      } else {
        await runDirectMode(session, agent, instruction, options.task.expectedFiles, toolCalls);
      }
      if (agent.state.errorMessage) {
        errorMessage = agent.state.errorMessage;
      }
    } finally {
      unsubscribe();
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
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
    protectedEvents,
    guardRuleCounts: countGuardRules(protectedEvents),
    learningRun,
  };
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
): Promise<EvalTaskStateTrace> {
  TasksManager.resetInstance();
  const tasks = TasksManager.getInstance(':memory:');
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

  const task = await tasks.createTask(planSignal.name, planSignal.phases);
  let active: Task | null = task;
  let guard = 0;
  while (active && guard < 6) {
    guard++;
    const phase = active.phases[active.active_phase_index];
    if (!phase) break;
    const phaseOutput = new AssistantTextCollector();
    let signal: ReturnType<typeof parsePhaseSignal> = null;
    let continuationCount = 0;
    while (true) {
      const phaseUnsub = agent.subscribe((event) => phaseOutput.handleEvent(event));
      try {
        const prompt = continuationCount === 0
          ? buildPhaseExecutionPrompt(active.name, phase.description, active.active_phase_index, active.phases.length)
          : buildPhaseContinuationPrompt(active.active_phase_index + 1, phase.description);
        await session.prompt(prompt);
        await agent.waitForIdle();
      } finally {
        phaseUnsub();
      }
      signal = parsePhaseSignal(phaseOutput.text());
      if (signal?.type === 'phase_done') break;
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
    await tasks.completePhase(active.id);
    active = await tasks.getActive();
  }
  return serializeTaskState(task);
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
      this.captureUsage(event);
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

  private captureUsage(event: AgentEvent): void {
    const record = event as unknown as Record<string, unknown>;
    if (!isRecord(record.message)) return;
    const message = record.message;
    if (message.role !== 'assistant' || !isRecord(message.usage)) return;
    const usage = usageFromRaw(message.usage);
    addUsage(this.tokenUsage, message.usage);
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
  };
}

function usageFromRaw(raw: Record<string, unknown>): EvalTokenUsage {
  const usage = emptyTokenUsage();
  addUsage(usage, raw);
  return usage;
}

function addUsage(target: EvalTokenUsage, raw: Record<string, unknown>): void {
  target.inputTokens += numberValue(raw.input);
  target.outputTokens += numberValue(raw.output);
  target.cacheReadTokens += numberValue(raw.cacheRead);
  target.cacheWriteTokens += numberValue(raw.cacheWrite);
  target.totalTokens += numberValue(raw.totalTokens);

  const cost = isRecord(raw.cost) ? raw.cost : {};
  target.costUsd.input = roundCost(target.costUsd.input + numberValue(cost.input));
  target.costUsd.output = roundCost(target.costUsd.output + numberValue(cost.output));
  target.costUsd.cacheRead = roundCost(target.costUsd.cacheRead + numberValue(cost.cacheRead));
  target.costUsd.cacheWrite = roundCost(target.costUsd.cacheWrite + numberValue(cost.cacheWrite));
  target.costUsd.total = roundCost(target.costUsd.total + numberValue(cost.total));
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function roundCost(value: number): number {
  return Number(value.toFixed(8));
}

async function loadEvalConfig(cwd: string): Promise<StudentAgentConfig> {
  await loadEnvLayersPreservingAmbient(async () => {
    await loadEnvFile({ cwd: GLOBAL_CONFIG_DIR, filename: '.env', override: true });
    const initial = await loadStudentAgentConfig({ cwd });
    await loadEnvFile({ cwd, filename: initial.envFile, override: true });
  });
  return loadStudentAgentConfig({ cwd });
}

function buildModel(config: StudentAgentConfig): Model<Api> {
  return resolveConfiguredModel(config.model);
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
