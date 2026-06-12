import { scoreOfficialLoCoBenchAgentRecordsFile } from '../src/evals/locobench-agent-official-scorer.js';

interface CliOptions {
  recordsPath?: string;
  locobenchAgentRoot?: string;
  outputDir?: string;
  pythonCommand?: string;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.recordsPath) {
    throw new Error('--records is required. Point it at an eval results records.json file.');
  }
  const locobenchAgentRoot = options.locobenchAgentRoot
    ?? process.env.LOCOBENCH_AGENT_ROOT
    ?? '/tmp/locobench-agent';
  const report = await scoreOfficialLoCoBenchAgentRecordsFile({
    inputPath: options.recordsPath,
    outputDir: options.outputDir,
    locobenchAgentRoot,
    pythonCommand: options.pythonCommand,
  });
  console.log(JSON.stringify({
    ok: true,
    locobenchAgentRoot,
    outputDir: options.outputDir ?? 'same directory as records.json',
    summaries: report.summaries,
    records: report.records.map((record) => ({
      variant: record.variant,
      task_id: record.taskId,
      trial: record.trial,
      official_lcba_comprehension: record.lcba.comprehensionScore,
      official_lcba_efficiency: record.lcba.efficiencyScore,
      official_lcba_overall: record.lcba.overallScore,
      official_lcba_overall_5: record.lcba.overallScore5,
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
    if (arg === '--locobench-agent-root' && args[index + 1]) {
      parsed.locobenchAgentRoot = args[++index];
      continue;
    }
    if (arg === '--output-dir' && args[index + 1]) {
      parsed.outputDir = args[++index];
      continue;
    }
    if (arg === '--python' && args[index + 1]) {
      parsed.pythonCommand = args[++index];
      continue;
    }
    throw new Error(`Unknown score-locobench-agent-official argument: ${arg}`);
  }
  return parsed;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
