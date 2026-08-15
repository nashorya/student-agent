/**
 * B-arm bare scan for family re-screening.
 *
 * Default is a dry-run listing. --run rescores existing non-empty patches only.
 * Model produce is opt-in (--produce) and never overwrites a real patch.
 *
 *   npx tsx scripts/scan-b-arm-families.ts --repo django
 *   npx tsx scripts/scan-b-arm-families.ts --repo django --run --score-only --harness-python ...
 *   npx tsx scripts/scan-b-arm-families.ts --repo sympy --run --produce --harness-python ...
 */
import { appendFile, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildRetryQueue,
  buildScanResult,
  estimateScanRuns,
  filterScanPool,
  inventoryReusableRuns,
  latestNonVoidedRow,
  loadReusableRun,
  normalizeScanResult,
  officialVerdictIds,
  parseLiteIdsFromBlob,
  parseScreeningTableInstances,
  proposeFamiliesFromFailures,
  type ScanInstance,
  type ScanVerdict,
} from '../src/evals/b-arm-scan.js';
import {
  loadSweBenchInstances,
  produceSweBenchPatches,
} from '../src/evals/swebench-patch-producer.js';
import { readInjectionSpec } from '../src/evals/injection-family-runner.js';
import { runPinnedScoring } from './eval-injection-score.js';
import { loadEnvFile } from '../src/core/env.js';
import { GLOBAL_CONFIG_DIR } from '../src/core/config/loader.js';

const SCREENING = 'docs/proposals/injection-effect-task-families.md';
const DEFAULT_ARROW = join(
  process.env.HOME ?? '',
  '.cache/huggingface/datasets/SWE-bench___swe-bench_lite/default/0.0.0',
  '69611d31007e1c6731db8bd5b5c3f2d33f5bab6e',
  'swe-bench_lite-test.arrow',
);

interface Cli {
  repo?: 'django' | 'sympy';
  run: boolean;
  produce: boolean;
  scoreOnly: boolean;
  instanceIds: string[];
  instancesPath?: string;
  resultsDir: string;
  harnessPython?: string;
  snapshotManifest?: string;
}

function parseArgs(args: string[]): Cli {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const instanceIds: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--instance-id' && args[i + 1] && !args[i + 1]!.startsWith('--')) {
      instanceIds.push(args[++i]!);
    } else if (arg.startsWith('--') && args[i + 1] && !args[i + 1]!.startsWith('--')) {
      values.set(arg, args[++i]!);
    } else if (arg.startsWith('--')) {
      flags.add(arg);
    }
  }
  const repo = values.get('--repo');
  if (repo && repo !== 'django' && repo !== 'sympy') {
    throw new Error('--repo must be django or sympy');
  }
  const run = flags.has('--run');
  const produce = flags.has('--produce');
  const scoreOnly = flags.has('--score-only') || (run && !produce);
  return {
    repo,
    run,
    produce,
    scoreOnly,
    instanceIds,
    instancesPath: values.get('--instances-path'),
    resultsDir: resolve(values.get('--results-dir') ?? 'evals/results/b-arm-scan'),
    harnessPython: values.get('--harness-python') ? resolve(values.get('--harness-python')!) : undefined,
    snapshotManifest: values.get('--snapshot-manifest') ? resolve(values.get('--snapshot-manifest')!) : undefined,
  };
}

export async function buildScanListing(options: {
  repo?: 'django' | 'sympy';
  instanceIds?: string[];
  instancesPath?: string;
  screeningPath?: string;
  arrowPath?: string;
}): Promise<{ instances: ScanInstance[]; estimatedRuns: number; repos: Record<string, number> }> {
  const screening = parseScreeningTableInstances(
    await readFile(options.screeningPath ?? SCREENING, 'utf8'),
  );
  let lite: ScanInstance[] = [];
  try {
    const blob = await readFile(options.arrowPath ?? DEFAULT_ARROW);
    lite = parseLiteIdsFromBlob(blob);
  } catch {
    lite = [];
  }
  const fromJsonl = options.instancesPath
    ? (await loadSweBenchInstances(options.instancesPath)).map((item) => ({
      instance_id: item.instance_id,
      repo: (item.repo?.includes('sympy') || item.instance_id.startsWith('sympy__')
        ? 'sympy' : 'django') as 'django' | 'sympy',
    }))
    : [];
  const merged = new Map<string, ScanInstance>();
  for (const item of [...lite, ...screening, ...fromJsonl]) {
    if (!merged.has(item.instance_id)) merged.set(item.instance_id, item);
  }
  let instances = filterScanPool([...merged.values()]
    .sort((a, b) => a.instance_id.localeCompare(b.instance_id)), options.repo);
  if (options.instanceIds && options.instanceIds.length > 0) {
    const wanted = new Set(options.instanceIds);
    instances = instances.filter((item) => wanted.has(item.instance_id));
    const missing = options.instanceIds.filter((id) => !instances.some((item) => item.instance_id === id));
    if (missing.length > 0) throw new Error(`Unknown --instance-id: ${missing.join(', ')}`);
  }
  return { instances, ...estimateScanRuns(instances) };
}

async function main(): Promise<void> {
  await loadEnvFile({ cwd: GLOBAL_CONFIG_DIR, filename: '.env', override: true });
  if (!process.env.ZHIPU_API_KEY) {
    throw new Error(`ZHIPU_API_KEY missing after loading ${GLOBAL_CONFIG_DIR}/.env`);
  }
  process.env.ZAI_CODING_CN_API_KEY ??= process.env.ZHIPU_API_KEY;
  process.env.DOCKER_DEFAULT_PLATFORM ??= 'linux/amd64';
  const options = parseArgs(process.argv.slice(2));
  const listing = await buildScanListing({
    repo: options.repo,
    instanceIds: options.instanceIds,
    instancesPath: options.instancesPath,
  });
  await mkdir(options.resultsDir, { recursive: true });
  const resultsPath = join(options.resultsDir, `${options.repo ?? 'all'}-results.jsonl`);
  await migrateResultsFile(resultsPath);
  await writeRetryQueue(options.resultsDir, resultsPath).catch(() => undefined);
  const frozen = await freezeReusableRuns(options.resultsDir);
  const report = {
    dryRun: !options.run,
    repo: options.repo ?? 'django+sympy',
    estimatedRuns: listing.estimatedRuns,
    repos: listing.repos,
    instances: listing.instances,
    frozenPatches: frozen.map((item) => ({
      instance_id: item.instance_id,
      predictionsPath: item.predictionsPath,
      patchBytes: item.model_patch.length,
      tokens: item.tokens,
    })),
    note: options.run
      ? (options.scoreOnly
        ? 'Score-only: reuse existing non-empty predictions.jsonl, never produce.'
        : 'Live produce is opt-in via --produce; existing non-empty patches are never overwritten.')
      : 'Dry-run listing only. Pass --run to rescore frozen patches, or --run --produce to generate missing ones.',
  };
  await writeFile(
    join(options.resultsDir, `${options.repo ?? 'all'}-listing.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify({
    samplingHint: 'Use frozen v0.5 glm-5.3 / zhipu-glm-5.3',
    ...report,
    instanceIds: listing.instances.map((item) => item.instance_id),
  }, null, 2));
  if (!options.run) return;
  if (!options.harnessPython || !options.snapshotManifest || !options.instancesPath) {
    throw new Error('--run requires --instances-path, --harness-python, and --snapshot-manifest');
  }
  const stop = await runBareBatch({
    repo: options.repo,
    instancesPath: options.instancesPath,
    resultsDir: options.resultsDir,
    listing: listing.instances,
    harnessPython: options.harnessPython,
    snapshotManifest: options.snapshotManifest,
    produce: options.produce,
    scoreOnly: options.scoreOnly,
  });
  if (stop) {
    console.error(`batch stopped: ${stop}`);
    process.exitCode = 2;
  }
}

async function runBareBatch(options: {
  repo?: 'django' | 'sympy';
  instancesPath: string;
  resultsDir: string;
  listing: ScanInstance[];
  harnessPython: string;
  snapshotManifest: string;
  produce: boolean;
  scoreOnly: boolean;
}): Promise<string | undefined> {
  const spec = await readInjectionSpec(resolve('docs/proposals/injection-effect-experiment-prereg-v0.5.md'));
  process.env.STUDENT_AGENT_PROVIDER_PROFILE = spec.sampling.profile;
  process.env.STUDENT_AGENT_EVAL_FROZEN_SAMPLING = JSON.stringify(spec.sampling);
  const resultsPath = join(options.resultsDir, `${options.repo ?? 'all'}-results.jsonl`);
  await migrateResultsFile(resultsPath);
  const scored = officialVerdictIds(await readResults(resultsPath).catch(() => []));
  const wanted = new Set(options.listing.map((item) => item.instance_id));
  const instances = (await loadSweBenchInstances(options.instancesPath))
    .filter((item) => wanted.has(item.instance_id) && !scored.has(item.instance_id));
  const frozen = await freezeReusableRuns(options.resultsDir);
  console.error(
    `resume ${scored.size} scored, ${instances.length} remaining, `
    + `frozenPatches=${frozen.length}, produce=${options.produce}, model ${spec.sampling.model}`,
  );
  for (const instance of instances) {
    const runDir = join(options.resultsDir, 'runs', instance.instance_id);
    await mkdir(runDir, { recursive: true });
    try {
      const existing = await loadReusableRun(runDir);
      if (!existing && !options.produce) {
        console.error(`${instance.instance_id} skipped (no reusable patch; pass --produce to generate)`);
        continue;
      }
      if (existing) {
        console.error(`${instance.instance_id} reuse patch tokens=${existing.tokens} bytes=${existing.model_patch.length}`);
      }
      let predictionsPath = existing?.predictionsPath;
      let emptyPatch = !existing;
      let tokens = existing?.tokens ?? 0;
      let inputTokens = existing?.inputTokens ?? 0;
      let outputTokens = existing?.outputTokens ?? 0;
      let costUsd = existing?.costUsd ?? 0;
      let produceError: string | undefined;
      if (!existing) {
        const produced = await produceSweBenchPatches({
          instancesPath: options.instancesPath,
          agent: 'student-agent',
          outputDir: runDir,
          instanceIds: [instance.instance_id],
          modelNameOrPath: spec.sampling.model,
          studentVariant: 'context_runtime',
          studentInjectionMode: 'off',
          studentLearningLifecycle: false,
        });
        const record = produced.records[0];
        const usage = record?.trace?.tokenUsage;
        predictionsPath = produced.predictionsPath;
        emptyPatch = Boolean(record?.emptyPatch || !record?.prediction.model_patch.trim());
        tokens = usage?.totalTokens ?? 0;
        inputTokens = usage?.inputTokens ?? 0;
        outputTokens = usage?.outputTokens ?? 0;
        costUsd = usage?.costUsd.total ?? 0;
        produceError = record?.errorMessage;
        if (produceError && isBatchStopError(produceError)) {
          await appendScanResult(resultsPath, {
            instance_id: instance.instance_id,
            repo: instance.instance_id.startsWith('sympy__') ? 'sympy' : 'django',
            verdict: 'harness_error',
            tokens,
            inputTokens,
            outputTokens,
            costUsd,
            emptyPatch,
            error: produceError,
            stopped: true,
            reusedPatch: false,
          });
          await writeRetryQueue(options.resultsDir, resultsPath);
          return produceError;
        }
      }
      let verdict: ScanVerdict;
      let scoreError: string | undefined;
      if (emptyPatch || !predictionsPath) {
        verdict = produceError ? 'harness_error' : 'unresolved';
      } else {
        try {
          const scored = await runPinnedScoring({
            pythonCommand: options.harnessPython,
            manifestPath: options.snapshotManifest,
            predictionsPath,
            instanceIds: [instance.instance_id],
            runId: `bscan-${instance.instance_id}`,
            preregPath: resolve('docs/proposals/injection-effect-experiment-prereg-v0.5.md'),
            cwd: runDir,
          });
          verdict = scored.resolved ? 'resolved' : 'unresolved';
        } catch (error) {
          scoreError = error instanceof Error ? error.message : String(error);
          verdict = 'harness_error';
          if (isBatchStopError(scoreError)) {
            await appendScanResult(resultsPath, {
              instance_id: instance.instance_id,
              repo: instance.instance_id.startsWith('sympy__') ? 'sympy' : 'django',
              verdict: 'harness_error',
              tokens,
              inputTokens,
              outputTokens,
              costUsd,
              emptyPatch,
              error: scoreError,
              stopped: true,
              reusedPatch: Boolean(existing),
            });
            await writeRetryQueue(options.resultsDir, resultsPath);
            return scoreError;
          }
        }
      }
      await appendScanResult(resultsPath, {
        instance_id: instance.instance_id,
        repo: instance.instance_id.startsWith('sympy__') ? 'sympy' : 'django',
        verdict,
        tokens,
        inputTokens,
        outputTokens,
        costUsd,
        emptyPatch,
        error: produceError ?? scoreError,
        reusedPatch: Boolean(existing),
      });
      console.error(`${instance.instance_id} verdict=${verdict} tokens=${tokens} reused=${Boolean(existing)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await appendScanResult(resultsPath, {
        instance_id: instance.instance_id,
        repo: instance.instance_id.startsWith('sympy__') ? 'sympy' : 'django',
        verdict: 'harness_error',
        tokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        emptyPatch: true,
        error: message,
        stopped: isBatchStopError(message),
        reusedPatch: false,
      });
      if (isBatchStopError(message)) {
        await writeRetryQueue(options.resultsDir, resultsPath);
        return message;
      }
    }
  }
  const rows = await readResults(resultsPath);
  await writeRetryQueue(options.resultsDir, resultsPath);
  const latest = [...latestNonVoidedRow(rows).values()];
  const drafts = proposeFamiliesFromFailures(latest.map((row) => ({
    instance_id: row.instance_id,
    verdict: row.verdict,
    familyHint: options.listing.find((item) => item.instance_id === row.instance_id)?.familyHint,
  })));
  await writeFile(join(options.resultsDir, `${options.repo ?? 'all'}-family-drafts.json`), `${JSON.stringify(drafts, null, 2)}\n`);
  return undefined;
}

function isBatchStopError(message: string): boolean {
  return /429|rate limit|TPM|throttl|Docker daemon|Cannot connect to the Docker|SSL_ERROR_SYSCALL/i.test(message);
}

async function freezeReusableRuns(resultsDir: string) {
  const runsDir = join(resultsDir, 'runs');
  const frozenDir = join(resultsDir, 'frozen');
  await mkdir(frozenDir, { recursive: true });
  const found = await inventoryReusableRuns(runsDir);
  for (const run of found) {
    await copyFile(run.predictionsPath, join(frozenDir, `${run.instance_id}.predictions.jsonl`));
    const recordsPath = join(runsDir, run.instance_id, 'records.json');
    try {
      await copyFile(recordsPath, join(frozenDir, `${run.instance_id}.records.json`));
    } catch {
      // records.json is optional for later rescoring
    }
  }
  await writeFile(join(resultsDir, 'produced-inventory.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: found.length,
    instances: found.map((item) => ({
      instance_id: item.instance_id,
      patchBytes: item.model_patch.length,
      tokens: item.tokens,
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      costUsd: item.costUsd,
      model_name_or_path: item.model_name_or_path,
      runPredictionsPath: item.predictionsPath,
      frozenPredictionsPath: join(frozenDir, `${item.instance_id}.predictions.jsonl`),
    })),
    note: 'Non-empty patches only. Rescore with --run / --score-only. Never re-produce these ids.',
  }, null, 2)}\n`);
  return found;
}

async function migrateResultsFile(path: string): Promise<void> {
  let rows: Array<Record<string, unknown>>;
  try {
    rows = await readResults(path);
  } catch {
    return;
  }
  if (rows.length === 0) return;
  const migrated = rows.map((row) => normalizeScanResult(row));
  await writeFile(path, `${migrated.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

async function appendScanResult(
  path: string,
  row: Parameters<typeof buildScanResult>[0],
): Promise<void> {
  await appendResult(path, buildScanResult(row));
}

async function writeRetryQueue(resultsDir: string, resultsPath: string): Promise<void> {
  let rows: Array<Record<string, unknown>> = [];
  try {
    rows = await readResults(resultsPath);
  } catch {
    rows = [];
  }
  const queue = buildRetryQueue(rows);
  await writeFile(join(resultsDir, 'retry-queue.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: queue.length,
    instanceIds: queue.map((row) => row.instance_id),
    rows: queue,
    note: 'Latest non-voided harness_error only. --run --score-only retries these; never treat as unresolved.',
  }, null, 2)}\n`);
}

async function readResults(path: string): Promise<Array<Record<string, unknown>>> {
  try {
    const raw = await readFile(path, 'utf8');
    return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

async function appendResult(path: string, row: Record<string, unknown>): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true });
  await appendFile(path, `${JSON.stringify(row)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
