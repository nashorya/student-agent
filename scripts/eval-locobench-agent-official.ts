import {
  runOfficialLoCoBenchAgentHarnessEval,
  type OfficialLoCoBenchAgentHarnessEvalOptions,
} from '../src/evals/locobench-agent-official-runner.js';

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await runOfficialLoCoBenchAgentHarnessEval({
    dataDir: options.dataDir,
    locobenchAgentRoot: options.locobenchAgentRoot ?? '/tmp/locobench-agent',
    pythonCommand: options.pythonCommand,
    scenarioIds: options.scenarioIds,
    limit: options.limit,
    variants: options.variants.length > 0 ? options.variants : undefined,
    trials: options.trials,
    keepSandboxes: options.keepSandboxes,
    keepImportedTasks: options.keepImportedTasks,
    maxBudgetUsd: options.maxBudgetUsd,
    includeClaudeCode: options.includeClaudeCode,
    claudeCommand: options.claudeCommand,
    claudeModel: options.claudeModel,
    claudeMaxBudgetUsd: options.claudeMaxBudgetUsd,
    claudeBare: options.claudeBare,
  });

  console.log(JSON.stringify({
    ok: true,
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
      official_session: {
        total_turns: record.officialSessionResult.total_turns,
        completed_phases: record.officialSessionResult.completed_phases,
        total_phases: record.officialSessionResult.total_phases,
        modified_file_count: Object.keys(record.officialSessionResult.modified_files ?? {}).length,
      },
      diagnostics: record.diagnostics,
    })),
  }, null, 2));
}

interface CliOptions {
  dataDir: string;
  locobenchAgentRoot?: string;
  pythonCommand?: string;
  scenarioIds: string[];
  limit?: number;
  variants: Array<'plain' | 'context_runtime'>;
  trials?: number;
  keepSandboxes: boolean;
  keepImportedTasks: boolean;
  maxBudgetUsd?: number;
  includeClaudeCode: boolean;
  claudeCommand?: string;
  claudeModel?: string;
  claudeMaxBudgetUsd?: number;
  claudeBare?: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = {
    dataDir: '',
    scenarioIds: [],
    variants: [],
    keepSandboxes: false,
    keepImportedTasks: false,
    includeClaudeCode: false,
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
    if (arg === '--variant' && args[index + 1]) {
      parsed.variants.push(parseVariant(args[++index]));
      continue;
    }
    if (arg === '--trials' && args[index + 1]) {
      parsed.trials = Number.parseInt(args[++index], 10);
      continue;
    }
    if (arg === '--max-budget-usd' && args[index + 1]) {
      parsed.maxBudgetUsd = Number.parseFloat(args[++index]);
      continue;
    }
    if (arg === '--include-claude-code') {
      parsed.includeClaudeCode = true;
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
    throw new Error(`Unknown eval-locobench-agent-official argument: ${arg}`);
  }
  if (!parsed.dataDir) {
    throw new Error('--data-dir is required. Point it at the extracted LoCoBench-Agent data directory.');
  }
  if (parsed.limit !== undefined && (!Number.isInteger(parsed.limit) || parsed.limit <= 0)) {
    throw new Error('--limit must be a positive integer');
  }
  if (parsed.trials !== undefined && (!Number.isInteger(parsed.trials) || parsed.trials <= 0)) {
    throw new Error('--trials must be a positive integer');
  }
  if (parsed.maxBudgetUsd !== undefined && (!Number.isFinite(parsed.maxBudgetUsd) || parsed.maxBudgetUsd <= 0)) {
    throw new Error('--max-budget-usd must be a positive number');
  }
  if (parsed.claudeMaxBudgetUsd !== undefined && (!Number.isFinite(parsed.claudeMaxBudgetUsd) || parsed.claudeMaxBudgetUsd <= 0)) {
    throw new Error('--claude-max-budget-usd must be a positive number');
  }
  return parsed;
}

function parseVariant(value: string): 'plain' | 'context_runtime' {
  if (value === 'plain' || value === 'context_runtime') return value;
  throw new Error(`Unknown official LoCoBench-Agent harness variant: ${value}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
