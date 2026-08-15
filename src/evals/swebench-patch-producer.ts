import { spawn } from 'node:child_process';
import { accessSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { runStudentAgentEval } from './agent-runner.js';
import { runClaudeCodeTask } from './claude-code-runner.js';
import {
  createInjectionBuildMemoryPrompt,
  seedContextRuntimeEvalMemory,
  type ContextRuntimeEvalVariant,
  type InjectionPromptHook,
  type StudentInjectionMode,
} from './context-runtime-runner.js';
import { defaultExternalBenchmarkOutputDir } from './external-benchmarks.js';
import type { EvalTaskDefinition, StudentAgentEvalTrace } from './types.js';
import {
  finalizeEvalLearningRun,
  type EvalLearningSummary,
} from './eval-learning-lifecycle.js';

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
  learningSummary?: EvalLearningSummary;
  learningFinalizationError?: string;
  injectionSnapshot?: string;
  errorMessage?: string;
  durationMs: number;
  initialHead?: string;
  expectedBaseCommit?: string;
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
  metadataPath: string;
  records: SweBenchPatchProducerRecord[];
}

export interface SweBenchProductionPlan {
  outputDir: string;
  predictionsPath: string;
  recordsPath: string;
  metadataPath: string;
  studentVariant: ContextRuntimeEvalVariant;
  studentMemoryDir?: string;
  studentLearningLifecycle: boolean;
  studentLearningTaskOffset: number;
  studentInjectionMode?: StudentInjectionMode;
  studentDeferKnackPromotion?: boolean;
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
  studentMemoryDir?: string;
  studentLearningLifecycle?: boolean;
  studentLearningTaskOffset?: number;
  studentInjectionMode?: StudentInjectionMode;
  studentDeferKnackPromotion?: boolean;
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
    for (const [index, instance] of instances.entries()) {
      const record = await runSweBenchInstance({
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
        studentMemoryDir: options.studentMemoryDir,
        studentLearningLifecycle: options.studentLearningLifecycle ?? false,
        learningTaskIndex: (options.studentLearningTaskOffset ?? 0) + index + 1,
        studentInjectionMode: options.studentInjectionMode,
        studentDeferKnackPromotion: options.studentDeferKnackPromotion,
      });
      records.push(record);
      if (record.learningFinalizationError) break;
    }
  } finally {
    if (!options.keepWorktrees) {
      await removeWorktree(workRoot);
    }
  }

  const predictionsPath = join(outputDir, 'predictions.jsonl');
  const recordsPath = join(outputDir, 'records.json');
  const metadataPath = join(outputDir, 'metadata.json');
  await writeSweBenchPredictionsFile(records.map((record) => record.prediction), predictionsPath);
  await writeFile(recordsPath, JSON.stringify({ records }, null, 2), 'utf-8');
  const [commitResult, statusResult] = await Promise.all([
    runProcess('git', ['rev-parse', 'HEAD'], process.cwd(), 30, false),
    runProcess('git', ['status', '--porcelain'], process.cwd(), 30, false),
  ]);
  await writeFile(metadataPath, JSON.stringify(buildSweBenchProducerMetadata({
    commit: commitResult.stdout.trim() || 'unknown',
    agent: options.agent,
    modelNameOrPath: options.modelNameOrPath ?? defaultModelName(options.agent),
    studentVariant: options.studentVariant ?? 'context_runtime',
    studentInjectionMode: options.studentInjectionMode,
    studentMemoryDir: options.studentMemoryDir ? resolve(options.studentMemoryDir) : undefined,
    studentLearningLifecycle: options.studentLearningLifecycle ?? false,
    studentLearningTaskOffset: options.studentLearningTaskOffset ?? 0,
    ...(options.studentDeferKnackPromotion ? { studentDeferKnackPromotion: true } : {}),
    records,
    env: process.env,
    dirtyPaths: statusResult.stdout.split(/\r?\n/u).filter(Boolean),
  }), null, 2), 'utf-8');
  return {
    outputDir,
    predictionsPath,
    recordsPath,
    metadataPath,
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
    metadataPath: join(outputDir, 'metadata.json'),
    studentVariant: options.studentVariant ?? 'context_runtime',
    ...(options.studentMemoryDir ? { studentMemoryDir: resolve(options.studentMemoryDir) } : {}),
    studentLearningLifecycle: options.studentLearningLifecycle ?? false,
    studentLearningTaskOffset: options.studentLearningTaskOffset ?? 0,
    ...(options.studentInjectionMode ? { studentInjectionMode: options.studentInjectionMode } : {}),
    ...(options.studentDeferKnackPromotion ? { studentDeferKnackPromotion: true } : {}),
    instances: instances.map((instance) => ({ instance_id: instance.instance_id })),
  };
}

export function buildSweBenchProducerMetadata(options: {
  commit: string;
  agent: SweBenchAgent;
  modelNameOrPath: string;
  studentVariant: ContextRuntimeEvalVariant;
  studentInjectionMode?: StudentInjectionMode;
  studentMemoryDir?: string;
  studentLearningLifecycle: boolean;
  studentLearningTaskOffset: number;
  studentDeferKnackPromotion?: boolean;
  records: SweBenchPatchProducerRecord[];
  env?: NodeJS.ProcessEnv;
  dirtyPaths?: string[];
}): Record<string, unknown> {
  const env = options.env ?? process.env;
  const runtimeModel = options.records.find((record) => record.trace?.model)?.trace?.model;
  return {
    commit: options.commit,
    generatedAt: new Date().toISOString(),
    agent: options.agent,
    modelNameOrPath: options.modelNameOrPath,
    studentVariant: options.studentVariant,
    ...(options.studentInjectionMode ? { studentInjectionMode: options.studentInjectionMode } : {}),
    ...(options.studentMemoryDir ? { studentMemoryDir: options.studentMemoryDir } : {}),
    studentLearningLifecycle: options.studentLearningLifecycle,
    studentLearningTaskOffset: options.studentLearningTaskOffset,
    studentDeferKnackPromotion: options.studentDeferKnackPromotion ?? false,
    networkRoute: describeNetworkRoute(env),
    ...(runtimeModel ? { runtimeModel } : {}),
    workingTreeDirty: (options.dirtyPaths?.length ?? 0) > 0,
    dirtyPaths: options.dirtyPaths ?? [],
    instances: options.records.map((record) => ({
      instanceId: record.instanceId,
      status: record.status,
      costUsd: record.trace?.tokenUsage.costUsd.total ?? 0,
      inputTokens: record.trace?.tokenUsage.inputTokens ?? 0,
      totalTokens: record.trace?.tokenUsage.totalTokens ?? 0,
      turns: record.trace?.turnCount ?? 0,
      cacheReadTokens: record.trace?.tokenUsage.cacheReadTokens ?? 0,
      learning: record.learningSummary,
      error: record.errorMessage,
    })),
  };
}

function describeNetworkRoute(env: NodeJS.ProcessEnv): string {
  const proxy = env.HTTPS_PROXY ?? env.HTTP_PROXY ?? env.ALL_PROXY
    ?? env.https_proxy ?? env.http_proxy ?? env.all_proxy;
  if (!proxy) return 'direct';
  try {
    return `proxy:${new URL(proxy).host}`;
  } catch {
    return 'proxy:configured';
  }
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
  studentMemoryDir?: string;
  studentLearningLifecycle: boolean;
  learningTaskIndex: number;
  studentInjectionMode?: StudentInjectionMode;
  studentDeferKnackPromotion?: boolean;
}): Promise<SweBenchPatchProducerRecord> {
  const started = Date.now();
  const worktreePath = join(options.workRoot, safePathSegment(options.instance.instance_id));
  let trace: StudentAgentEvalTrace | undefined;
  let learningSummary: EvalLearningSummary | undefined;
  let learningFinalizationError: string | undefined;
  let errorMessage: string | undefined;
  let injectionSnapshot: string | undefined;
  let initialHead: string | undefined;
  try {
    await checkoutInstance(options.instance, worktreePath);
    await verifyCleanInitialWorktree(worktreePath);
    initialHead = (await runProcess('git', ['rev-parse', 'HEAD'], worktreePath, 30, false)).stdout.trim();
    if (initialHead !== options.instance.base_commit) {
      throw new Error(`SWE-bench initial HEAD ${initialHead} does not match base_commit ${options.instance.base_commit}`);
    }
    const task = buildSyntheticTask(options.instance, worktreePath, options.timeoutSeconds);
    const instruction = buildSweBenchInstruction(options.instance);
    await writeFile(task.instructionPath, instruction, 'utf-8');
    if (options.agent === 'student-agent') {
      const studentContext = await resolveSweBenchStudentContext({
        variant: options.studentVariant,
        memoryDir: resolveSweBenchStudentMemoryDir({
          workRoot: options.workRoot,
          instanceId: options.instance.instance_id,
          studentMemoryDir: options.studentMemoryDir,
        }),
        task,
        instruction,
        injectionMode: options.studentInjectionMode,
        repository: options.instance.repo,
      });
      trace = await runStudentAgentEval({
        task,
        sandboxDir: worktreePath,
        instruction,
        memoryDir: studentContext.memoryDir,
        buildMemoryPrompt: studentContext.buildMemoryPrompt,
        learningLifecycle: options.studentLearningLifecycle,
      });
      injectionSnapshot = studentContext.buildMemoryPrompt.injectionSnapshots[0];
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
  if (options.studentLearningLifecycle && trace?.learningRun) {
    try {
      learningSummary = await finalizeEvalLearningRun({
        memoryDir: resolveSweBenchStudentMemoryDir({
          workRoot: options.workRoot,
          instanceId: options.instance.instance_id,
          studentMemoryDir: options.studentMemoryDir,
        }),
        run: trace.learningRun,
        taskDescription: options.instance.problem_statement ?? '',
        gitDiff: patch,
        status: errorMessage ? 'failed' : 'success',
        finalSummary: trace.finalOutput || errorMessage || 'Eval run completed',
        totalTaskCount: options.learningTaskIndex,
        toolCalls: trace.toolCalls,
        recallAudit: trace.recallAudit,
        verificationStatus: 'pending',
        deferKnackPromotion: options.studentDeferKnackPromotion,
        repo: options.instance.repo,
      });
    } catch (err) {
      learningFinalizationError = err instanceof Error ? err.message : String(err);
      errorMessage = `Learning lifecycle finalization failed: ${learningFinalizationError}`;
    }
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
    learningSummary,
    learningFinalizationError,
    errorMessage,
    durationMs,
    ...(initialHead ? { initialHead } : {}),
    ...(options.instance.base_commit ? { expectedBaseCommit: options.instance.base_commit } : {}),
    worktreePath: options.keepWorktrees ? worktreePath : undefined,
    injectionSnapshot,
  };
}

export function resolveSweBenchStudentMemoryDir(options: {
  workRoot: string;
  instanceId: string;
  studentMemoryDir?: string;
}): string {
  return options.studentMemoryDir
    ? resolve(options.studentMemoryDir)
    : join(options.workRoot, '.student-agent-memory', safePathSegment(options.instanceId));
}

export async function resolveSweBenchStudentContext(options: {
  variant: ContextRuntimeEvalVariant;
  injectionMode?: StudentInjectionMode;
  memoryDir: string;
  task: EvalTaskDefinition;
  instruction: string;
  repository?: string;
}): Promise<{
  memoryDir: string;
  buildMemoryPrompt: InjectionPromptHook;
}> {
  await seedContextRuntimeEvalMemory({
    memoryDir: options.memoryDir,
    task: options.task,
    instruction: options.instruction,
  });
  const mode = options.injectionMode ?? (options.variant === 'plain' ? 'off' : 'recall');
  const buildMemoryPrompt = await createInjectionBuildMemoryPrompt(mode, options.memoryDir, {
    repository: options.repository,
  });
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
  const cached = cachedRepoSource(instance.repo);
  const source = cached ?? repoToCloneSource(instance.repo);
  await runProcess('git', ['clone', '--no-checkout', source, worktreePath], process.cwd(), 600);
  await checkoutBaseCommit(instance.base_commit, worktreePath);
}

function cachedRepoSource(repo: string): string | undefined {
  const root = process.env.SWEBENCH_REPO_CACHE?.trim();
  if (!root) return undefined;
  const bare = join(root, `${repo.replaceAll('/', '_')}.git`);
  try {
    accessSync(bare);
    return bare;
  } catch {
    return undefined;
  }
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
