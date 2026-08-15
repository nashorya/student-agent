import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
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
  /** Optional harness --namespace. Unset keeps the official default (`swebench`). */
  namespace?: string;
  cwd?: string;
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
  const extraArgs = ['--split', 'test', '--instance_ids', ...options.instanceIds];
  if (options.namespace !== undefined) {
    extraArgs.push('--namespace', options.namespace);
  }
  return buildSweBenchEvaluationCommand({
    pythonCommand: options.pythonCommand,
    datasetName: datasetPath,
    predictionsPath: options.predictionsPath,
    maxWorkers: 1,
    runId: options.runId,
    extraArgs,
  });
}

export async function runPinnedScoring(
  options: ScoreOptions & { cwd: string },
): Promise<PinnedScoringResult> {
  if (options.instanceIds.length !== 1) {
    throw new Error('Per-task injection scoring requires exactly one instance');
  }
  const command = await buildPinnedScoringCommand(options);
  const captured = await runHarnessProcess(command, options.cwd);

  const predictions = (await readFile(options.predictionsPath, 'utf8')).trim().split(/\r?\n/u)
    .filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  const prediction = predictions.find((item) => item.instance_id === options.instanceIds[0]);
  const model = typeof prediction?.model_name_or_path === 'string' ? prediction.model_name_or_path : '';
  if (!model) throw new Error('Prediction is missing model_name_or_path');
  const modelDir = model.replaceAll('/', '__');
  const instanceId = options.instanceIds[0]!;
  const located = await locateHarnessReports({
    cwd: options.cwd,
    runId: options.runId,
    modelDir,
    instanceId,
  });
  if (!located) {
    throw new Error(await formatHarnessFailure({
      exitCode: captured.exitCode,
      cwd: options.cwd,
      runId: options.runId,
      modelDir,
      instanceId,
      stderrPath: captured.stderrPath,
      stdoutPath: captured.stdoutPath,
    }));
  }

  const summary = JSON.parse(await readFile(located.summaryPath, 'utf8')) as Record<string, unknown>;
  const instanceReport = JSON.parse(await readFile(located.instanceReportPath, 'utf8')) as Record<string, unknown>;
  const resolvedIds = stringArray(summary.resolved_ids);
  const unresolvedIds = stringArray(summary.unresolved_ids);
  const errorIds = stringArray(summary.error_ids);
  if (errorIds.includes(instanceId) || (!resolvedIds.includes(instanceId) && !unresolvedIds.includes(instanceId))) {
    throw new Error(await formatHarnessFailure({
      exitCode: captured.exitCode,
      cwd: options.cwd,
      runId: options.runId,
      modelDir,
      instanceId,
      stderrPath: captured.stderrPath,
      stdoutPath: captured.stdoutPath,
      prefix: `Official harness report is incomplete or ambiguous for ${instanceId}`,
    }));
  }
  await writeFile(join(options.cwd, 'harness-summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(join(options.cwd, 'harness-instance-report.json'), JSON.stringify(instanceReport, null, 2));
  return {
    resolved: resolvedIds.includes(instanceId),
    summaryPath: located.summaryPath,
    instanceReportPath: located.instanceReportPath,
    summary,
  };
}

export async function locateHarnessReports(options: {
  cwd: string;
  runId: string;
  modelDir: string;
  instanceId: string;
}): Promise<{ summaryPath: string; instanceReportPath: string } | null> {
  const summaryPath = await firstExisting([
    join(options.cwd, `${options.modelDir}.${options.runId}.json`),
    ...await globSuffix(options.cwd, `.${options.runId}.json`),
  ]);
  const instanceReportPath = await firstExisting([
    join(options.cwd, 'logs', 'run_evaluation', options.runId, options.modelDir, options.instanceId, 'report.json'),
    ...await globNamedReports(options.cwd, options.runId, options.instanceId),
  ]);
  if (!summaryPath || !instanceReportPath) return null;
  return { summaryPath, instanceReportPath };
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
    namespace: values.get('--namespace'),
    cwd: values.get('--cwd') ? resolve(values.get('--cwd')!) : undefined,
  };
}

export async function runHarnessProcess(
  command: ExternalCommand,
  cwd: string,
): Promise<{ exitCode: number; stdoutPath: string; stderrPath: string; commandPath: string }> {
  await mkdir(cwd, { recursive: true });
  const stdoutPath = join(cwd, 'harness-stdout.log');
  const stderrPath = join(cwd, 'harness-stderr.log');
  const commandPath = join(cwd, 'harness-command.json');
  await writeFile(commandPath, `${JSON.stringify({ command: command.command, args: command.args, cwd }, null, 2)}\n`);
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const exitCode = await new Promise<number>((done) => {
    const child = spawn(command.command, command.args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      stderrChunks.push(Buffer.from(`\n[spawn error] ${error.message}\n`));
      done(1);
    });
    child.on('close', (code, signal) => done(signal ? 124 : code ?? 1));
  });
  await writeFile(stdoutPath, Buffer.concat(stdoutChunks));
  await writeFile(stderrPath, Buffer.concat(stderrChunks));
  return { exitCode, stdoutPath, stderrPath, commandPath };
}

async function firstExisting(paths: string[]): Promise<string | undefined> {
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    try {
      await access(path);
      return path;
    } catch {
      // try next
    }
  }
  return undefined;
}

async function globSuffix(dir: string, suffix: string): Promise<string[]> {
  try {
    return (await readdir(dir))
      .filter((name) => name.endsWith(suffix))
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

async function globNamedReports(cwd: string, runId: string, instanceId: string): Promise<string[]> {
  const root = join(cwd, 'logs', 'run_evaluation', runId);
  try {
    const models = await readdir(root);
    return models.map((model) => join(root, model, instanceId, 'report.json'));
  } catch {
    return [];
  }
}

export async function tailFile(path: string, maxChars = 4000): Promise<string> {
  try {
    const text = await readFile(path, 'utf8');
    return text.length <= maxChars ? text : text.slice(-maxChars);
  } catch {
    return `(missing ${path})`;
  }
}

export async function formatHarnessFailure(options: {
  exitCode: number;
  cwd: string;
  runId: string;
  modelDir: string;
  instanceId: string;
  stderrPath: string;
  stdoutPath: string;
  prefix?: string;
}): Promise<string> {
  const expectedSummary = join(options.cwd, `${options.modelDir}.${options.runId}.json`);
  const expectedReport = join(
    options.cwd,
    'logs',
    'run_evaluation',
    options.runId,
    options.modelDir,
    options.instanceId,
    'report.json',
  );
  const stderr = await tailFile(options.stderrPath);
  const stdout = await tailFile(options.stdoutPath, 1500);
  return [
    options.prefix ?? `Official SWE-bench harness exited with code ${options.exitCode}`,
    `cwd=${options.cwd}`,
    `expectedSummary=${expectedSummary}`,
    `expectedReport=${expectedReport}`,
    `stdoutLog=${options.stdoutPath}`,
    `stderrLog=${options.stderrPath}`,
    '--- harness-stderr.log (tail) ---',
    stderr.trim() || '(empty)',
    '--- harness-stdout.log (tail) ---',
    stdout.trim() || '(empty)',
  ].join('\n');
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  const cwd = options.cwd ?? process.cwd();
  buildPinnedScoringCommand(options).then(async (command) => {
    if (options.dryRun) {
      console.log(JSON.stringify(command, null, 2));
      return;
    }
    const result = await runPinnedScoring({ ...options, cwd });
    console.log(JSON.stringify({ resolved: result.resolved, summaryPath: result.summaryPath, instanceReportPath: result.instanceReportPath }, null, 2));
  }).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
}
