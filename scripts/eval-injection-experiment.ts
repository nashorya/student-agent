import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readFrozenInjectionSpec,
  resolveInjectionArm,
  runInjectionFamily as runFamily,
  type InjectionArm,
  type InjectionFamilyDependencies,
  type InjectionFamilyRunOptions,
} from '../src/evals/injection-family-runner.js';
import { runPinnedScoring } from './eval-injection-score.js';

export { readFrozenInjectionSpec, resolveInjectionArm };
export type { InjectionArm, InjectionFamilyRunOptions };

export function runInjectionFamily(
  options: InjectionFamilyRunOptions,
  dependencies: Partial<InjectionFamilyDependencies> = {},
) {
  return runFamily(options, {
    score: dependencies.score ?? runPinnedScoring,
    ...(dependencies.produce ? { produce: dependencies.produce } : {}),
  });
}

function cli(args: string[]): InjectionFamilyRunOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    if (args[index]?.startsWith('--') && args[index + 1] && !args[index + 1]?.startsWith('--')) {
      values.set(args[index]!, args[++index]!);
    }
  }
  const required = (name: string): string => values.get(name) ?? (() => { throw new Error(`${name} is required`); })();
  const arm = required('--arm');
  if (!['A-L', 'A-K', 'B', 'C'].includes(arm)) throw new Error('--arm must be A-L, A-K, B, or C');
  const dryRun = args.includes('--dry-run');
  return {
    familyId: required('--family'),
    arm: arm as InjectionArm,
    instancesPath: resolve(values.get('--instances-path') ?? 'evals/inputs/injection-effect-frozen-instances.jsonl'),
    resultsDir: resolve(values.get('--results-dir') ?? join('evals/results/injection-experiment-v0.2', new Date().toISOString().replace(/[:.]/gu, '-'))),
    preregPath: resolve(values.get('--prereg') ?? 'docs/proposals/injection-effect-experiment-prereg-v0.2.md'),
    ...(dryRun ? {} : {
      harnessPython: required('--harness-python'),
      snapshotManifest: required('--snapshot-manifest'),
    }),
    keepWorktrees: args.includes('--keep-worktrees'),
    dryRun,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runInjectionFamily(cli(process.argv.slice(2)))
    .then((result) => console.log(JSON.stringify({ ok: true, ...result }, null, 2)))
    .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
}
