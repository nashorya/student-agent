import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { runStudentAgentEval } from './agent-runner.js';
import { runClaudeCodeTask } from './claude-code-runner.js';
import {
  createContextRuntimeBuildMemoryPrompt,
  seedContextRuntimeEvalMemory,
  type ContextRuntimeEvalVariant,
} from './context-runtime-runner.js';
import { defaultExternalBenchmarkOutputDir } from './external-benchmarks.js';
import type { EvalTaskDefinition, StudentAgentEvalTrace } from './types.js';

export type SweBenchAgent = 'student-agent' | 'claude-code';

export interface SweBenchInstance {
  instance_id: string;
  repo?: string;
  base_commit?: string;
  problem_statement?: string;
}

export interface SweBenchPrediction {
  instance_id: string;
  model_name_or_path: string;
  model_patch: string;
}

export interface SweBenchPatchProducerRecord {
  instanceId: string;
  agent: SweBenchAgent;
  modelNameOrPath: string;
  studentVariant?: ContextRuntimeEvalVariant;
  status: 'success' | 'failed';
  prediction: SweBenchPrediction;
  patchAnalysis: SweBenchPatchAnalysis;
  emptyPatch: boolean;
  suspiciousPatch: boolean;
  trace?: StudentAgentEvalTrace;
  errorMessage?: string;
  durationMs: number;
  worktreePath?: string;
}

export interface SweBenchPatchAnalysis {
  patchBytes: number;
  diffFiles: number;
  emptyPatch: boolean;
  suspiciousPatch: boolean;
}

export interface SweBenchPatchProducerResult {
  outputDir: string;
  predictionsPath: string;
  recordsPath: string;
  records: SweBenchPatchProducerRecord[];
}

export interface SweBenchProductionPlan {
  outputDir: string;
  predictionsPath: string;
  recordsPath: string;
  studentVariant: ContextRuntimeEvalVariant;
  instances: Array<{ instance_id: string }>;
}

export interface ProduceSweBenchPatchesOptions {
  instancesPath: string;
  agent: SweBenchAgent;
  outputDir?: string;
  limit?: number;
  instanceIds?: string[];
  modelNameOrPath?: string;
  repoCacheDir?: string;
  keepWorktrees?: boolean;
  timeoutSeconds?: number;
  claudeCommand?: string;
  claudeModel?: string;
  claudeMaxBudgetUsd?: number;
  claudeBare?: boolean;
  studentVariant?: ContextRuntimeEvalVariant;
}

export async function loadSweBenchInstances(path: string): Promise<SweBenchInstance[]> {
  const raw = await readFile(path, 'utf-8');
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) return parsed.map(normalizeInstance);
      if (isRecord(parsed) && Array.isArray(parsed.instances)) {
        return parsed.instances.map(normalizeInstance);
      }
      return [normalizeInstance(parsed)];
    } catch {
      // JSONL often starts with "{" too; fall through to line-by-line parsing.
    }
  }

  return trimmed
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeInstance(JSON.parse(line) as unknown));
}

export function createSweBenchPrediction(options: {
  instance: SweBenchInstance;
  modelNameOrPath: string;
  patch: string;
}): SweBenchPrediction {
  return {
    instance_id: options.instance.instance_id,
    model_name_or_path: options.modelNameOrPath,
    model_patch: options.patch,
  };
}

export async function writeSweBenchPredictionsFile(
  predictions: SweBenchPrediction[],
  outputPath: string,
): Promise<void> {
  await mkdir(resolve(outputPath, '..'), { recursive: true });
  await writeFile(
    outputPath,
    predictions.map((prediction) => JSON.stringify(prediction)).join('\n') + '\n',
    'utf-8',
  );
}

export async function produceSweBenchPatches(
  options: ProduceSweBenchPatchesOptions,
): Promise<SweBenchPatchProducerResult> {
  const outputDir = sweBenchOutputDir(options.outputDir);
  await mkdir(outputDir, { recursive: true });
  const workRoot = await mkdtemp(join(tmpdir(), 'student-agent-swebench-'));
  const instances = selectInstances(await loadSweBenchInstances(options.instancesPath), options);
  const records: SweBenchPatchProducerRecord[] = [];

  try {
    for (const instance of instances) {
      records.push(await runSweBenchInstance({
        instance,
        agent: options.agent,
        modelNameOrPath: options.modelNameOrPath ?? defaultModelName(options.agent),
        studentVariant: options.studentVariant ?? 'context_runtime',
        workRoot,
        keepWorktrees: options.keepWorktrees ?? false,
        timeoutSeconds: options.timeoutSeconds ?? 1800,
        claudeCommand: options.claudeCommand,
        claudeModel: options.claudeModel,
        claudeMaxBudgetUsd: options.claudeMaxBudgetUsd,
        claudeBare: options.claudeBare,
      }));
    }
  } finally {
    if (!options.keepWorktrees) {
      await removeWorktree(workRoot);
    }
  }

  const predictionsPath = join(outputDir, 'predictions.jsonl');
  const recordsPath = join(outputDir, 'records.json');
  await writeSweBenchPredictionsFile(records.map((record) => record.prediction), predictionsPath);
  await writeFile(recordsPath, JSON.stringify({ records }, null, 2), 'utf-8');
  return {
    outputDir,
    predictionsPath,
    recordsPath,
    records,
  };
}

export async function createSweBenchProductionPlan(
  options: ProduceSweBenchPatchesOptions,
): Promise<SweBenchProductionPlan> {
  const outputDir = sweBenchOutputDir(options.outputDir);
  const instances = selectInstances(await loadSweBenchInstances(options.instancesPath), options);
  return {
    outputDir,
    predictionsPath: join(outputDir, 'predictions.jsonl'),
    recordsPath: join(outputDir, 'records.json'),
    studentVariant: options.studentVariant ?? 'context_runtime',
    instances: instances.map((instance) => ({ instance_id: instance.instance_id })),
  };
}

function sweBenchOutputDir(outputDir?: string): string {
  return outputDir ? resolve(outputDir) : defaultExternalBenchmarkOutputDir('swebench');
}

function selectInstances(
  instances: SweBenchInstance[],
  options: Pick<ProduceSweBenchPatchesOptions, 'instanceIds' | 'limit'>,
): SweBenchInstance[] {
  let selected = instances;
  if (options.instanceIds && options.instanceIds.length > 0) {
    const wanted = new Set(options.instanceIds);
    selected = selected.filter((instance) => wanted.has(instance.instance_id));
  }
  return options.limit === undefined ? selected : selected.slice(0, options.limit);
}

async function runSweBenchInstance(options: {
  instance: SweBenchInstance;
  agent: SweBenchAgent;
  modelNameOrPath: string;
  studentVariant: ContextRuntimeEvalVariant;
  workRoot: string;
  keepWorktrees: boolean;
  timeoutSeconds: number;
  claudeCommand?: string;
  claudeModel?: string;
  claudeMaxBudgetUsd?: number;
  claudeBare?: boolean;
}): Promise<SweBenchPatchProducerRecord> {
  const started = Date.now();
  const worktreePath = join(options.workRoot, safePathSegment(options.instance.instance_id));
  let trace: StudentAgentEvalTrace | undefined;
  let errorMessage: string | undefined;
  try {
    await checkoutInstance(options.instance, worktreePath);
    await verifyCleanInitialWorktree(worktreePath);
    const task = buildSyntheticTask(options.instance, worktreePath, options.timeoutSeconds);
    const instruction = buildSweBenchInstruction(options.instance);
    await writeFile(task.instructionPath, instruction, 'utf-8');
    if (options.agent === 'student-agent') {
      const studentContext = await resolveSweBenchStudentContext({
        variant: options.studentVariant,
        memoryDir: join(options.workRoot, '.student-agent-memory', safePathSegment(options.instance.instance_id)),
        task,
        instruction,
      });
      trace = await runStudentAgentEval({
        task,
        sandboxDir: worktreePath,
        instruction,
        memoryDir: studentContext.memoryDir,
        buildMemoryPrompt: studentContext.buildMemoryPrompt,
      });
    } else {
      trace = await runClaudeCodeTask({
        task,
        sandboxDir: worktreePath,
        instruction,
        claudeCommand: options.claudeCommand,
        maxBudgetUsd: options.claudeMaxBudgetUsd,
        model: options.claudeModel,
        bare: options.claudeBare,
      });
    }
    errorMessage = trace.errorMessage;
    if (!errorMessage && trace.status === 'failed') {
      errorMessage = 'Agent reported failed status';
    }
    if (!errorMessage && isEmptyAgentTrace(trace)) {
      errorMessage = 'Agent produced an empty trace with no output, tool calls, or tokens';
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const patch = await gitDiff(worktreePath).catch(() => '');
  const patchAnalysis = analyzeSweBenchPatch(patch);
  if (!errorMessage && patchAnalysis.emptyPatch) {
    errorMessage = 'Agent produced an empty patch';
  }
  const prediction = createSweBenchPrediction({
    instance: options.instance,
    modelNameOrPath: options.modelNameOrPath,
    patch,
  });
  const durationMs = Date.now() - started;
  if (!options.keepWorktrees) {
    await removeWorktree(worktreePath);
  }
  return {
    instanceId: options.instance.instance_id,
    agent: options.agent,
    modelNameOrPath: options.modelNameOrPath,
    ...(options.agent === 'student-agent' ? { studentVariant: options.studentVariant } : {}),
    status: errorMessage ? 'failed' : 'success',
    prediction,
    patchAnalysis,
    emptyPatch: patchAnalysis.emptyPatch,
    suspiciousPatch: patchAnalysis.suspiciousPatch,
    trace,
    errorMessage,
    durationMs,
    worktreePath: options.keepWorktrees ? worktreePath : undefined,
  };
}

export async function resolveSweBenchStudentContext(options: {
  variant: ContextRuntimeEvalVariant;
  memoryDir: string;
  task: EvalTaskDefinition;
  instruction: string;
}): Promise<{
  memoryDir: string;
  buildMemoryPrompt: NonNullable<ReturnType<typeof createContextRuntimeBuildMemoryPrompt>>;
}> {
  if (options.variant === 'context_runtime') {
    await seedContextRuntimeEvalMemory({
      memoryDir: options.memoryDir,
      task: options.task,
      instruction: options.instruction,
    });
  }
  const buildMemoryPrompt = createContextRuntimeBuildMemoryPrompt(options.variant, options.memoryDir);
  if (!buildMemoryPrompt) {
    throw new Error(`Unable to create context prompt for SWE variant ${options.variant}`);
  }
  return {
    memoryDir: options.memoryDir,
    buildMemoryPrompt,
  };
}

async function checkoutInstance(instance: SweBenchInstance, worktreePath: string): Promise<void> {
  if (!instance.repo || !instance.base_commit) {
    throw new Error(`SWE-bench instance ${instance.instance_id} must include repo and base_commit`);
  }
  const image = await findLocalSweBenchImage(instance.repo);
  if (image) {
    try {
      await copyTestbedFromDockerImage(image, worktreePath);
      await checkoutBaseCommit(instance.base_commit, worktreePath);
      return;
    } catch {
      await removeWorktree(worktreePath);
    }
  }
  const source = repoToCloneSource(instance.repo);
  await runProcess('git', ['clone', '--no-checkout', source, worktreePath], process.cwd(), 600);
  await checkoutBaseCommit(instance.base_commit, worktreePath);
}

export async function verifyCleanInitialWorktree(worktreePath: string): Promise<void> {
  const status = await runProcess('git', ['status', '--porcelain'], worktreePath, 120, false);
  const diffStat = await runProcess('git', ['diff', '--stat'], worktreePath, 120, false);
  const details = [status.stdout, diffStat.stdout].map((value) => value.trim()).filter(Boolean).join('\n');
  if (status.exitCode !== 0 || diffStat.exitCode !== 0 || details) {
    throw new Error(`SWE-bench initial worktree is not clean${details ? `\n${details}` : ''}`);
  }
}

export function analyzeSweBenchPatch(patch: string): SweBenchPatchAnalysis {
  const patchBytes = Buffer.byteLength(patch, 'utf8');
  const diffFiles = patch.match(/^diff --git /gmu)?.length ?? 0;
  const emptyPatch = patch.trim().length === 0;
  return {
    patchBytes,
    diffFiles,
    emptyPatch,
    suspiciousPatch: !emptyPatch && (diffFiles > 100 || patchBytes > 1_000_000),
  };
}

export function isEmptyAgentTrace(trace: StudentAgentEvalTrace | undefined): boolean {
  if (!trace) return true;
  const usage = trace.tokenUsage;
  return (trace.finalOutput ?? '').trim().length === 0
    && trace.toolCalls.length === 0
    && usage.inputTokens === 0
    && usage.outputTokens === 0
    && usage.cacheReadTokens === 0
    && usage.cacheWriteTokens === 0
    && usage.totalTokens === 0;
}

function repoToCloneSource(repo: string): string {
  if (/^(?:https?:|git@|file:|\/|\.)/u.test(repo)) return repo;
  return `https://github.com/${repo}.git`;
}

async function findLocalSweBenchImage(repo: string): Promise<string | undefined> {
  const repoName = repo.split('/').pop();
  if (!repoName) return undefined;
  const result = await runProcess(
    'docker',
    ['images', '--format', '{{.Repository}}:{{.Tag}}'],
    process.cwd(),
    30,
    false,
  ).catch(() => ({ stdout: '' }));
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((image) => image.startsWith('swebench/sweb.eval.') && image.includes(`.${repoName}_`));
}

async function copyTestbedFromDockerImage(image: string, worktreePath: string): Promise<void> {
  const name = `student-agent-swebench-copy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await runProcess('docker', ['create', '--name', name, image, '/bin/sh'], process.cwd(), 120);
  try {
    await runProcess('docker', ['cp', `${name}:/testbed`, worktreePath], process.cwd(), 600);
  } finally {
    await runProcess('docker', ['rm', '-f', name], process.cwd(), 120, false).catch(() => undefined);
  }
}

async function checkoutBaseCommit(baseCommit: string, worktreePath: string): Promise<void> {
  await runProcess('git', ['checkout', baseCommit], worktreePath, 600);
  await runProcess('git', ['reset', '--hard', baseCommit], worktreePath, 600);
  await runProcess('git', ['clean', '-fdx'], worktreePath, 600);
}

async function removeWorktree(path: string): Promise<void> {
  await rm(path, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  }).catch(() => undefined);
}

function buildSyntheticTask(
  instance: SweBenchInstance,
  worktreePath: string,
  timeoutSeconds: number,
): EvalTaskDefinition {
  return {
    id: safePathSegment(instance.instance_id),
    title: `SWE-bench ${instance.instance_id}`,
    mode: 'direct',
    tags: ['swebench'],
    timeoutSeconds,
    expectedFiles: [],
    taskDir: worktreePath,
    instructionPath: join(worktreePath, '.swebench-instruction.md'),
    environmentDir: worktreePath,
    testScriptPath: join(worktreePath, '.swebench-verifier.sh'),
  };
}

function buildSweBenchInstruction(instance: SweBenchInstance): string {
  return [
    'Resolve this SWE-bench issue in the current repository.',
    'Edit only the production files needed to fix the issue.',
    'Do not edit tests unless the issue explicitly requires test changes.',
    'When finished, leave the repository with a valid git diff patch.',
    '',
    `Instance: ${instance.instance_id}`,
    '',
    instance.problem_statement ?? '',
  ].join('\n');
}

async function gitDiff(cwd: string): Promise<string> {
  const result = await runProcess('git', ['diff', '--binary'], cwd, 600, false);
  return result.stdout;
}

function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutSeconds: number,
  throwOnFailure = true,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGTERM'), timeoutSeconds * 1000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      const exitCode = signal ? 124 : code ?? 1;
      const result = { exitCode, stdout, stderr };
      if (throwOnFailure && exitCode !== 0) {
        reject(new Error(`${command} ${args.join(' ')} failed with ${exitCode}\n${stderr || stdout}`));
        return;
      }
      resolveProcess(result);
    });
  });
}

function defaultModelName(agent: SweBenchAgent): string {
  return agent === 'student-agent' ? 'student-agent' : 'claude-code';
}

function normalizeInstance(value: unknown): SweBenchInstance {
  if (!isRecord(value)) {
    throw new Error('SWE-bench instance must be an object');
  }
  const instanceId = stringValue(value.instance_id) ?? stringValue(value.id);
  if (!instanceId) {
    throw new Error('SWE-bench instance must include instance_id');
  }
  return {
    instance_id: instanceId,
    repo: stringValue(value.repo),
    base_commit: stringValue(value.base_commit),
    problem_statement: stringValue(value.problem_statement),
  };
}

function safePathSegment(value: string): string {
  return (basename(value).replace(/[^A-Za-z0-9_.-]/gu, '-') || 'instance').slice(0, 120);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
