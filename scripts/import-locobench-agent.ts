import { importLoCoBenchAgentTask } from '../src/evals/locobench-agent-importer.js';

interface CliOptions {
  dataDir?: string;
  scenarioId?: string;
  scenarioFile?: string;
  outputRoot?: string;
  taskId?: string;
  mode?: 'direct' | 'task';
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.dataDir) {
    throw new Error('--data-dir is required. Point it at the extracted LoCoBench-Agent data directory.');
  }

  const imported = await importLoCoBenchAgentTask({
    dataDir: options.dataDir,
    scenarioId: options.scenarioId,
    scenarioFile: options.scenarioFile,
    outputRoot: options.outputRoot,
    taskId: options.taskId,
    mode: options.mode,
  });

  console.log(JSON.stringify({
    ok: true,
    ...imported,
    nextCommands: [
      `npm run eval:context-runtime -- --task ${imported.taskId} --variant plain --variant context_runtime --trials 1 --max-budget-usd 1`,
      `npm run eval:claude-code -- --task ${imported.taskId} --trials 1 --model sonnet --max-budget-usd 2`,
    ],
  }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--data-dir' && args[index + 1]) {
      parsed.dataDir = args[++index];
      continue;
    }
    if (arg === '--scenario-id' && args[index + 1]) {
      parsed.scenarioId = args[++index];
      continue;
    }
    if (arg === '--scenario-file' && args[index + 1]) {
      parsed.scenarioFile = args[++index];
      continue;
    }
    if (arg === '--output-root' && args[index + 1]) {
      parsed.outputRoot = args[++index];
      continue;
    }
    if (arg === '--task-id' && args[index + 1]) {
      parsed.taskId = args[++index];
      continue;
    }
    if (arg === '--mode' && args[index + 1]) {
      parsed.mode = parseMode(args[++index]);
      continue;
    }
    throw new Error(`Unknown import-locobench-agent argument: ${arg}`);
  }
  if (parsed.scenarioId && parsed.scenarioFile) {
    throw new Error('Use either --scenario-id or --scenario-file, not both.');
  }
  return parsed;
}

function parseMode(value: string): 'direct' | 'task' {
  if (value === 'direct' || value === 'task') return value;
  throw new Error('--mode must be "direct" or "task"');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
