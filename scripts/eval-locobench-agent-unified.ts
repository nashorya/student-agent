import { runOfficialLoCoBenchAgentHarnessEval } from '../src/evals/locobench-agent-official-runner.js';

interface CliOptions {
  dataDir: string;
  locobenchAgentRoot?: string;
  pythonCommand?: string;
  scenarioIds: string[];
  limit?: number;
  trials?: number;
  resultsDir?: string;
  keepSandboxes: boolean;
  keepImportedTasks: boolean;
  maxBudgetUsd?: number;
  claudeCommand?: string;
  claudeModel?: string;
  claudeMaxBudgetUsd?: number;
  claudeBare?: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await runOfficialLoCoBenchAgentHarnessEval({
    dataDir: options.dataDir,
    locobenchAgentRoot: options.locobenchAgentRoot ?? '/tmp/locobench-agent',
    pythonCommand: options.pythonCommand,
    scenarioIds: options.scenarioIds,
    limit: options.limit,
    variants: ['plain', 'context_runtime'],
    trials: options.trials,
    resultsDir: options.resultsDir,
    keepSandboxes: options.keepSandboxes,
    keepImportedTasks: options.keepImportedTasks,
    maxBudgetUsd: options.maxBudgetUsd,
    includeClaudeCode: true,
    claudeCommand: options.claudeCommand,
    claudeModel: options.claudeModel,
    claudeMaxBudgetUsd: options.claudeMaxBudgetUsd,
    claudeBare: options.claudeBare,
  });

  console.log(JSON.stringify({
    ok: true,
    pipeline: 'locobench-agent-unified',
    variants: ['plain', 'context_runtime', 'claude_code'],
    outputDir: result.outputDir,
    summaries: result.summaries,
    records: result.records.map((record) => ({
      variant: record.variant,
      scenario_id: record.scenarioId,
      task_id: record.taskId,
      trial: record.trial,
      lcba: record.officialScore.lcba,
      harness_outcome: record.harnessRecord.score.correctnessScore >= 1 ? 'passed' : 'failed',
      harness_behavior_score: record.harnessRecord.score.behaviorScore,
      harness_tool_calls: record.harnessRecord.score.efficiencyMetrics.totalToolCalls,
      harness_token_usage: record.harnessRecord.trace.tokenUsage,
      diagnostics: record.diagnostics,
    })),
  }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = {
    dataDir: '',
    scenarioIds: [],
    keepSandboxes: false,
    keepImportedTasks: false,
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--data-dir' && args[index + 1]) {
      parsed.dataDir = args[++index];
      continue;
    }
    if (arg === '--locobench-agent-root' && args[index + 1]) {
      parsed.locobenchAgentRoot = args[++index];
      continue;
    }
    if (arg === '--python' && args[index + 1]) {
      parsed.pythonCommand = args[++index];
      continue;
    }
    if (arg === '--scenario' && args[index + 1]) {
      parsed.scenarioIds.push(args[++index]);
      continue;
    }
    if (arg === '--limit' && args[index + 1]) {
      parsed.limit = Number.parseInt(args[++index], 10);
      continue;
    }
    if (arg === '--trials' && args[index + 1]) {
      parsed.trials = Number.parseInt(args[++index], 10);
      continue;
    }
    if (arg === '--results-dir' && args[index + 1]) {
      parsed.resultsDir = args[++index];
      continue;
    }
    if (arg === '--max-budget-usd' && args[index + 1]) {
      parsed.maxBudgetUsd = Number.parseFloat(args[++index]);
      continue;
    }
    if (arg === '--claude-command' && args[index + 1]) {
      parsed.claudeCommand = args[++index];
      continue;
    }
    if (arg === '--claude-model' && args[index + 1]) {
      parsed.claudeModel = args[++index];
      continue;
    }
    if (arg === '--claude-max-budget-usd' && args[index + 1]) {
      parsed.claudeMaxBudgetUsd = Number.parseFloat(args[++index]);
      continue;
    }
    if (arg === '--claude-no-bare') {
      parsed.claudeBare = false;
      continue;
    }
    if (arg === '--keep-sandboxes') {
      parsed.keepSandboxes = true;
      continue;
    }
    if (arg === '--keep-imported-tasks') {
      parsed.keepImportedTasks = true;
      continue;
    }
    throw new Error(`Unknown eval-locobench-agent-unified argument: ${arg}`);
  }
  validateOptions(parsed);
  return parsed;
}

function validateOptions(options: CliOptions): void {
  if (!options.dataDir) {
    throw new Error('--data-dir is required. Point it at the extracted LoCoBench-Agent data directory.');
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit <= 0)) {
    throw new Error('--limit must be a positive integer');
  }
  if (options.trials !== undefined && (!Number.isInteger(options.trials) || options.trials <= 0)) {
    throw new Error('--trials must be a positive integer');
  }
  if (options.maxBudgetUsd !== undefined && (!Number.isFinite(options.maxBudgetUsd) || options.maxBudgetUsd <= 0)) {
    throw new Error('--max-budget-usd must be a positive number');
  }
  if (options.claudeMaxBudgetUsd !== undefined && (!Number.isFinite(options.claudeMaxBudgetUsd) || options.claudeMaxBudgetUsd <= 0)) {
    throw new Error('--claude-max-budget-usd must be a positive number');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
