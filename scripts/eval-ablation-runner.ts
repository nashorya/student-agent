import { runAblationDryRun } from '../src/evals/ablation-runner.js';

interface CliOptions {
  manifestPath?: string;
  resultsRoot?: string;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await runAblationDryRun(options);
  console.log(JSON.stringify({
    ok: true,
    mode: 'dry_run',
    manifest: result.manifest.id,
    records: result.records.length,
    outputDir: result.outputDir,
    comparison: result.comparison,
  }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--manifest' && args[index + 1]) {
      parsed.manifestPath = args[++index];
      continue;
    }
    if (arg === '--results-root' && args[index + 1]) {
      parsed.resultsRoot = args[++index];
      continue;
    }
    throw new Error(`Unknown eval-ablation-runner argument: ${arg}`);
  }
  return parsed;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
