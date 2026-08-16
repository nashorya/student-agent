import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { ContextRuntimeEvalVariant, StudentInjectionMode } from './context-runtime-runner.js';
import {
  buildInjectionMemoryInventory,
  readEligibleInjectionRunIds,
  readInjectionAdmissions,
  recordInjectionAdmission,
} from './injection-admission.js';
import {
  promoteHarnessEligibleLessons,
  promoteRunLessonsAfterHarness,
} from './eval-learning-lifecycle.js';
import { RunArchiveWriter } from '../memory/run-archive/run-archive-writer.js';
import {
  loadSweBenchInstances,
  produceSweBenchPatches,
  type ProduceSweBenchPatchesOptions,
  type SweBenchPatchProducerResult,
} from './swebench-patch-producer.js';

/**
 * v0.4 is a three-arm design. The v0.3 `C` (`lesson-full`) arm was retired
 * because a family pool of at most two lessons cannot distinguish full
 * residency from on-demand recall; the `lesson-full` injection mode itself
 * stays available for other evals.
 */
export type InjectionArm = 'A-L' | 'A-K' | 'B';
export const INJECTION_ARMS: readonly InjectionArm[] = ['A-L', 'A-K', 'B'];
/** Task 1 of every family is the shared seed run, executed once per family. */
export const SEED_TASK_NUMBER = 1;
/** The arm phase covers task 2 onward. */
export const FIRST_ARM_TASK_NUMBER = 2;

type Producer = (options: ProduceSweBenchPatchesOptions) => Promise<Pick<SweBenchPatchProducerResult, 'records'>>;
type ProducedRecord = SweBenchPatchProducerResult['records'][number];
type MemoryInventory = Awaited<ReturnType<typeof buildInjectionMemoryInventory>>;

export interface HarnessScoreResult { resolved: boolean; summaryPath: string; instanceReportPath: string; summary: Record<string, unknown> }
export type HarnessScorer = (options: {
  pythonCommand: string; manifestPath: string; predictionsPath: string; instanceIds: string[];
  runId: string; preregPath: string; cwd: string;
}) => Promise<HarnessScoreResult>;

export interface InjectionSpec {
  version: string;
  /** Digest of the spec file itself, so a reformat cannot silently change parameters. */
  sha256: string;
  sampling: { model: string; profile: string; thinking: string; temperature: number; topP: number; maxTokens: number };
  dataset: { commit: string; arrowSha256: string };
  families: Record<string, string[]>;
}

export interface InjectionSeedRunOptions {
  familyId: string;
  instancesPath: string;
  resultsDir: string;
  preregPath: string;
  harnessPython?: string;
  snapshotManifest?: string;
  keepWorktrees?: boolean;
  dryRun?: boolean;
}

export interface InjectionSeedRunResult {
  resolved: boolean;
  memoryDir: string;
  seedDir: string;
  runDir: string;
  instanceId: string;
}

export interface InjectionFamilyRunOptions {
  familyId: string;
  arm: InjectionArm;
  instancesPath: string;
  resultsDir: string;
  preregPath: string;
  /** Memory root produced by the family seed phase; copied in as the arm's starting memory. */
  seedMemoryDir?: string;
  harnessPython?: string;
  snapshotManifest?: string;
  keepWorktrees?: boolean;
  dryRun?: boolean;
  /** 1-based recovery point within the family (>= 2). Earlier empty-patch runs are retained. */
  resumeFromTask?: number;
}

export interface InjectionFamilyDependencies {
  produce?: Producer;
  score: HarnessScorer;
}

export function resolveInjectionArm(arm: InjectionArm): {
  variant: ContextRuntimeEvalVariant;
  injectionMode: StudentInjectionMode;
} {
  if (arm === 'A-L') return { variant: 'context_runtime', injectionMode: 'lesson-recall' };
  if (arm === 'A-K') return { variant: 'context_runtime', injectionMode: 'knack-recall' };
  return { variant: 'context_runtime', injectionMode: 'off' };
}

export async function readInjectionSpec(path: string): Promise<InjectionSpec> {
  const raw = await readFile(path);
  const text = raw.toString('utf8');
  const value = (patterns: RegExp[], label: string): string => {
    for (const pattern of patterns) {
      const match = text.match(pattern)?.[1];
      if (match) return match;
    }
    throw new Error(`Injection spec is missing ${label}`);
  };
  return {
    version: value([
      /^\| 版本 \| \**(v\d+(?:\.\d+)*)\**/mu,
      /^# .*?\b(v\d+(?:\.\d+)*)\b/mu,
    ], 'spec version'),
    sha256: createHash('sha256').update(raw).digest('hex'),
    sampling: {
      model: value([/^\| model \| `([^`]+)`/mu, /^\| 模型 \| `([^`]+)`/mu], 'model'),
      profile: value([/^\| provider profile \| `([^`]+)`/mu, /provider profile `([^`]+)`/u], 'provider profile'),
      thinking: value([/^\| thinking \| `([^`]+)`/mu], 'thinking'),
      temperature: Number(value([/^\| temperature \| `([^`]+)`/mu], 'temperature')),
      topP: Number(value([/^\| top_p \| `([^`]+)/mu], 'top_p')),
      maxTokens: Number(value([/^\| max_tokens \| `([^`]+)`/mu], 'max_tokens')),
    },
    dataset: {
      commit: value([/数据仓库 commit(?: SHA)?[：:]?\s*`([^`]+)`/u], 'dataset commit'),
      arrowSha256: value([/(?:解码 test Arrow|test Arrow) SHA-256[：:]?\s*`([^`]+)`/u], 'Arrow SHA-256'),
    },
    families: parseFamilies(text),
  };
}

/**
 * Phase A. Runs task 1 of the family exactly once, with injection off, into a
 * family-scoped seed memory root. Every arm later starts from a copy of it, so
 * task 2 compares arms whose memory pools are identical by construction.
 */
export async function runInjectionFamilySeed(
  options: InjectionSeedRunOptions,
  dependencies: InjectionFamilyDependencies,
): Promise<InjectionSeedRunResult> {
  const spec = await readInjectionSpec(options.preregPath);
  assertRunnable(options);
  const instanceIds = requireFamily(spec, options.familyId);
  const instanceId = instanceIds[0]!;
  const memoryDir = seedMemoryDirFor(options.resultsDir, options.familyId);
  const seedDir = join(options.resultsDir, 'seed', options.familyId);
  await mkdir(seedDir, { recursive: true });

  const manifest = {
    ...spec,
    preregVersion: spec.version,
    preregSha256: spec.sha256,
    instrumentCommit: await currentCommit(),
    phase: 'seed' as const,
    familyId: options.familyId,
    injectionMode: 'off' as const,
    memoryDir,
    instances: [instanceId],
  };
  if (options.dryRun) {
    await writeFile(join(seedDir, 'batch.json'), JSON.stringify({ ...manifest, dryRun: true }, null, 2));
    return { resolved: false, memoryDir, seedDir, runDir: '', instanceId };
  }

  await rm(memoryDir, { recursive: true, force: true });
  await mkdir(memoryDir, { recursive: true });
  applyPinnedSampling(spec);

  const context = await instanceContext(options, spec, {
    memoryDir,
    batchDir: seedDir,
    injectionMode: 'off',
    dependencies,
  });
  const outcome = await runOneInstance(context, 0, instanceId, emptyInventory());
  await writeFile(join(seedDir, 'batch.json'), JSON.stringify({
    ...manifest, dryRun: false, resolved: outcome.resolved, runDir: outcome.runDir,
    inventory: outcome.afterInventory,
  }, null, 2));
  return { resolved: outcome.resolved, memoryDir, seedDir, runDir: outcome.runDir, instanceId };
}

/**
 * Phase B. Copies the family seed memory into the arm root and runs tasks 2..N.
 * Refuses to start when the seed is unresolved: the pool would be empty, every
 * arm would be identical, and the family yields no injection contrast at all.
 */
export async function runInjectionFamily(
  options: InjectionFamilyRunOptions,
  dependencies: InjectionFamilyDependencies,
) {
  const spec = await readInjectionSpec(options.preregPath);
  assertRunnable(options);
  const instanceIds = requireFamily(spec, options.familyId);
  const arm = resolveInjectionArm(options.arm);
  const memoryDir = join(options.resultsDir, 'memory', options.arm, options.familyId);
  const batchDir = join(options.resultsDir, options.arm, options.familyId);
  const seedMemoryDir = options.seedMemoryDir ?? seedMemoryDirFor(options.resultsDir, options.familyId);
  const manifest = {
    ...spec,
    preregVersion: spec.version,
    preregSha256: spec.sha256,
    instrumentCommit: await currentCommit(),
    phase: 'arms' as const,
    familyId: options.familyId,
    arm: options.arm,
    ...arm,
    memoryDir,
    seedMemoryDir,
    instances: instanceIds.slice(FIRST_ARM_TASK_NUMBER - 1),
  };
  await mkdir(batchDir, { recursive: true });
  if (options.dryRun) {
    await writeFile(join(batchDir, 'batch.json'), JSON.stringify({ ...manifest, dryRun: true }, null, 2));
    return { memoryDir, batchDir, runDirs: [] as string[] };
  }

  const startTask = options.resumeFromTask ?? FIRST_ARM_TASK_NUMBER;
  if (!Number.isInteger(startTask) || startTask < FIRST_ARM_TASK_NUMBER || startTask > instanceIds.length) {
    throw new Error(`resumeFromTask must be between ${FIRST_ARM_TASK_NUMBER} and ${instanceIds.length}`);
  }
  await assertSeedUsable(seedMemoryDir, options.familyId);
  let seedEligible: Pick<MemoryInventory, 'eligibleLessonIds' | 'eligibleKnackIds'> | undefined;
  if (startTask === FIRST_ARM_TASK_NUMBER) {
    seedEligible = await copySeedMemory(seedMemoryDir, memoryDir, options.familyId);
  }
  applyPinnedSampling(spec);

  const context = await instanceContext(options, spec, {
    memoryDir, batchDir, injectionMode: arm.injectionMode, dependencies,
  });
  const runDirs: string[] = [];
  const persist = async () => writeFile(join(batchDir, 'batch.json'), JSON.stringify({
    ...manifest, dryRun: false, runDirs,
    resumedFromTask: startTask, resumed: startTask > FIRST_ARM_TASK_NUMBER,
    ...(seedEligible ? { seedCopyVerified: true, seedEligible } : {}),
  }, null, 2));

  // Replay the audit trail of already-completed empty-patch tasks so a resumed
  // batch keeps a full manifest. Re-recording is keyed by runId and idempotent.
  for (let index = FIRST_ARM_TASK_NUMBER - 1; index < startTask - 1; index++) {
    const instanceId = instanceIds[index]!;
    const runDir = join(batchDir, `${index + 1}-${instanceId}`);
    const record = await readPersistedRecord(runDir, instanceId);
    if (!isContinuableEmptyPatch(record)) {
      throw new Error(`Cannot resume past ${instanceId}: prior run is not an auditable empty patch`);
    }
    await finalizeEmptyPatchRun({
      memoryDir, runDir, instanceId, index, record,
      beforeInventory: await buildInjectionMemoryInventory(memoryDir),
    });
    runDirs.push(runDir);
  }

  for (const [index, instanceId] of instanceIds.entries()) {
    if (index < startTask - 1) continue;
    const beforeInventory = await buildInjectionMemoryInventory(memoryDir);
    const outcome = await runOneInstance(context, index, instanceId, beforeInventory);
    runDirs.push(outcome.runDir);
    await persist();
  }
  if (!runDirs.length) await persist();
  return { memoryDir, batchDir, runDirs };
}

interface InstanceContext {
  memoryDir: string;
  batchDir: string;
  instancesPath: string;
  preregPath: string;
  familyId: string;
  scopeLabel: string;
  variant: ContextRuntimeEvalVariant;
  injectionMode: StudentInjectionMode;
  model: string;
  keepWorktrees?: boolean;
  harnessPython?: string;
  snapshotManifest?: string;
  instanceById: Map<string, Awaited<ReturnType<typeof loadSweBenchInstances>>[number]>;
  produce: Producer;
  score: HarnessScorer;
}

async function instanceContext(
  options: {
    familyId: string; instancesPath: string; preregPath: string; arm?: InjectionArm;
    keepWorktrees?: boolean; harnessPython?: string; snapshotManifest?: string;
  },
  spec: InjectionSpec,
  scope: {
    memoryDir: string; batchDir: string; injectionMode: StudentInjectionMode;
    dependencies: InjectionFamilyDependencies;
  },
): Promise<InstanceContext> {
  return {
    memoryDir: scope.memoryDir,
    batchDir: scope.batchDir,
    instancesPath: options.instancesPath,
    preregPath: options.preregPath,
    familyId: options.familyId,
    scopeLabel: options.arm ?? 'seed',
    variant: 'context_runtime',
    injectionMode: scope.injectionMode,
    model: spec.sampling.model,
    ...(options.keepWorktrees === undefined ? {} : { keepWorktrees: options.keepWorktrees }),
    ...(options.harnessPython === undefined ? {} : { harnessPython: options.harnessPython }),
    ...(options.snapshotManifest === undefined ? {} : { snapshotManifest: options.snapshotManifest }),
    instanceById: new Map((await loadSweBenchInstances(options.instancesPath)).map((item) => [item.instance_id, item])),
    produce: scope.dependencies.produce ?? produceSweBenchPatches,
    score: scope.dependencies.score,
  };
}

/**
 * One frozen instance end to end: produce a patch, score it with the pinned
 * harness, then admit and promote the memory it produced. `index` is the
 * family-global 0-based task position, shared by the seed and arm phases.
 */
async function runOneInstance(
  context: InstanceContext,
  index: number,
  instanceId: string,
  beforeInventory: MemoryInventory,
): Promise<{ runDir: string; resolved: boolean; afterInventory: MemoryInventory }> {
  if (!context.instanceById.has(instanceId)) throw new Error(`Frozen input is missing ${instanceId}`);
  const runDir = join(context.batchDir, `${index + 1}-${instanceId}`);
  await mkdir(runDir, { recursive: true });
  const result = await context.produce({
    instancesPath: context.instancesPath, agent: 'student-agent', outputDir: runDir,
    instanceIds: [instanceId], modelNameOrPath: context.model,
    keepWorktrees: context.keepWorktrees, studentVariant: context.variant,
    studentInjectionMode: context.injectionMode, studentMemoryDir: context.memoryDir,
    studentLearningLifecycle: true, studentLearningTaskOffset: index,
    studentDeferKnackPromotion: true,
  });
  const record = result.records[0];
  const runId = record?.trace?.learningRun?.runId;
  const taskId = record?.trace?.learningRun?.taskId;
  if (!record?.trace || !runId || !taskId || typeof record.injectionSnapshot !== 'string') {
    throw new Error(`Missing required audit artifacts for ${instanceId}`);
  }
  await persistAgentArtifacts(runDir, context.memoryDir, runId, record);
  if (isContinuableEmptyPatch(record)) {
    const afterInventory = await finalizeEmptyPatchRun({
      memoryDir: context.memoryDir, runDir, instanceId, index, record, beforeInventory,
    });
    return { runDir, resolved: false, afterInventory };
  }
  if (record.status === 'failed') {
    throw new Error(`Run failed for ${instanceId}: ${record.errorMessage ?? 'unknown error'}`);
  }

  const harness = await context.score({
    pythonCommand: resolve(context.harnessPython!), manifestPath: resolve(context.snapshotManifest!),
    predictionsPath: join(runDir, 'predictions.jsonl'), instanceIds: [instanceId],
    runId: safeRunId(`${context.familyId}-${context.scopeLabel}-${index + 1}-${instanceId}`),
    preregPath: context.preregPath, cwd: runDir,
  });
  await new RunArchiveWriter({ memoryDir: context.memoryDir }).updateVerification(runId, {
    status: harness.resolved ? 'passed' : 'failed',
    evidenceRef: join(runDir, 'harness-instance-report.json'),
  });
  const admission = await recordInjectionAdmission(context.memoryDir, {
    runId, taskId, instanceId, resolved: harness.resolved,
  });
  // Lessons are born online during the run; the harness only graduates them.
  const distillation = harness.resolved
    ? { source: 'online', ...await promoteRunLessonsAfterHarness({
      memoryDir: context.memoryDir, sessionRef: runId, reward: 1, promotedAt: admission.recordedAt,
    }) }
    : { source: 'online', promoted: 0,
      skipped: [{ instanceId, reason: 'harness_unresolved_not_admitted' }] };
  const eligibleRunIds = await readEligibleInjectionRunIds(context.memoryDir);
  const knacksPromoted = await promoteHarnessEligibleLessons({
    memoryDir: context.memoryDir, eligibleRunIds, totalTaskCount: index + 1,
  });
  const afterInventory = await buildInjectionMemoryInventory(context.memoryDir);
  await Promise.all([
    writeFile(join(runDir, 'admission.json'), JSON.stringify({ admission, harness: harness.summary,
      distillation, knacksPromoted }, null, 2)),
    writeFile(join(runDir, 'memory-inventory.json'), JSON.stringify({ before: beforeInventory, after: afterInventory }, null, 2)),
  ]);
  return { runDir, resolved: harness.resolved, afterInventory };
}

/**
 * Misfire guard, not an approval gate: a real run must name its harness and its
 * pinned snapshot explicitly, because the scorer has no safe default for either.
 */
function assertRunnable(options: { dryRun?: boolean; harnessPython?: string; snapshotManifest?: string }): void {
  if (options.dryRun) return;
  if (!options.harnessPython || !options.snapshotManifest) {
    throw new Error('A real run requires explicit harnessPython and snapshotManifest');
  }
}

function requireFamily(spec: InjectionSpec, familyId: string): string[] {
  const instanceIds = spec.families[familyId];
  if (!instanceIds?.length) throw new Error(`Unknown family: ${familyId}`);
  return instanceIds;
}

function seedMemoryDirFor(resultsDir: string, familyId: string): string {
  return join(resultsDir, 'memory', 'seed', familyId);
}

function applyPinnedSampling(spec: InjectionSpec): void {
  process.env.STUDENT_AGENT_PROVIDER_PROFILE = spec.sampling.profile;
  process.env.STUDENT_AGENT_EVAL_FROZEN_SAMPLING = JSON.stringify(spec.sampling);
}

/** Seed gate: an unresolved seed means the family produces no injection contrast. */
async function assertSeedUsable(seedMemoryDir: string, familyId: string): Promise<void> {
  const admissions = await readInjectionAdmissions(seedMemoryDir);
  if (!admissions.length) {
    throw new Error(`Missing seed admission for ${familyId} at ${seedMemoryDir}: run the seed phase first`);
  }
  if (!admissions.some((entry) => entry.resolved)) {
    throw new Error(
      `Refusing the arm phase for ${familyId}: the family seed run is unresolved, `
      + 'so no injection contrast can exist and the family is void for the primary analysis',
    );
  }
}

async function copySeedMemory(
  seedMemoryDir: string,
  memoryDir: string,
  familyId: string,
): Promise<Pick<MemoryInventory, 'eligibleLessonIds' | 'eligibleKnackIds'>> {
  await rm(memoryDir, { recursive: true, force: true });
  await mkdir(join(memoryDir, '..'), { recursive: true });
  await cp(seedMemoryDir, memoryDir, { recursive: true });
  const [seed, copied] = await Promise.all([
    buildInjectionMemoryInventory(seedMemoryDir),
    buildInjectionMemoryInventory(memoryDir),
  ]);
  const same = (left: string[], right: string[]): boolean =>
    left.length === right.length && left.every((value, index) => value === right[index]);
  if (!same(seed.eligibleLessonIds, copied.eligibleLessonIds)
    || !same(seed.eligibleKnackIds, copied.eligibleKnackIds)) {
    throw new Error(`Seed memory copy for ${familyId} does not match the seed eligible set`);
  }
  return { eligibleLessonIds: copied.eligibleLessonIds, eligibleKnackIds: copied.eligibleKnackIds };
}

function isContinuableEmptyPatch(record: ProducedRecord): boolean {
  return record.status === 'failed'
    && record.emptyPatch === true
    && record.errorMessage === 'Agent produced an empty patch'
    && record.trace?.status === 'success';
}

async function finalizeEmptyPatchRun(options: {
  memoryDir: string;
  runDir: string;
  instanceId: string;
  index: number;
  record: ProducedRecord;
  beforeInventory: MemoryInventory;
}): Promise<MemoryInventory> {
  const runId = options.record.trace?.learningRun?.runId;
  const taskId = options.record.trace?.learningRun?.taskId;
  if (!runId || !taskId) throw new Error(`Missing learning identity for empty patch ${options.instanceId}`);
  await new RunArchiveWriter({ memoryDir: options.memoryDir }).updateVerification(runId, {
    status: 'failed', evidenceRef: join(options.runDir, 'predictions.jsonl'),
  });
  const admission = await recordInjectionAdmission(options.memoryDir, {
    runId, taskId, instanceId: options.instanceId, resolved: false,
  });
  const eligibleRunIds = await readEligibleInjectionRunIds(options.memoryDir);
  const knacksPromoted = await promoteHarnessEligibleLessons({
    memoryDir: options.memoryDir, eligibleRunIds, totalTaskCount: options.index + 1,
  });
  const afterInventory = await buildInjectionMemoryInventory(options.memoryDir);
  await Promise.all([
    writeFile(join(options.runDir, 'admission.json'), JSON.stringify({
      admission,
      harness: null,
      harnessSkipped: { reason: 'empty_patch_counted_unresolved', resolved: false },
      distillation: { distilled: [], admitted: [], promoted: 0,
        skipped: [{ instanceId: options.instanceId, reason: 'empty_patch_not_admitted' }] },
      knacksPromoted,
    }, null, 2)),
    writeFile(join(options.runDir, 'memory-inventory.json'), JSON.stringify({
      before: options.beforeInventory, after: afterInventory,
    }, null, 2)),
  ]);
  return afterInventory;
}

async function readPersistedRecord(runDir: string, instanceId: string): Promise<ProducedRecord> {
  const parsed = JSON.parse(await readFile(join(runDir, 'records.json'), 'utf8')) as SweBenchPatchProducerResult;
  const record = parsed.records?.find((item) => item.instanceId === instanceId);
  if (!record) throw new Error(`Missing persisted record for ${instanceId}`);
  return record;
}

function emptyInventory(): MemoryInventory {
  return {
    admittedRunIds: [], rejectedRunIds: [], mainLessonIds: [], eligibleLessonIds: [],
    ephemeralLessonIds: [], knackIds: [], eligibleKnackIds: [],
  };
}

function parseFamilies(text: string): Record<string, string[]> {
  // v0.4 titles the appendix "## 附录 A", v0.5 numbers it "## 7. 附录 A".
  const appendix = text.split(/^## (?:\d+\.\s*)?附录 A/mu)[1] ?? '';
  const families: Record<string, string[]> = {};
  let current = '';
  for (const line of appendix.split(/\r?\n/u)) {
    const match = line.match(/^\|\s*(?:`([^`]+)`)?\s*\|\s*([123])\s*\|\s*`([^`]+)`/u);
    if (!match) continue;
    if (match[1]) current = match[1];
    if (current) (families[current] ??= [])[Number(match[2]) - 1] = match[3]!;
  }
  return families;
}

async function persistAgentArtifacts(runDir: string, memoryDir: string, runId: string, record: ProducedRecord) {
  const events = await readFile(join(memoryDir, 'runs', runId, 'events.jsonl'), 'utf8');
  await Promise.all([
    writeFile(join(runDir, 'trace.json'), JSON.stringify(record.trace, null, 2)),
    writeFile(join(runDir, 'events.jsonl'), events),
    writeFile(join(runDir, 'injection.txt'), record.injectionSnapshot ?? ''),
  ]);
}

async function currentCommit(): Promise<string> {
  try { return (await promisify(execFile)('git', ['rev-parse', 'HEAD'])).stdout.trim(); }
  catch { return 'unknown'; }
}

function safeRunId(value: string): string { return value.replace(/[^A-Za-z0-9_.-]+/gu, '-').slice(0, 180); }
