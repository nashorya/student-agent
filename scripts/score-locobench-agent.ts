import { scoreLoCoBenchAgentRecordsFile } from '../src/evals/locobench-agent-scorer.js';

interface CliOptions {
  recordsPath?: string;
  outputDir?: string;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.recordsPath) {
    throw new Error('--records is required. Point it at an eval results records.json file.');
  }
  const report = await scoreLoCoBenchAgentRecordsFile({
    inputPath: options.recordsPath,
    outputDir: options.outputDir,
  });
  console.log(JSON.stringify({
    ok: true,
    outputDir: options.outputDir ?? 'same directory as records.json',
    summaries: report.summaries,
    records: report.records.map((record) => ({
      variant: record.variant,
      task_id: record.taskId,
      trial: record.trial,
      lcba_comprehension: record.lcba.comprehensionScore,
      lcba_efficiency: record.lcba.efficiencyScore,
      lcba_overall: record.lcba.overallScore,
      lcba_overall_5: record.lcba.overallScore5,
    })),
  }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--records' && args[index + 1]) {
      parsed.recordsPath = args[++index];
      continue;
    }
    if (arg === '--output-dir' && args[index + 1]) {
      parsed.outputDir = args[++index];
      continue;
    }
    throw new Error(`Unknown score-locobench-agent argument: ${arg}`);
  }
  return parsed;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
