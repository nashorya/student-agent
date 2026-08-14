/**
 * B-arm bare scan for family re-screening.
 *
 * Default is a dry-run listing. Live produce+score needs --run plus harness flags.
 *
 *   npx tsx scripts/scan-b-arm-families.ts --repo django
 *   npx tsx scripts/scan-b-arm-families.ts --repo sympy --run --harness-python ... --snapshot-manifest ...
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  estimateScanRuns,
  filterScanPool,
  parseLiteIdsFromBlob,
  parseScreeningTableInstances,
  proposeFamiliesFromFailures,
  type ScanInstance,
} from '../src/evals/b-arm-scan.js';
import { loadSweBenchInstances } from '../src/evals/swebench-patch-producer.js';

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
  instancesPath?: string;
  resultsDir: string;
  harnessPython?: string;
  snapshotManifest?: string;
}

function parseArgs(args: string[]): Cli {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith('--') && args[i + 1] && !args[i + 1]!.startsWith('--')) {
      values.set(arg, args[++i]!);
    } else if (arg.startsWith('--')) {
      flags.add(arg);
    }
  }
  const repo = values.get('--repo');
  if (repo && repo !== 'django' && repo !== 'sympy') {
    throw new Error('--repo must be django or sympy');
  }
  return {
    repo,
    run: flags.has('--run'),
    instancesPath: values.get('--instances-path'),
    resultsDir: resolve(values.get('--results-dir') ?? 'evals/results/b-arm-scan'),
    harnessPython: values.get('--harness-python'),
    snapshotManifest: values.get('--snapshot-manifest'),
  };
}

export async function buildScanListing(options: {
  repo?: 'django' | 'sympy';
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
  const instances = filterScanPool([...merged.values()]
    .sort((a, b) => a.instance_id.localeCompare(b.instance_id)), options.repo);
  return { instances, ...estimateScanRuns(instances) };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const listing = await buildScanListing({
    repo: options.repo,
    instancesPath: options.instancesPath,
  });
  const report = {
    dryRun: !options.run,
    repo: options.repo ?? 'django+sympy',
    estimatedRuns: listing.estimatedRuns,
    repos: listing.repos,
    instances: listing.instances,
    note: options.run
      ? 'Live B-arm produce+score is a separate long batch; this CLI lists/resumes from results jsonl.'
      : 'Dry-run listing only. Pass --run with harness flags to execute.',
  };
  await mkdir(options.resultsDir, { recursive: true });
  await writeFile(
    join(options.resultsDir, `${options.repo ?? 'all'}-listing.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify({
    samplingHint: 'Use frozen v0.5 glm-5.3 / zhipu-glm-5.3',
    ...report,
    instanceIds: listing.instances.map((item) => item.instance_id),
  }, null, 2));
  if (options.run) {
    if (!options.harnessPython || !options.snapshotManifest) {
      throw new Error('--run requires --harness-python and --snapshot-manifest');
    }
    console.error('Live batch should be started per-repo; listing written. Intermediate results go to', options.resultsDir);
  }
  const drafts = proposeFamiliesFromFailures(listing.instances.map((item) => ({
    instance_id: item.instance_id,
    resolved: false,
    familyHint: item.familyHint,
  })));
  if (drafts.length) {
    await writeFile(join(options.resultsDir, 'family-drafts-placeholder.json'), `${JSON.stringify(drafts, null, 2)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
