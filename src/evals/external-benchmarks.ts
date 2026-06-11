import { resolve } from 'node:path';

export interface ExternalCommand {
  command: string;
  args: string[];
}

export interface TerminalBenchCommandOptions {
  command?: string;
  dataset?: string;
  path?: string;
  agent?: string;
  agentImportPath?: string;
  model: string;
  nConcurrent?: number;
  agentSetupTimeoutMultiplier?: number;
  nTasks?: number;
  outputDir?: string;
  envFile?: string;
  extraArgs?: string[];
}

export interface SweBenchEvaluationCommandOptions {
  pythonCommand?: string;
  datasetName: string;
  predictionsPath: string;
  maxWorkers?: number;
  runId?: string;
  extraArgs?: string[];
}

export function buildTerminalBenchCommand(options: TerminalBenchCommandOptions): ExternalCommand {
  const args = ['run'];
  if (options.path) {
    args.push('--path', options.path);
  } else {
    args.push('--dataset', options.dataset ?? 'terminal-bench@2.0');
  }
  if (options.agentImportPath) {
    args.push('--agent-import-path', options.agentImportPath);
  } else {
    args.push('--agent', options.agent ?? 'claude-code');
  }
  args.push('--model', options.model);
  if (options.nConcurrent !== undefined) {
    args.push('--n-concurrent', String(options.nConcurrent));
  }
  if (options.agentSetupTimeoutMultiplier !== undefined) {
    args.push('--agent-setup-timeout-multiplier', String(options.agentSetupTimeoutMultiplier));
  }
  if (!options.path && options.nTasks !== undefined) {
    args.push('--n-tasks', String(options.nTasks));
  }
  if (options.outputDir) {
    args.push('--jobs-dir', options.outputDir);
  }
  if (options.envFile) {
    args.push('--env-file', options.envFile);
  }
  args.push(...(options.extraArgs ?? []));
  return {
    command: options.command ?? 'harbor',
    args,
  };
}

export function buildSweBenchEvaluationCommand(options: SweBenchEvaluationCommandOptions): ExternalCommand {
  const args = [
    '-m',
    'swebench.harness.run_evaluation',
    '--dataset_name',
    options.datasetName,
    '--predictions_path',
    options.predictionsPath,
  ];
  if (options.maxWorkers !== undefined) {
    args.push('--max_workers', String(options.maxWorkers));
  }
  if (options.runId) {
    args.push('--run_id', options.runId);
  }
  args.push(...(options.extraArgs ?? []));
  return {
    command: options.pythonCommand ?? 'python3',
    args,
  };
}

export function defaultExternalBenchmarkOutputDir(
  benchmark: 'terminal-bench' | 'swebench',
  date = new Date(),
): string {
  return resolve(process.cwd(), 'evals/results', benchmark, timestampForPath(date));
}

export function timestampForPath(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}
