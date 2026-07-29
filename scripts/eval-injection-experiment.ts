import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readInjectionSpec,
  resolveInjectionArm,
  runInjectionFamily as runFamily,
  runInjectionFamilySeed as runSeed,
  INJECTION_ARMS,
  type InjectionArm,
  type InjectionFamilyDependencies,
  type InjectionFamilyRunOptions,
  type InjectionSeedRunOptions,
} from '../src/evals/injection-family-runner.js';
import { runPinnedScoring } from './eval-injection-score.js';

export { readInjectionSpec, resolveInjectionArm };
export type { InjectionArm, InjectionFamilyRunOptions, InjectionSeedRunOptions };

export const DEFAULT_INJECTION_PREREG_PATH =
  'docs/proposals/injection-effect-experiment-prereg-v0.4.md';
export const DEFAULT_INJECTION_RESULTS_ROOT =
  'evals/results/injection-experiment-v0.4';

export function runInjectionFamily(
  options: InjectionFamilyRunOptions,
  dependencies: Partial<InjectionFamilyDependencies> = {},
) {
  return runFamily(options, {
    score: dependencies.score ?? runPinnedScoring,
    ...(dependencies.produce ? { produce: dependencies.produce } : {}),
  });
}

export function runInjectionFamilySeed(
  options: InjectionSeedRunOptions,
  dependencies: Partial<InjectionFamilyDependencies> = {},
) {
  return runSeed(options, {
    score: dependencies.score ?? runPinnedScoring,
    ...(dependencies.produce ? { produce: dependencies.produce } : {}),
  });
}

interface ParsedArgs {
  values: Map<string, string>;
  flags: string[];
}

function readArgs(args: string[]): ParsedArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    if (args[index]?.startsWith('--') && args[index + 1] && !args[index + 1]?.startsWith('--')) {
      values.set(args[index]!, args[++index]!);
    }
  }
  return { values, flags: args };
}

function sharedOptions(parsed: ParsedArgs, now: Date) {
  const required = (name: string): string =>
    parsed.values.get(name) ?? (() => { throw new Error(`${name} is required`); })();
  const dryRun = parsed.flags.includes('--dry-run');
  return {
    familyId: required('--family'),
    instancesPath: resolve(parsed.values.get('--instances-path')
      ?? 'evals/inputs/injection-effect-frozen-instances.jsonl'),
    resultsDir: resolve(parsed.values.get('--results-dir') ?? join(
      DEFAULT_INJECTION_RESULTS_ROOT,
      now.toISOString().replace(/[:.]/gu, '-'),
    )),
    preregPath: resolve(parsed.values.get('--prereg') ?? DEFAULT_INJECTION_PREREG_PATH),
    ...(dryRun ? {} : {
      harnessPython: required('--harness-python'),
      snapshotManifest: required('--snapshot-manifest'),
    }),
    keepWorktrees: parsed.flags.includes('--keep-worktrees'),
    dryRun,
  };
}

export function parseInjectionSeedCliOptions(
  args: string[],
  now: Date = new Date(),
): InjectionSeedRunOptions {
  return sharedOptions(readArgs(args), now);
}

export function parseInjectionCliOptions(
  args: string[],
  now: Date = new Date(),
): InjectionFamilyRunOptions {
  const parsed = readArgs(args);
  const arm = parsed.values.get('--arm') ?? (() => { throw new Error('--arm is required'); })();
  if (!INJECTION_ARMS.includes(arm as InjectionArm)) {
    throw new Error(`--arm must be ${INJECTION_ARMS.slice(0, -1).join(', ')}, or ${INJECTION_ARMS.at(-1)}`);
  }
  const seedMemory = parsed.values.get('--seed-memory');
  return {
    ...sharedOptions(parsed, now),
    arm: arm as InjectionArm,
    ...(seedMemory ? { seedMemoryDir: resolve(seedMemory) } : {}),
    ...(parsed.values.has('--resume-from-task')
      ? { resumeFromTask: Number(parsed.values.get('--resume-from-task')) }
      : {}),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fail = (error: unknown): never => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  };
  const args = process.argv.slice(2);
  const phase = readArgs(args).values.get('--phase') ?? 'arms';
  if (phase !== 'seed' && phase !== 'arms') fail('--phase must be seed or arms');
  // Argument parsing throws synchronously; keep it inside the same error path
  // as the run itself so the CLI reports a message rather than a stack trace.
  Promise.resolve()
    .then(() => (phase === 'seed'
      ? runInjectionFamilySeed(parseInjectionSeedCliOptions(args))
      : runInjectionFamily(parseInjectionCliOptions(args))))
    .then((result) => console.log(JSON.stringify({ ok: true, phase, ...result }, null, 2)))
    .catch(fail);
}
