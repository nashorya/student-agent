import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createEvalSandbox, diffSnapshots, readChangedFileContents, runVerifier, snapshotFiles } from './sandbox.js';
import { scoreEvalRun } from './scorer.js';
import { loadEvalTasks } from './task-loader.js';
import type { EvalRunRecord, EvalTaskDefinition, EvalTokenUsage, StudentAgentEvalTrace, ToolTraceEntry } from './types.js';

export interface ClaudeCodeRunOptions {
  tasksRoot?: string;
  resultsDir?: string;
  taskIds?: string[];
  trials?: number;
  keepSandboxes?: boolean;
  claudeCommand?: string;
  maxBudgetUsd?: number;
  model?: string;
  bare?: boolean;
}

export type ClaudeCodeEvalRecord = EvalRunRecord & {
  variant: 'claude_code';
};

export interface ClaudeCodeSummary {
  variant: 'claude_code';
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
  totalCostUsd: number;
  costPerRunUsd: number;
  costPerPassedTaskUsd: number | null;
}

export interface ClaudeCodeEvalResult {
  records: ClaudeCodeEvalRecord[];
  summary: ClaudeCodeSummary;
  outputDir: string;
}

export interface ParsedClaudeCodeResult {
  finalOutput: string;
  errorMessage?: string;
  tokenUsage: EvalTokenUsage;
  /** Verbatim `usage` object from claude stdout, kept for auditing normalization. */
  rawUsage?: Record<string, unknown>;
}

export interface ParsedClaudeCodeStream extends ParsedClaudeCodeResult {
  toolCalls: ToolTraceEntry[];
}

export async function runClaudeCodeEval(
  options: ClaudeCodeRunOptions = {},
): Promise<ClaudeCodeEvalResult> {
  const tasks = await selectTasks(options);
  const trials = options.trials ?? 1;
  const records: ClaudeCodeEvalRecord[] = [];

  for (const task of tasks) {
    for (let trial = 1; trial <= trials; trial++) {
      const sandbox = await createEvalSandbox(task);
      try {
        const instruction = await readFile(task.instructionPath, 'utf8');
        const before = await snapshotFiles(sandbox.path);
        const trace = await runClaudeCodeTask({
          task,
          sandboxDir: sandbox.path,
          instruction,
          claudeCommand: options.claudeCommand,
          maxBudgetUsd: options.maxBudgetUsd,
          model: options.model,
          bare: options.bare,
        });
        const afterAgent = await snapshotFiles(sandbox.path);
        const changedFiles = diffSnapshots(before, afterAgent);
        const modifiedFiles = await readChangedFileContents(sandbox.path, changedFiles);
        const verifier = await runVerifier(task, sandbox);
        const scored = scoreEvalRun({ task, trace, verifier, before, after: afterAgent, modifiedFiles });
        records.push({
          variant: 'claude_code',
          taskId: task.id,
          title: task.title,
          mode: task.mode,
          trial,
          ...scored,
        });
      } finally {
        if (!options.keepSandboxes) {
          await sandbox.cleanup();
        }
      }
    }
  }

  const summary = summarizeClaudeCodeRecords(records);
  const outputDir = await writeClaudeCodeReports({
    records,
    summary,
    resultsDir: options.resultsDir,
  });
  return { records, summary, outputDir };
}

export async function runClaudeCodeTask(options: {
  task: EvalTaskDefinition;
  sandboxDir: string;
  instruction: string;
  claudeCommand?: string;
  maxBudgetUsd?: number;
  model?: string;
  bare?: boolean;
}): Promise<StudentAgentEvalTrace> {
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const command = options.claudeCommand ?? 'claude';
  const args = buildClaudeCodeArgs({
    instruction: options.instruction,
    maxBudgetUsd: options.maxBudgetUsd,
    model: options.model,
    bare: options.bare,
  });
  const result = await runProcess(command, args, options.sandboxDir, options.task.timeoutSeconds * 1000);
  const parsed = parseClaudeCodeStream(result.stdout);
  const processError = result.exitCode === 0 ? undefined : `claude exited with code ${result.exitCode}`;
  const errorMessage = parsed.errorMessage ?? processError;
  const endedMs = Date.now();

  return {
    taskId: options.task.id,
    mode: options.task.mode,
    instruction: options.instruction,
    startedAt,
    endedAt: new Date(endedMs).toISOString(),
    durationMs: endedMs - startedMs,
    status: errorMessage ? 'failed' : 'success',
    finalOutput: parsed.finalOutput || result.stdout || result.stderr,
    errorMessage,
    toolCalls: parsed.toolCalls,
    tokenUsage: parsed.tokenUsage,
    rawUsage: parsed.rawUsage,
    taskState: options.task.mode === 'task'
      ? {
        status: errorMessage ? 'planning_failed' : 'completed',
        phaseCount: 0,
        phases: [],
      }
      : undefined,
  };
}

export function buildClaudeCodeArgs(options: {
  instruction: string;
  maxBudgetUsd?: number;
  model?: string;
  bare?: boolean;
}): string[] {
  const args = [
    '-p',
    ...(options.bare === false ? [] : ['--bare']),
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'bypassPermissions',
    '--no-session-persistence',
  ];
  if (options.maxBudgetUsd !== undefined) {
    args.push('--max-budget-usd', String(options.maxBudgetUsd));
  }
  if (options.model) {
    args.push('--model', options.model);
  }
  args.push(options.instruction);
  return args;
}

export function parseClaudeCodeJsonResult(stdout: string): ParsedClaudeCodeResult {
  const parsed = parseLastJsonObject(stdout);
  if (!parsed) {
    return {
      finalOutput: stdout,
      tokenUsage: emptyTokenUsage(),
    };
  }
  return parseResultRecord(parsed, stdout);
}

function parseResultRecord(parsed: Record<string, unknown>, stdout: string): ParsedClaudeCodeResult {
  const result = stringValue(parsed.result) ?? stdout;
  return {
    finalOutput: result,
    errorMessage: parsed.is_error === true ? result : undefined,
    tokenUsage: usageFromClaudeJson(parsed),
    rawUsage: isRecord(parsed.usage) ? parsed.usage : undefined,
  };
}

/**
 * Parse a `--output-format stream-json` transcript: one JSON object per line.
 * Extracts tool_use calls from assistant messages and pairs them with their
 * tool_result blocks from subsequent user messages. Falls back to the same
 * usage/result parsing as the plain-JSON path for the final `result` line.
 */
export function parseClaudeCodeStream(stdout: string): ParsedClaudeCodeStream {
  const toolCalls: ToolTraceEntry[] = [];
  const byId = new Map<string, ToolTraceEntry>();
  let resultObj: Record<string, unknown> | null = null;

  for (const raw of stdout.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(obj)) continue;

    if (obj.type === 'assistant' && isRecord(obj.message)) {
      for (const block of contentBlocks(obj.message.content)) {
        if (block.type !== 'tool_use') continue;
        const id = stringValue(block.id) ?? `tool_${toolCalls.length}`;
        const entry: ToolTraceEntry = {
          id,
          name: stringValue(block.name) ?? 'unknown',
          args: block.input ?? {},
          startedAt: new Date().toISOString(),
        };
        toolCalls.push(entry);
        byId.set(id, entry);
      }
    } else if (obj.type === 'user' && isRecord(obj.message)) {
      for (const block of contentBlocks(obj.message.content)) {
        if (block.type !== 'tool_result') continue;
        const id = stringValue(block.tool_use_id);
        const entry = id ? byId.get(id) : undefined;
        if (!entry) continue;
        entry.endedAt = new Date().toISOString();
        entry.isError = block.is_error === true;
        entry.resultText = toolResultText(block.content);
      }
    } else if (obj.type === 'result') {
      resultObj = obj;
    }
  }

  const base = resultObj
    ? parseResultRecord(resultObj, stdout)
    : { finalOutput: stdout, tokenUsage: emptyTokenUsage() };
  return { ...base, toolCalls };
}

function contentBlocks(content: unknown): Record<string, unknown>[] {
  return Array.isArray(content) ? content.filter(isRecord) : [];
}

function toolResultText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .filter(isRecord)
    .map((block) => stringValue(block.text) ?? '')
    .filter((text) => text.length > 0);
  return parts.length > 0 ? parts.join('\n') : undefined;
}

export function summarizeClaudeCodeRecords(records: ClaudeCodeEvalRecord[]): ClaudeCodeSummary {
  const passed = records.filter((record) => record.score.correctnessScore >= 1).length;
  const inputTokens = records.reduce((sum, record) => sum + record.trace.tokenUsage.inputTokens, 0);
  const outputTokens = records.reduce((sum, record) => sum + record.trace.tokenUsage.outputTokens, 0);
  const cacheReadTokens = records.reduce((sum, record) => sum + record.trace.tokenUsage.cacheReadTokens, 0);
  const cacheWriteTokens = records.reduce((sum, record) => sum + record.trace.tokenUsage.cacheWriteTokens, 0);
  const totalTokens = records.reduce((sum, record) => sum + record.trace.tokenUsage.totalTokens, 0);
  const totalCostUsd = roundCost(records.reduce((sum, record) => sum + record.trace.tokenUsage.costUsd.total, 0));
  return {
    variant: 'claude_code',
    runs: records.length,
    passed,
    failed: records.length - passed,
    passRate: round(records.length === 0 ? 0 : passed / records.length),
    averageCorrectness: average(records.map((record) => record.score.correctnessScore)),
    averageBehavior: average(records.map((record) => record.score.behaviorScore)),
    totalToolCalls: records.reduce((sum, record) => sum + record.score.efficiencyMetrics.totalToolCalls, 0),
    failedToolCalls: records.reduce((sum, record) => sum + record.score.efficiencyMetrics.failedToolCalls, 0),
    totalTokens,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalCostUsd,
    costPerRunUsd: roundCost(records.length === 0 ? 0 : totalCostUsd / records.length),
    costPerPassedTaskUsd: passed > 0 ? roundCost(totalCostUsd / passed) : null,
  };
}

async function selectTasks(options: ClaudeCodeRunOptions): Promise<EvalTaskDefinition[]> {
  const tasks = await loadEvalTasks(options.tasksRoot);
  const selected = options.taskIds?.length
    ? tasks.filter((task) => options.taskIds?.includes(task.id))
    : tasks;
  const missing = (options.taskIds ?? []).filter((id) => !tasks.some((task) => task.id === id));
  if (missing.length > 0) {
    throw new Error(`Unknown Claude Code eval task id(s): ${missing.join(', ')}`);
  }
  return selected;
}

async function writeClaudeCodeReports(options: {
  records: ClaudeCodeEvalRecord[];
  summary: ClaudeCodeSummary;
  resultsDir?: string;
}): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = join(options.resultsDir ?? resolve(process.cwd(), 'evals/results/claude-code'), stamp);
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'records.json'), JSON.stringify({ records: options.records }, null, 2), 'utf-8');
  await writeFile(join(outputDir, 'summary.json'), JSON.stringify({ summary: options.summary }, null, 2), 'utf-8');
  await writeFile(
    join(outputDir, 'records.jsonl'),
    options.records.map((record) => JSON.stringify(record)).join('\n') + '\n',
    'utf-8',
  );
  await writeFile(join(outputDir, 'comparison.md'), renderMarkdownSummary(options.summary), 'utf-8');
  return outputDir;
}

function renderMarkdownSummary(summary: ClaudeCodeSummary): string {
  return [
    '# Claude Code Eval Summary',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '| Variant | Runs | Passed | Failed | Pass Rate | Avg Correctness | Avg Behavior | Tokens | Cost USD |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    `| ${summary.variant} | ${summary.runs} | ${summary.passed} | ${summary.failed} | ${summary.passRate.toFixed(2)} | ${summary.averageCorrectness.toFixed(2)} | ${summary.averageBehavior.toFixed(2)} | ${summary.totalTokens} | ${summary.totalCostUsd.toFixed(4)} |`,
    '',
  ].join('\n');
}

function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ exitCode: 1, stdout, stderr: err.message });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({
        exitCode: signal ? 124 : code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function parseLastJsonObject(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  const lines = trimmed.split(/\r?\n/u).reverse();
  for (const line of lines) {
    const candidate = line.trim();
    if (!candidate.startsWith('{') || !candidate.endsWith('}')) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      continue;
    }
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function usageFromClaudeJson(raw: Record<string, unknown>): EvalTokenUsage {
  const usage = isRecord(raw.usage) ? raw.usage : {};
  // OpenAI-compatible endpoints report usage as prompt_tokens/completion_tokens,
  // with cache hits nested in prompt_tokens_details.cached_tokens. Note the
  // semantic difference: OpenAI's prompt_tokens INCLUDES cached tokens, while
  // Anthropic's input_tokens EXCLUDES cache reads. Normalize both to our schema
  // (inputTokens excludes cacheReadTokens).
  const promptDetails = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const openaiCachedTokens = numberValue(promptDetails.cached_tokens);
  const openaiPromptTokens = numberValue(usage.prompt_tokens);
  const cacheReadTokens = numberValue(usage.cache_read_input_tokens) || openaiCachedTokens;
  const inputTokens = numberValue(usage.input_tokens)
    || Math.max(openaiPromptTokens - openaiCachedTokens, 0);
  const outputTokens = numberValue(usage.output_tokens) || numberValue(usage.completion_tokens);
  const cacheWriteTokens = cacheCreationTokens(usage);
  const totalTokens = numberValue(usage.total_tokens)
    || inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    costUsd: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: roundCost(numberValue(raw.total_cost_usd)),
    },
  };
}

function cacheCreationTokens(usage: Record<string, unknown>): number {
  const direct = numberValue(usage.cache_creation_input_tokens);
  if (direct > 0) return direct;
  const nested = isRecord(usage.cache_creation) ? usage.cache_creation : {};
  return numberValue(nested.ephemeral_1h_input_tokens) + numberValue(nested.ephemeral_5m_input_tokens);
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

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
