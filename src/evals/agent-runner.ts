import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentEvent } from '@mariozechner/pi-agent-core';
import { getModels, type Api, type Model } from '@mariozechner/pi-ai';
import { loadEnvFile } from '../core/env.js';
import { loadStudentAgentConfig, GLOBAL_CONFIG_DIR } from '../core/config/loader.js';
import type { StudentAgentConfig } from '../core/config/types.js';
import { getApiKeyEnvName, normalizeProviderApiKeyEnv } from '../core/setup/initializer.js';
import { createStudentSession, type StudentAgentHooks } from '../core/pi-bridge/session-factory.js';
import { buildPlanningPrompt, buildPlanningRepairPrompt, buildPhaseExecutionPrompt } from '../core/task-planner/planning-prompt.js';
import { parsePhaseSignal } from '../core/task-planner/phase-signal.js';
import { TasksManager } from '../memory/tasks/manager.js';
import type { Task } from '../memory/tasks/types.js';
import type {
  EvalTaskDefinition,
  EvalTaskStateTrace,
  EvalTokenUsage,
  StudentAgentEvalTrace,
  ToolTraceEntry,
} from './types.js';

export interface RunStudentAgentEvalOptions {
  task: EvalTaskDefinition;
  sandboxDir: string;
  instruction?: string;
  memoryDir?: string;
  buildMemoryPrompt?: () => Promise<string>;
}

export async function runStudentAgentEval(options: RunStudentAgentEvalOptions): Promise<StudentAgentEvalTrace> {
  const instruction = options.instruction ?? await readFile(options.task.instructionPath, 'utf8');
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const toolCalls: ToolTraceEntry[] = [];
  const outputCollector = new AssistantTextCollector();
  let taskState: EvalTaskStateTrace | undefined;
  let errorMessage: string | undefined;

  try {
    if (options.memoryDir) {
      TasksManager.resetInstance();
      TasksManager.getInstance(options.memoryDir);
    }
    const config = await loadEvalConfig(options.sandboxDir);
    const model = buildModel(config);
    normalizeProviderApiKeyEnv(config.model.provider);
    const apiKey = process.env[getApiKeyEnvName(config.model.provider)];
    const hooks = createTracingHooks(toolCalls);
    if (options.buildMemoryPrompt) {
      hooks.buildMemoryPrompt = options.buildMemoryPrompt;
    }
    const { session, agent } = await createStudentSession({
      cwd: options.sandboxDir,
      model,
      hooks,
      apiKey,
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

    const unsubscribe = agent.subscribe((event) => outputCollector.handleEvent(event));
    try {
      if (options.task.mode === 'task') {
        taskState = await runTaskMode(session, agent, instruction);
      } else {
        await session.prompt(instruction);
        await agent.waitForIdle();
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
  return {
    taskId: options.task.id,
    mode: options.task.mode,
    instruction,
    startedAt,
    endedAt: new Date(endedMs).toISOString(),
    durationMs: endedMs - startedMs,
    status: errorMessage ? 'failed' : 'success',
    finalOutput: outputCollector.text(),
    errorMessage,
    toolCalls,
    tokenUsage: outputCollector.usage(),
    taskState,
  };
}

async function runTaskMode(
  session: Awaited<ReturnType<typeof createStudentSession>>['session'],
  agent: Awaited<ReturnType<typeof createStudentSession>>['agent'],
  instruction: string,
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
    const phaseUnsub = agent.subscribe((event) => phaseOutput.handleEvent(event));
    try {
      await session.prompt(buildPhaseExecutionPrompt(active.name, phase.description, active.active_phase_index, active.phases.length));
      await agent.waitForIdle();
    } finally {
      phaseUnsub();
    }
    const signal = parsePhaseSignal(phaseOutput.text());
    if (signal?.type !== 'phase_done') break;
    await tasks.completePhase(active.id);
    active = await tasks.getActive();
  }
  return serializeTaskState(task);
}

function isValidTaskStartSignal(signal: ReturnType<typeof parsePhaseSignal>): boolean {
  return signal?.type === 'task_start' && signal.phases.length > 0;
}

function createTracingHooks(toolCalls: ToolTraceEntry[]): StudentAgentHooks {
  const byId = new Map<string, ToolTraceEntry>();
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
      return undefined;
    },
    onAfterToolCall: async (ctx) => {
      const entry = byId.get(ctx.toolCallId);
      if (!entry) return undefined;
      const ended = Date.now();
      const started = Date.parse(entry.startedAt);
      entry.endedAt = new Date(ended).toISOString();
      entry.durationMs = Number.isFinite(started) ? ended - started : undefined;
      entry.isError = ctx.isError;
      entry.resultText = ctx.resultText.slice(0, 4_000);
      return undefined;
    },
  };
}

export class AssistantTextCollector {
  private readonly completedMessages: string[] = [];
  private readonly tokenUsage: EvalTokenUsage = emptyTokenUsage();
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

  usage(): EvalTokenUsage {
    return cloneTokenUsage(this.tokenUsage);
  }

  private captureUsage(event: AgentEvent): void {
    const record = event as unknown as Record<string, unknown>;
    if (!isRecord(record.message)) return;
    const message = record.message;
    if (message.role !== 'assistant' || !isRecord(message.usage)) return;
    addUsage(this.tokenUsage, message.usage);
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
  await loadEnvFile({ cwd: GLOBAL_CONFIG_DIR, filename: '.env', override: true });
  const initial = await loadStudentAgentConfig({ cwd });
  await loadEnvFile({ cwd, filename: initial.envFile, override: true });
  return loadStudentAgentConfig({ cwd });
}

function buildModel(config: StudentAgentConfig): Model<Api> {
  const models = getModels(config.model.provider as never) as Model<Api>[];
  const model = models.find((candidate) => candidate.id === config.model.name);
  if (model) {
    return { ...model, baseUrl: config.model.baseUrl ?? model.baseUrl };
  }
  const api = (config.model.api as Api | undefined) ?? 'openai-completions';
  return {
    id: config.model.name,
    name: config.model.name,
    api,
    provider: config.model.provider,
    baseUrl: config.model.baseUrl ?? 'https://api.openai.com/v1',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
    compat: { supportsDeveloperRole: false },
  };
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
