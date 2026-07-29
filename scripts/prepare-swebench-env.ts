/**
 * Prepare everything an injection-experiment run needs on this machine and
 * verify it against the preregistration's pinned dataset.
 *
 * Fails closed at a named stage (same idiom as run-jspace-formal-gated.sh) so a
 * missing prerequisite costs one clear error instead of a void batch.
 *
 *   npx tsx scripts/prepare-swebench-env.ts --out .swebench-env
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { readInjectionSpec } from '../src/evals/injection-family-runner.js';

const run = promisify(execFile);

export const DEFAULT_PREREG = 'docs/proposals/injection-effect-experiment-prereg-v0.4.md';
export const DEFAULT_HF_CACHE = join(
  homedir(),
  '.cache/huggingface/datasets/SWE-bench___swe-bench_lite/default/0.0.0',
);

export interface PrepareOptions {
  preregPath: string;
  outDir: string;
  venvDir: string;
  hfCacheRoot: string;
  /** Skip the `pip install swebench` step when the venv already satisfies it. */
  skipInstall?: boolean;
}

export class StageError extends Error {
  constructor(readonly stage: string, message: string, readonly remedy?: string) {
    super(message);
    this.name = 'StageError';
  }
}

export interface PreparedEnv {
  pythonCommand: string;
  snapshotManifest: string;
  datasetPath: string;
  arrowSha256: string;
  datasetCommit: string;
}

export async function prepareSweBenchEnv(options: PrepareOptions): Promise<PreparedEnv> {
  const spec = await readInjectionSpec(options.preregPath);

  // ---- stage: docker -------------------------------------------------------
  // The official harness runs each instance in a container; a stopped daemon is
  // the single most common reason a formal batch dies mid-run.
  try {
    await run('docker', ['info']);
  } catch {
    throw new StageError('docker', 'The Docker daemon is not reachable.',
      'Start Docker Desktop with `open -a Docker`, wait for it to report ready, then re-run.');
  }

  // ---- stage: swebench -----------------------------------------------------
  const python = join(options.venvDir, 'bin', 'python');
  if (!options.skipInstall || !await importable(python)) {
    await mkdir(resolve(options.venvDir, '..'), { recursive: true });
    if (!await importable(python)) {
      try {
        await run('python3', ['-m', 'venv', options.venvDir]);
        await run(join(options.venvDir, 'bin', 'pip'), ['install', '--quiet', 'swebench']);
      } catch (error) {
        throw new StageError('swebench', `Could not provision the harness venv: ${message(error)}`,
          `Create it manually: python3 -m venv ${options.venvDir} && ${options.venvDir}/bin/pip install swebench`);
      }
    }
  }
  if (!await importable(python)) {
    throw new StageError('swebench', `${python} cannot import swebench.`,
      `Run ${options.venvDir}/bin/pip install swebench`);
  }

  // ---- stage: dataset ------------------------------------------------------
  const commitDir = join(options.hfCacheRoot, spec.dataset.commit);
  const sourceArrow = await findTestArrow(commitDir, spec.dataset.commit);
  const actual = await sha256(sourceArrow);
  if (actual !== spec.dataset.arrowSha256) {
    throw new StageError('dataset',
      `The cached Arrow does not match the preregistration.\n  expected ${spec.dataset.arrowSha256}\n  actual   ${actual}`,
      'Delete the cached copy and re-download the pinned dataset commit, then re-run.');
  }

  // ---- stage: snapshot -----------------------------------------------------
  // The pinned scorer requires a `save_to_disk`-shaped directory whose single
  // data file hashes to the pinned Arrow, so materialize one from the cache.
  const datasetPath = resolve(options.outDir, 'dataset');
  const testDir = join(datasetPath, 'test');
  await mkdir(testDir, { recursive: true });
  const arrowName = 'data-00000-of-00001.arrow';
  await copyFile(sourceArrow, join(testDir, arrowName));
  await copyFile(join(commitDir, 'dataset_info.json'), join(testDir, 'dataset_info.json'));
  await writeFile(join(testDir, 'state.json'), `${JSON.stringify({
    _data_files: [{ filename: arrowName }],
    _fingerprint: spec.dataset.commit.slice(0, 16),
    _format_columns: null,
    _format_kwargs: {},
    _format_type: null,
    _output_all_columns: false,
    _split: 'test',
  }, null, 2)}\n`);
  const copied = await sha256(join(testDir, arrowName));
  if (copied !== spec.dataset.arrowSha256) {
    throw new StageError('snapshot', 'The materialized snapshot Arrow no longer matches the pinned hash.');
  }

  // ---- stage: manifest -----------------------------------------------------
  const snapshotManifest = resolve(options.outDir, 'snapshot-manifest.json');
  await writeFile(snapshotManifest, `${JSON.stringify({
    datasetCommit: spec.dataset.commit,
    arrowSha256: spec.dataset.arrowSha256,
    sourceArrowPath: sourceArrow,
    datasetPath,
  }, null, 2)}\n`);

  return {
    pythonCommand: resolve(python),
    snapshotManifest,
    datasetPath,
    arrowSha256: spec.dataset.arrowSha256,
    datasetCommit: spec.dataset.commit,
  };
}

async function findTestArrow(commitDir: string, commit: string): Promise<string> {
  let entries: string[];
  try {
    entries = await readdir(commitDir);
  } catch {
    throw new StageError('dataset', `No cached dataset for commit ${commit} under ${commitDir}.`,
      "Download it first: python -c \"import datasets; datasets.load_dataset('SWE-bench/SWE-bench_Lite')\"");
  }
  const arrow = entries.find((name) => name.endsWith('-test.arrow'))
    ?? entries.find((name) => name.endsWith('.arrow') && !name.includes('-dev'));
  if (!arrow) throw new StageError('dataset', `No test Arrow file in ${commitDir}.`);
  return join(commitDir, arrow);
}

async function importable(python: string): Promise<boolean> {
  try {
    await run(python, ['-c', 'import swebench']);
    return true;
  } catch {
    return false;
  }
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parsePrepareCliOptions(args: string[]): PrepareOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    if (args[index]?.startsWith('--') && args[index + 1] && !args[index + 1]?.startsWith('--')) {
      values.set(args[index]!, args[++index]!);
    }
  }
  const outDir = resolve(values.get('--out') ?? '.swebench-env');
  return {
    preregPath: resolve(values.get('--prereg') ?? DEFAULT_PREREG),
    outDir,
    venvDir: resolve(values.get('--venv') ?? join(outDir, 'venv')),
    hfCacheRoot: resolve(values.get('--hf-cache') ?? DEFAULT_HF_CACHE),
    skipInstall: args.includes('--skip-install'),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepareSweBenchEnv(parsePrepareCliOptions(process.argv.slice(2)))
    .then((env) => {
      console.log(JSON.stringify({ ok: true, ...env }, null, 2));
      console.log('\nRun a family with:');
      console.log(`  npx tsx scripts/eval-injection-experiment.ts --phase seed --family <ID> \\
    --harness-python ${env.pythonCommand} \\
    --snapshot-manifest ${env.snapshotManifest}`);
    })
    .catch((error) => {
      if (error instanceof StageError) {
        console.error(`[${error.stage}] ${error.message}`);
        if (error.remedy) console.error(`  fix: ${error.remedy}`);
      } else {
        console.error(message(error));
      }
      process.exit(1);
    });
}
