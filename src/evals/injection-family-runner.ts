import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { ContextRuntimeEvalVariant, StudentInjectionMode } from './context-runtime-runner.js';
import {
  buildInjectionMemoryInventory,
  readEligibleInjectionRunIds,
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

export type InjectionArm = 'A-L' | 'A-K' | 'B' | 'C';
type Producer = (options: ProduceSweBenchPatchesOptions) => Promise<Pick<SweBenchPatchProducerResult, 'records'>>;
export interface HarnessScoreResult { resolved: boolean; summaryPath: string; instanceReportPath: string; summary: Record<string, unknown> }
export type HarnessScorer = (options: {
  pythonCommand: string; manifestPath: string; predictionsPath: string; instanceIds: string[];
  runId: string; preregPath: string; cwd: string;
}) => Promise<HarnessScoreResult>;

export interface FrozenInjectionSpec {
  version: string;
  frozen: boolean;
  sampling: { model: string; profile: string; thinking: string; temperature: number; topP: number; maxTokens: number };
  dataset: { commit: string; arrowSha256: string };
  families: Record<string, string[]>;
}

export interface InjectionFamilyRunOptions {
  familyId: string;
  arm: InjectionArm;
  instancesPath: string;
  resultsDir: string;
  preregPath: string;
  harnessPython?: string;
  snapshotManifest?: string;
  keepWorktrees?: boolean;
  dryRun?: boolean;
  /** 1-based recovery point. Earlier completed empty-patch runs are retained. */
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
  if (arm === 'B') return { variant: 'context_runtime', injectionMode: 'off' };
  return { variant: 'context_runtime', injectionMode: 'lesson-full' };
}

export async function readFrozenInjectionSpec(path: string): Promise<FrozenInjectionSpec> {
  const text = await readFile(path, 'utf8');
  const value = (patterns: RegExp[], label: string): string => {
    for (const pattern of patterns) {
      const match = text.match(pattern)?.[1];
      if (match) return match;
    }
    throw new Error(`Frozen preregistration is missing ${label}`);
  };
  return {
    version: value([
      /^\| 版本 \| \**(v\d+(?:\.\d+)*)\**/mu,
      /^# .*?\b(v\d+(?:\.\d+)*)\b/mu,
    ], 'preregistration version'),
    frozen: /^状态[:：].*已冻结/mu.test(text),
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

export async function runInjectionFamily(
  options: InjectionFamilyRunOptions,
  dependencies: InjectionFamilyDependencies,
) {
  const spec = await readFrozenInjectionSpec(options.preregPath);
  if (!options.dryRun && !spec.frozen) {
    throw new Error(`${spec.version} preregistration is not frozen`);
  }
  if (!options.dryRun && (!options.harnessPython || !options.snapshotManifest)) {
    throw new Error('Formal runs require explicit harnessPython and snapshotManifest');
  }
  const instanceIds = spec.families[options.familyId];
  if (!instanceIds?.length) throw new Error(`Unknown frozen family: ${options.familyId}`);
  const instanceById = new Map((await loadSweBenchInstances(options.instancesPath)).map((item) => [item.instance_id, item]));
  const arm = resolveInjectionArm(options.arm);
  const memoryDir = join(options.resultsDir, 'memory', options.arm, options.familyId);
  const batchDir = join(options.resultsDir, options.arm, options.familyId);
  const instrumentCommit = await currentCommit();
  const manifest = { ...spec, preregVersion: spec.version, instrumentCommit,
    familyId: options.familyId, arm: options.arm, ...arm, memoryDir, instances: instanceIds };
  await mkdir(batchDir, { recursive: true });
  if (options.dryRun) {
    await writeFile(join(batchDir, 'batch.json'), JSON.stringify({ ...manifest, dryRun: true }, null, 2));
    return { memoryDir, batchDir, runDirs: [] as string[] };
  }

  const resumeFromTask = options.resumeFromTask ?? 1;
  if (!Number.isInteger(resumeFromTask) || resumeFromTask < 1 || resumeFromTask > instanceIds.length) {
    throw new Error(`resumeFromTask must be between 1 and ${instanceIds.length}`);
  }
  if (resumeFromTask === 1) {
    await rm(memoryDir, { recursive: true, force: true });
    await mkdir(memoryDir, { recursive: true });
  } else {
    await mkdir(memoryDir, { recursive: false }).catch((error) => {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
    });
  }
  process.env.STUDENT_AGENT_PROVIDER_PROFILE = spec.sampling.profile;
  process.env.STUDENT_AGENT_EVAL_FROZEN_SAMPLING = JSON.stringify(spec.sampling);
  const produce = dependencies.produce ?? produceSweBenchPatches;
  const runDirs: string[] = [];
  for (let index = 0; index < resumeFromTask - 1; index++) {
    const instanceId = instanceIds[index]!;
    const runDir = join(batchDir, `${index + 1}-${instanceId}`);
    const record = await readPersistedRecord(runDir, instanceId);
    if (!isContinuableEmptyPatch(record)) {
      throw new Error(`Cannot resume past ${instanceId}: prior run is not an auditable empty patch`);
    }
    await finalizeEmptyPatchRun({ memoryDir, runDir, instanceId, index, record,
      beforeInventory: index === 0 ? emptyInventory() : await buildInjectionMemoryInventory(memoryDir) });
    runDirs.push(runDir);
  }
  for (const [index, instanceId] of instanceIds.entries()) {
    if (index < resumeFromTask - 1) continue;
    const instance = instanceById.get(instanceId);
    if (!instance) throw new Error(`Frozen input is missing ${instanceId}`);
    const runDir = join(batchDir, `${index + 1}-${instanceId}`);
    await mkdir(runDir, { recursive: true });
    const beforeInventory = await buildInjectionMemoryInventory(memoryDir);
    const result = await produce({
      instancesPath: options.instancesPath, agent: 'student-agent', outputDir: runDir,
      instanceIds: [instanceId], modelNameOrPath: spec.sampling.model,
      keepWorktrees: options.keepWorktrees, studentVariant: arm.variant,
      studentInjectionMode: arm.injectionMode, studentMemoryDir: memoryDir,
      studentLearningLifecycle: true, studentLearningTaskOffset: index,
      studentDeferKnackPromotion: true,
    });
    const record = result.records[0];
    const runId = record?.trace?.learningRun?.runId;
    const taskId = record?.trace?.learningRun?.taskId;
    if (!record?.trace || !runId || !taskId || typeof record.injectionSnapshot !== 'string') {
      throw new Error(`Missing required audit artifacts for ${instanceId}`);
    }
    await persistAgentArtifacts(runDir, memoryDir, runId, record);
    if (isContinuableEmptyPatch(record)) {
      await finalizeEmptyPatchRun({ memoryDir, runDir, instanceId, index, record, beforeInventory });
      runDirs.push(runDir);
      await writeFile(join(batchDir, 'batch.json'), JSON.stringify({ ...manifest, dryRun: false, runDirs }, null, 2));
      continue;
    }
    if (record.status === 'failed') throw new Error(`Run failed for ${instanceId}: ${record.errorMessage ?? 'unknown error'}`);

    const harness = await dependencies.score({
      pythonCommand: resolve(options.harnessPython!), manifestPath: resolve(options.snapshotManifest!),
      predictionsPath: join(runDir, 'predictions.jsonl'), instanceIds: [instanceId],
      runId: safeRunId(`${options.familyId}-${options.arm}-${index + 1}-${instanceId}`),
      preregPath: options.preregPath, cwd: runDir,
    });
    await new RunArchiveWriter({ memoryDir }).updateVerification(runId, {
      status: harness.resolved ? 'passed' : 'failed',
      evidenceRef: join(runDir, 'harness-instance-report.json'),
    });
    const admission = await recordInjectionAdmission(memoryDir, { runId, taskId, instanceId, resolved: harness.resolved });
    // Lessons are born online during the run; the harness only graduates them.
    const distillation = harness.resolved
      ? { source: 'online', ...await promoteRunLessonsAfterHarness({
        memoryDir, sessionRef: runId, reward: 1, promotedAt: admission.recordedAt,
      }) }
      : { source: 'online', promoted: 0,
        skipped: [{ instanceId, reason: 'harness_unresolved_not_admitted' }] };
    const eligibleRunIds = await readEligibleInjectionRunIds(memoryDir);
    const knacksPromoted = await promoteHarnessEligibleLessons({
      memoryDir, eligibleRunIds, totalTaskCount: index + 1,
    });
    const afterInventory = await buildInjectionMemoryInventory(memoryDir);
    await Promise.all([
      writeFile(join(runDir, 'admission.json'), JSON.stringify({ admission, harness: harness.summary,
        distillation, knacksPromoted }, null, 2)),
      writeFile(join(runDir, 'memory-inventory.json'), JSON.stringify({ before: beforeInventory, after: afterInventory }, null, 2)),
    ]);
    runDirs.push(runDir);
    await writeFile(join(batchDir, 'batch.json'), JSON.stringify({ ...manifest, dryRun: false, runDirs }, null, 2));
  }
  return { memoryDir, batchDir, runDirs };
}

function isContinuableEmptyPatch(record: SweBenchPatchProducerResult['records'][number]): boolean {
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
  record: SweBenchPatchProducerResult['records'][number];
  beforeInventory: Awaited<ReturnType<typeof buildInjectionMemoryInventory>>;
}): Promise<void> {
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
}

async function readPersistedRecord(
  runDir: string,
  instanceId: string,
): Promise<SweBenchPatchProducerResult['records'][number]> {
  const parsed = JSON.parse(await readFile(join(runDir, 'records.json'), 'utf8')) as SweBenchPatchProducerResult;
  const record = parsed.records?.find((item) => item.instanceId === instanceId);
  if (!record) throw new Error(`Missing persisted record for ${instanceId}`);
  return record;
}

function emptyInventory(): Awaited<ReturnType<typeof buildInjectionMemoryInventory>> {
  return {
    admittedRunIds: [], rejectedRunIds: [], mainLessonIds: [], eligibleLessonIds: [],
    ephemeralLessonIds: [], knackIds: [], eligibleKnackIds: [],
  };
}

function parseFamilies(text: string): Record<string, string[]> {
  const appendix = text.split('## 附录 A')[1] ?? '';
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

async function persistAgentArtifacts(runDir: string, memoryDir: string, runId: string, record: SweBenchPatchProducerResult['records'][number]) {
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
