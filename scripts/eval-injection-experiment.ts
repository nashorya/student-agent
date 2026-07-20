import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  produceSweBenchPatches,
  type ProduceSweBenchPatchesOptions,
  type SweBenchPatchProducerResult,
} from '../src/evals/swebench-patch-producer.js';
import type { ContextRuntimeEvalVariant, StudentInjectionMode } from '../src/evals/context-runtime-runner.js';

export type InjectionArm = 'A' | 'B' | 'C';
type Producer = (options: ProduceSweBenchPatchesOptions) => Promise<Pick<SweBenchPatchProducerResult, 'records'>>;
interface FrozenSpec {
  sampling: { model: string; profile: string; thinking: string; temperature: number; topP: number; maxTokens: number };
  dataset: { commit: string; arrowSha256: string };
  families: Record<string, string[]>;
}
interface RunOptions {
  familyId: string;
  arm: InjectionArm;
  instancesPath: string;
  resultsDir: string;
  preregPath: string;
  keepWorktrees?: boolean;
  dryRun?: boolean;
}

export function resolveInjectionArm(arm: InjectionArm): {
  variant: ContextRuntimeEvalVariant;
  injectionMode: StudentInjectionMode;
} {
  return arm === 'A'
    ? { variant: 'context_runtime', injectionMode: 'recall' }
    : arm === 'B'
      ? { variant: 'plain', injectionMode: 'off' }
      : { variant: 'context_runtime', injectionMode: 'full' };
}

export async function readFrozenInjectionSpec(path: string): Promise<FrozenSpec> {
  const text = await readFile(path, 'utf8');
  const value = (pattern: RegExp, label: string): string => {
    const match = text.match(pattern)?.[1];
    if (!match) throw new Error(`Frozen preregistration is missing ${label}`);
    return match;
  };
  const families: Record<string, string[]> = {};
  for (const match of text.matchAll(/^\| (?:[^|]*? · )?`([^`]+)` \| ([123]) \| `([^`]+)`/gmu)) {
    const [, family, order, instanceId] = match;
    if (!family || !order || !instanceId) continue;
    (families[family] ??= [])[Number(order) - 1] = instanceId;
  }
  return {
    sampling: {
      model: value(/^\| 模型 \| `([^`]+)`/mu, 'model'),
      profile: value(/provider profile `([^`]+)`/u, 'provider profile'),
      thinking: value(/^\| thinking \| `([^`]+)`/mu, 'thinking'),
      temperature: Number(value(/^\| temperature \| `([^`]+)`/mu, 'temperature')),
      topP: Number(value(/^\| top_p \| `([^`]+)`/mu, 'top_p')),
      maxTokens: Number(value(/^\| max_tokens \| `([^`]+)`/mu, 'max_tokens')),
    },
    dataset: {
      commit: value(/数据仓库 commit SHA `([^`]+)`/u, 'dataset commit'),
      arrowSha256: value(/test Arrow SHA-256 `([^`]+)`/u, 'Arrow SHA-256'),
    },
    families,
  };
}

export async function runInjectionFamily(options: RunOptions, produce: Producer = produceSweBenchPatches) {
  const spec = await readFrozenInjectionSpec(options.preregPath);
  const instances = spec.families[options.familyId];
  if (!instances?.length) throw new Error(`Unknown frozen family: ${options.familyId}`);
  const arm = resolveInjectionArm(options.arm);
  const memoryDir = join(options.resultsDir, 'memory', options.arm, options.familyId);
  const batchDir = join(options.resultsDir, options.arm, options.familyId);
  const manifest = { familyId: options.familyId, arm: options.arm, ...arm, memoryDir, instances, ...spec };
  await mkdir(batchDir, { recursive: true });
  if (options.dryRun) {
    await writeFile(join(batchDir, 'batch.json'), JSON.stringify({ ...manifest, dryRun: true }, null, 2));
    return { memoryDir, batchDir, runDirs: [] as string[] };
  }
  await rm(memoryDir, { recursive: true, force: true });
  await mkdir(memoryDir, { recursive: true });
  process.env.STUDENT_AGENT_PROVIDER_PROFILE = spec.sampling.profile;
  process.env.STUDENT_AGENT_LLM_MAX_OUTPUT_TOKENS = String(spec.sampling.maxTokens);
  const runDirs: string[] = [];
  for (const [index, instanceId] of instances.entries()) {
    const runDir = join(batchDir, `${index + 1}-${instanceId}`);
    await mkdir(runDir, { recursive: true });
    const result = await produce({
      instancesPath: options.instancesPath,
      agent: 'student-agent',
      outputDir: runDir,
      instanceIds: [instanceId],
      modelNameOrPath: spec.sampling.model,
      keepWorktrees: options.keepWorktrees,
      studentVariant: arm.variant,
      studentInjectionMode: arm.injectionMode,
      studentMemoryDir: memoryDir,
      studentLearningLifecycle: true,
      studentLearningTaskOffset: index,
    });
    const record = result.records[0];
    if (!record) throw new Error(`No producer record for ${instanceId}`);
    const runId = record.trace?.learningRun?.runId;
    if (!record.trace || !runId || typeof record.injectionSnapshot !== 'string') {
      throw new Error(`Missing required audit artifacts for ${instanceId}`);
    }
    const events = await readFile(join(memoryDir, 'runs', runId, 'events.jsonl'), 'utf8');
    await Promise.all([
      writeFile(join(runDir, 'trace.json'), JSON.stringify(record.trace, null, 2)),
      writeFile(join(runDir, 'events.jsonl'), events),
      writeFile(join(runDir, 'injection.txt'), record.injectionSnapshot),
    ]);
    runDirs.push(runDir);
  }
  await writeFile(join(batchDir, 'batch.json'), JSON.stringify({ ...manifest, dryRun: false, runDirs }, null, 2));
  return { memoryDir, batchDir, runDirs };
}

function cli(args: string[]): RunOptions {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) if (args[i]?.startsWith('--') && args[i + 1] && !args[i + 1]?.startsWith('--')) values.set(args[i]!, args[++i]!);
  const required = (name: string): string => values.get(name) ?? (() => { throw new Error(`${name} is required`); })();
  const arm = required('--arm');
  if (!['A', 'B', 'C'].includes(arm)) throw new Error('--arm must be A, B, or C');
  return {
    familyId: required('--family'),
    arm: arm as InjectionArm,
    instancesPath: resolve(required('--instances-path')),
    resultsDir: resolve(values.get('--results-dir') ?? join('evals/results/injection-experiment', new Date().toISOString().replace(/[:.]/gu, '-'))),
    preregPath: resolve(values.get('--prereg') ?? 'docs/proposals/injection-effect-experiment-prereg-v0.md'),
    keepWorktrees: args.includes('--keep-worktrees'),
    dryRun: args.includes('--dry-run'),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runInjectionFamily(cli(process.argv.slice(2)))
    .then((result) => console.log(JSON.stringify({ ok: true, ...result }, null, 2)))
    .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
}
