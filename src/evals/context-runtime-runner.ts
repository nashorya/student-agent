import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createContextAssemblyHook } from '../extension/hooks/context-assembly.js';
import { EVAL_AUTONOMY_RULE } from '../memory/recall/context-builder.js';
import { TasksManager } from '../memory/tasks/manager.js';
import { createEvalSandbox, diffSnapshots, readChangedFileContents, runVerifier, snapshotFiles } from './sandbox.js';
import { runStudentAgentEval } from './agent-runner.js';
import { scoreEvalRun } from './scorer.js';
import { reconcileRecallCredit } from './recall-credit-reconciler.js';
import { loadEvalTasks } from './task-loader.js';
import type { EvalRunRecord, EvalTaskDefinition } from './types.js';

export type ContextRuntimeEvalVariant = 'plain' | 'context_runtime';

export interface ContextRuntimeEvalOptions {
  tasksRoot?: string;
  resultsDir?: string;
  taskIds?: string[];
  trials?: number;
  variants?: ContextRuntimeEvalVariant[];
  keepSandboxes?: boolean;
  maxBudgetUsd?: number;
}

export type ContextRuntimeEvalRecord = EvalRunRecord & {
  variant: ContextRuntimeEvalVariant;
};

export const EVAL_PLAIN_MEMORY_PROMPT = EVAL_AUTONOMY_RULE;

export interface ContextRuntimeVariantSummary {
  variant: ContextRuntimeEvalVariant;
  runs: number;
  passed: number;
  failed: number;
  passRate: number;
  averageCorrectness: number;
  averageBehavior: number;
  totalToolCalls: number;
  failedToolCalls: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  piSchemaToolCount: number;
  piSchemaApproxTokensPerRequest: number;
  piSchemaInjectionCount: number;
  estimatedPiSchemaTokens: number;
  totalCostUsd: number;
  costPerRunUsd: number;
  costPerPassedTaskUsd: number | null;
}

export interface ContextRuntimeEvalResult {
  records: ContextRuntimeEvalRecord[];
  summaries: ContextRuntimeVariantSummary[];
  outputDir: string;
}

export async function runContextRuntimeEval(
  options: ContextRuntimeEvalOptions = {},
): Promise<ContextRuntimeEvalResult> {
  const tasks = await selectTasks(options);
  const trials = options.trials ?? 1;
  const variants = options.variants ?? ['plain', 'context_runtime'];
  const records: ContextRuntimeEvalRecord[] = [];

  outer:
  for (const variant of variants) {
    for (const task of tasks) {
      for (let trial = 1; trial <= trials; trial++) {
        if (hasReachedContextRuntimeBudget(records, options.maxBudgetUsd)) {
          break outer;
        }
        const sandbox = await createEvalSandbox(task);
        try {
          const instruction = await readFile(task.instructionPath, 'utf8');
          const memoryDir = join(sandbox.path, 'memory');
          if (variant === 'context_runtime') {
            await seedContextRuntimeEvalMemory({ memoryDir, task, instruction });
          } else {
            TasksManager.resetInstance();
          }

          const before = await snapshotFiles(sandbox.path);
          const trace = await runStudentAgentEval({
            task,
            sandboxDir: sandbox.path,
            instruction,
            memoryDir,
            buildMemoryPrompt: createContextRuntimeBuildMemoryPrompt(variant, memoryDir),
          });
          const afterAgent = await snapshotFiles(sandbox.path);
          const changedFiles = diffSnapshots(before, afterAgent);
          const modifiedFiles = await readChangedFileContents(sandbox.path, changedFiles);
          const verifier = await runVerifier(task, sandbox);
          const scored = scoreEvalRun({ task, trace, verifier, before, after: afterAgent, modifiedFiles });
          const active = variant === 'context_runtime'
            ? await TasksManager.getInstance(memoryDir).getActive()
            : null;
          const recallAttribution = active && trace.recallAudit
            ? await reconcileRecallCredit({
              memoryDir,
              taskId: task.id,
              runId: active.working_memory.runId,
              audit: trace.recallAudit,
              verificationStatus: scored.score.correctnessScore >= 1 ? 'passed' : 'failed',
              verificationRef: `context-runtime:${task.id}:trial-${trial}`,
            })
            : undefined;
          records.push({
            variant,
            taskId: task.id,
            title: task.title,
            mode: task.mode,
            trial,
            ...scored,
            ...(recallAttribution ? { recallAttribution } : {}),
          });
        } finally {
          TasksManager.resetInstance();
          if (!options.keepSandboxes) {
            await sandbox.cleanup();
          }
        }
      }
    }
  }

  const summaries = summarizeContextRuntimeRecords(records);
  const outputDir = await writeContextRuntimeReports({
    records,
    summaries,
    resultsDir: options.resultsDir,
  });

  return { records, summaries, outputDir };
}

export function hasReachedContextRuntimeBudget(
  records: ContextRuntimeEvalRecord[],
  maxBudgetUsd: number | undefined,
): boolean {
  if (maxBudgetUsd === undefined) return false;
  const totalCostUsd = records.reduce((sum, record) =>
    sum + record.trace.tokenUsage.costUsd.total, 0);
  return totalCostUsd >= maxBudgetUsd;
}

export async function seedContextRuntimeEvalMemory(options: {
  memoryDir: string;
  task: EvalTaskDefinition;
  instruction: string;
}): Promise<string> {
  TasksManager.resetInstance();
  const manager = TasksManager.getInstance(options.memoryDir);
  const now = new Date().toISOString();
  const task = await manager.createTask(
    `Eval task: ${options.task.title}`,
    [`Execute eval task ${options.task.id}`],
    {
      workflowStatus: 'executing',
      workingMemory: {
        goal: `Eval task: ${options.task.title}`,
        phase: 'executing',
        currentStep: `Execute eval task ${options.task.id}`,
        todos: [{
          id: `todo_${options.task.id}`,
          content: compactInstruction(options.instruction),
          status: 'in_progress',
          updatedAt: now,
        }],
        recentErrors: [],
        recentSignals: [],
        readFiles: [],
        writeFiles: [],
        artifactRefs: [],
        updatedAt: now,
      },
    },
  );
  return task.id;
}

export function createContextRuntimeBuildMemoryPrompt(
  variant: ContextRuntimeEvalVariant,
  memoryDir: string,
): (() => Promise<string>) | undefined {
  if (variant === 'plain') return async () => EVAL_PLAIN_MEMORY_PROMPT;
  return createContextAssemblyHook({
    memoryDir,
    useNewPipeline: true,
    runMode: 'eval',
    piSchemaRenderMode: 'summary',
  });
}

export function summarizeContextRuntimeRecords(
  records: ContextRuntimeEvalRecord[],
): ContextRuntimeVariantSummary[] {
  const variants = [...new Set(records.map((record) => record.variant))].sort();
  return variants.map((variant) => {
    const scoped = records.filter((record) => record.variant === variant);
    const passed = scoped.filter((record) => record.score.correctnessScore >= 1).length;
    const totalToolCalls = scoped.reduce((sum, record) =>
      sum + record.score.efficiencyMetrics.totalToolCalls, 0);
    const failedToolCalls = scoped.reduce((sum, record) =>
      sum + record.score.efficiencyMetrics.failedToolCalls, 0);
    const inputTokens = scoped.reduce((sum, record) => sum + record.trace.tokenUsage.inputTokens, 0);
    const outputTokens = scoped.reduce((sum, record) => sum + record.trace.tokenUsage.outputTokens, 0);
    const cacheReadTokens = scoped.reduce((sum, record) => sum + record.trace.tokenUsage.cacheReadTokens, 0);
    const cacheWriteTokens = scoped.reduce((sum, record) => sum + record.trace.tokenUsage.cacheWriteTokens, 0);
    const totalTokens = scoped.reduce((sum, record) => sum + record.trace.tokenUsage.totalTokens, 0);
    const piSchemaToolCount = Math.max(0, ...scoped.map((record) => record.trace.piSchemaTrace?.toolCount ?? 0));
    const piSchemaApproxTokensPerRequest = Math.max(
      0,
      ...scoped.map((record) => record.trace.piSchemaTrace?.approxSchemaTokens ?? 0),
    );
    const piSchemaInjectionCount = scoped.reduce((sum, record) =>
      sum + (record.trace.piSchemaTrace?.estimatedSchemaInjectionCount ?? 0), 0);
    const estimatedPiSchemaTokens = scoped.reduce((sum, record) =>
      sum + (record.trace.piSchemaTrace?.estimatedTotalSchemaTokens ?? 0), 0);
    const totalCostUsd = roundCost(scoped.reduce((sum, record) =>
      sum + record.trace.tokenUsage.costUsd.total, 0));
    return {
      variant,
      runs: scoped.length,
      passed,
      failed: scoped.length - passed,
      passRate: round(scoped.length === 0 ? 0 : passed / scoped.length),
      averageCorrectness: average(scoped.map((record) => record.score.correctnessScore)),
      averageBehavior: average(scoped.map((record) => record.score.behaviorScore)),
      totalToolCalls,
      failedToolCalls,
      totalTokens,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      piSchemaToolCount,
      piSchemaApproxTokensPerRequest,
      piSchemaInjectionCount,
      estimatedPiSchemaTokens,
      totalCostUsd,
      costPerRunUsd: roundCost(scoped.length === 0 ? 0 : totalCostUsd / scoped.length),
      costPerPassedTaskUsd: passed > 0 ? roundCost(totalCostUsd / passed) : null,
    };
  });
}

export function describeContextRuntimeRecordDiagnostics(record: ContextRuntimeEvalRecord): string[] {
  const diagnostics: string[] = [];
  if (record.trace.errorMessage) {
    diagnostics.push(`agent error: ${record.trace.errorMessage}`);
  }
  if (record.trace.taskState?.status && record.trace.taskState.status !== 'completed') {
    diagnostics.push(`task state: ${record.trace.taskState.status}`);
  }
  diagnostics.push(...record.score.behaviorFindings);
  return [...new Set(diagnostics)];
}

async function selectTasks(options: ContextRuntimeEvalOptions): Promise<EvalTaskDefinition[]> {
  const tasks = await loadEvalTasks(options.tasksRoot);
  const selected = options.taskIds?.length
    ? tasks.filter((task) => options.taskIds?.includes(task.id))
    : tasks;
  const missing = (options.taskIds ?? []).filter((id) => !tasks.some((task) => task.id === id));
  if (missing.length > 0) {
    throw new Error(`Unknown context runtime eval task id(s): ${missing.join(', ')}`);
  }
  return selected;
}

async function writeContextRuntimeReports(options: {
  records: ContextRuntimeEvalRecord[];
  summaries: ContextRuntimeVariantSummary[];
  resultsDir?: string;
}): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = join(options.resultsDir ?? resolve(process.cwd(), 'evals/results/context-runtime'), stamp);
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'records.json'), JSON.stringify({ records: options.records }, null, 2), 'utf-8');
  await writeFile(
    join(outputDir, 'summary.json'),
    JSON.stringify({ summaries: options.summaries }, null, 2),
    'utf-8',
  );
  await writeFile(
    join(outputDir, 'records.jsonl'),
    options.records.map((record) => JSON.stringify(record)).join('\n') + '\n',
    'utf-8',
  );
  await writeFile(join(outputDir, 'comparison.md'), renderComparison(options.summaries), 'utf-8');
  return outputDir;
}

function renderComparison(summaries: ContextRuntimeVariantSummary[]): string {
  const lines = [
    '# Context Runtime Eval Comparison',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '| Variant | Runs | Passed | Failed | Pass Rate | Avg Correctness | Avg Behavior | Tool Calls | Failed Tool Calls | Tokens | Pi Schema Tools | Pi Schema Injects | Est Pi Schema Tokens | Cost USD | Cost/Run | Cost/Pass |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const summary of summaries) {
    lines.push([
      `| ${summary.variant}`,
      String(summary.runs),
      String(summary.passed),
      String(summary.failed),
      summary.passRate.toFixed(2),
      summary.averageCorrectness.toFixed(2),
      summary.averageBehavior.toFixed(2),
      String(summary.totalToolCalls),
      String(summary.failedToolCalls),
      String(summary.totalTokens),
      String(summary.piSchemaToolCount),
      String(summary.piSchemaInjectionCount),
      String(summary.estimatedPiSchemaTokens),
      summary.totalCostUsd.toFixed(4),
      summary.costPerRunUsd.toFixed(4),
      summary.costPerPassedTaskUsd === null ? 'n/a' : summary.costPerPassedTaskUsd.toFixed(4),
    ].join(' | ') + ' |');
  }
  lines.push('');
  return lines.join('\n');
}

function compactInstruction(instruction: string): string {
  const normalized = instruction.replace(/\s+/gu, ' ').trim();
  return normalized.length > 500 ? `${normalized.slice(0, 500).trimEnd()}...` : normalized;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function roundCost(value: number): number {
  return Number(value.toFixed(8));
}
