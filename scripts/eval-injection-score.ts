import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSweBenchEvaluationCommand, type ExternalCommand } from '../src/evals/external-benchmarks.js';
import { readInjectionSpec } from '../src/evals/injection-family-runner.js';

export interface ScoreOptions {
  pythonCommand: string;
  manifestPath: string;
  predictionsPath: string;
  instanceIds: string[];
  runId: string;
  preregPath: string;
  dryRun?: boolean;
}

export interface PinnedScoringResult {
  resolved: boolean;
  summaryPath: string;
  instanceReportPath: string;
  summary: Record<string, unknown>;
}

type HashFile = (path: string) => Promise<string>;

export async function buildPinnedScoringCommand(
  options: ScoreOptions,
  hashFile: HashFile = sha256File,
): Promise<ExternalCommand> {
  const spec = await readInjectionSpec(options.preregPath);
  const manifest = JSON.parse(await readFile(options.manifestPath, 'utf8')) as Record<string, unknown>;
  if (manifest.datasetCommit !== spec.dataset.commit) throw new Error('Dataset commit does not match the frozen preregistration');
  if (manifest.arrowSha256 !== spec.dataset.arrowSha256) throw new Error('Arrow SHA-256 does not match the frozen preregistration');
  const sourceArrowPath = typeof manifest.sourceArrowPath === 'string' ? manifest.sourceArrowPath : '';
  if (!sourceArrowPath || await hashFile(sourceArrowPath) !== spec.dataset.arrowSha256) {
    throw new Error('The source Arrow file does not match the frozen preregistration');
  }
  const datasetPath = typeof manifest.datasetPath === 'string' ? manifest.datasetPath : '';
  if (!isAbsolute(datasetPath)) throw new Error('Snapshot manifest must reference a local saved dataset');
  await access(join(datasetPath, 'test', 'dataset_info.json')).catch(() => {
    throw new Error('Snapshot manifest must reference a local saved dataset');
  });
  const state = JSON.parse(await readFile(join(datasetPath, 'test', 'state.json'), 'utf8')) as {
    _data_files?: Array<{ filename?: string }>;
  };
  const filename = state._data_files?.length === 1 ? state._data_files[0]?.filename : undefined;
  if (!filename || basename(filename) !== filename
    || await hashFile(join(datasetPath, 'test', filename)) !== spec.dataset.arrowSha256) {
    throw new Error('The saved dataset Arrow does not match the frozen preregistration');
  }
  const predictions = (await readFile(options.predictionsPath, 'utf8')).trim().split(/\r?\n/u)
    .filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  for (const id of options.instanceIds) {
    const prediction = predictions.find((item) => item.instance_id === id);
    if (!prediction || typeof prediction.model_patch !== 'string' || !prediction.model_patch.trim()) {
      throw new Error(`Old prediction is missing a non-empty patch for ${id}`);
    }
  }
  return buildSweBenchEvaluationCommand({
    pythonCommand: options.pythonCommand,
    datasetName: datasetPath,
    predictionsPath: options.predictionsPath,
    maxWorkers: 1,
    runId: options.runId,
    extraArgs: ['--split', 'test', '--instance_ids', ...options.instanceIds],
  });
}

export async function runPinnedScoring(
  options: ScoreOptions & { cwd: string },
): Promise<PinnedScoringResult> {
  if (options.instanceIds.length !== 1) {
    throw new Error('Per-task injection scoring requires exactly one instance');
  }
  const command = await buildPinnedScoringCommand(options);
  const exitCode = await run(command, options.cwd);
  if (exitCode !== 0) throw new Error(`Official SWE-bench harness exited with code ${exitCode}`);

  const predictions = (await readFile(options.predictionsPath, 'utf8')).trim().split(/\r?\n/u)
    .filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  const prediction = predictions.find((item) => item.instance_id === options.instanceIds[0]);
  const model = typeof prediction?.model_name_or_path === 'string' ? prediction.model_name_or_path : '';
  if (!model) throw new Error('Prediction is missing model_name_or_path');
  const modelDir = model.replaceAll('/', '__');
  const summaryPath = join(options.cwd, `${modelDir}.${options.runId}.json`);
  const instanceReportPath = join(
    options.cwd,
    'logs',
    'run_evaluation',
    options.runId,
    modelDir,
    options.instanceIds[0]!,
    'report.json',
  );
  const summary = JSON.parse(await readFile(summaryPath, 'utf8')) as Record<string, unknown>;
  const instanceReport = JSON.parse(await readFile(instanceReportPath, 'utf8')) as Record<string, unknown>;
  const resolvedIds = stringArray(summary.resolved_ids);
  const unresolvedIds = stringArray(summary.unresolved_ids);
  const errorIds = stringArray(summary.error_ids);
  const instanceId = options.instanceIds[0]!;
  if (errorIds.includes(instanceId) || (!resolvedIds.includes(instanceId) && !unresolvedIds.includes(instanceId))) {
    throw new Error(`Official harness report is incomplete or ambiguous for ${instanceId}`);
  }
  await writeFile(join(options.cwd, 'harness-summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(join(options.cwd, 'harness-instance-report.json'), JSON.stringify(instanceReport, null, 2));
  return { resolved: resolvedIds.includes(instanceId), summaryPath, instanceReportPath, summary };
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function parseArgs(args: string[]): ScoreOptions {
  const values = new Map<string, string>();
  const instanceIds: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--instance-id' && args[index + 1]) instanceIds.push(args[++index]!);
    else if (arg?.startsWith('--') && args[index + 1] && !args[index + 1]?.startsWith('--')) values.set(arg, args[++index]!);
  }
  const required = (name: string): string => values.get(name) ?? (() => { throw new Error(`${name} is required`); })();
  if (instanceIds.length === 0) throw new Error('--instance-id is required');
  return {
    pythonCommand: resolve(required('--python')),
    manifestPath: resolve(required('--snapshot-manifest')),
    predictionsPath: resolve(required('--predictions-path')),
    instanceIds,
    runId: required('--run-id'),
    preregPath: resolve(values.get('--prereg') ?? 'docs/proposals/injection-effect-experiment-prereg-v0.md'),
    dryRun: args.includes('--dry-run'),
  };
}

function run(command: ExternalCommand, cwd?: string): Promise<number> {
  return new Promise((done) => {
    const child = spawn(command.command, command.args, { cwd, stdio: 'inherit', env: process.env });
    child.on('error', () => done(1));
    child.on('close', (code, signal) => done(signal ? 124 : code ?? 1));
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  buildPinnedScoringCommand(options).then(async (command) => {
    if (options.dryRun) console.log(JSON.stringify(command, null, 2));
    else process.exit(await run(command));
  }).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
}
