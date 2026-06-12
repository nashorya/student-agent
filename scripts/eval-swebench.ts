import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { buildSweBenchEvaluationCommand } from '../src/evals/external-benchmarks.js';

interface CliOptions {
  pythonCommand?: string;
  datasetName: string;
  predictionsPath: string;
  maxWorkers?: number;
  runId?: string;
  dryRun: boolean;
  extraArgs: string[];
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.dryRun) {
    await access(options.predictionsPath);
  }
  const external = buildSweBenchEvaluationCommand({
    pythonCommand: options.pythonCommand,
    datasetName: options.datasetName,
    predictionsPath: options.predictionsPath,
    maxWorkers: options.maxWorkers,
    runId: options.runId,
    extraArgs: options.extraArgs,
  });

  if (options.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      benchmark: 'swe-bench',
      command: external.command,
      args: external.args,
    }, null, 2));
    return;
  }

  const exitCode = await runProcess(external.command, external.args);
  process.exit(exitCode);
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = {
    datasetName: process.env.SWEBENCH_DATASET ?? 'princeton-nlp/SWE-bench_Verified',
    predictionsPath: process.env.SWEBENCH_PREDICTIONS_PATH ?? '',
    runId: process.env.SWEBENCH_RUN_ID,
    dryRun: false,
    extraArgs: [],
  };
  if (process.env.SWEBENCH_PYTHON) {
    parsed.pythonCommand = process.env.SWEBENCH_PYTHON;
  }
  if (process.env.SWEBENCH_MAX_WORKERS) {
    parsed.maxWorkers = Number.parseInt(process.env.SWEBENCH_MAX_WORKERS, 10);
  }

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--python' && args[index + 1]) {
      parsed.pythonCommand = args[++index];
      continue;
    }
    if (arg === '--dataset-name' && args[index + 1]) {
      parsed.datasetName = args[++index];
      continue;
    }
    if (arg === '--predictions-path' && args[index + 1]) {
      parsed.predictionsPath = args[++index];
      continue;
    }
    if (arg === '--max-workers' && args[index + 1]) {
      parsed.maxWorkers = Number.parseInt(args[++index], 10);
      continue;
    }
    if (arg === '--run-id' && args[index + 1]) {
      parsed.runId = args[++index];
      continue;
    }
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    if (arg === '--') {
      parsed.extraArgs.push(...args.slice(index + 1));
      break;
    }
    throw new Error(`Unknown eval-swebench argument: ${arg}`);
  }
  if (!parsed.predictionsPath) {
    throw new Error('--predictions-path is required. It must point to a SWE-bench predictions.jsonl file.');
  }
  if (parsed.maxWorkers !== undefined && (!Number.isInteger(parsed.maxWorkers) || parsed.maxWorkers <= 0)) {
    throw new Error('--max-workers must be a positive integer');
  }
  return parsed;
}

function runProcess(command: string, args: string[]): Promise<number> {
  return new Promise((resolveProcess) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      resolveProcess(1);
    });
    child.on('close', (code, signal) => {
      resolveProcess(signal ? 124 : code ?? 1);
    });
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
