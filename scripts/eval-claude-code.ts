import { runClaudeCodeEval } from '../src/evals/claude-code-runner.js';

interface CliOptions {
  taskIds: string[];
  trials?: number;
  keepSandboxes: boolean;
  maxBudgetUsd?: number;
  model?: string;
  bare: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await runClaudeCodeEval({
    taskIds: options.taskIds,
    trials: options.trials,
    keepSandboxes: options.keepSandboxes,
    maxBudgetUsd: options.maxBudgetUsd,
    model: options.model,
    bare: options.bare,
  });
  console.log(JSON.stringify({
    ok: true,
    outputDir: result.outputDir,
    summary: result.summary,
    records: result.records.map((record) => ({
      variant: record.variant,
      task_id: record.taskId,
      mode: record.mode,
      trial: record.trial,
      outcome: record.score.correctnessScore >= 1 ? 'passed' : 'failed',
      correctness_score: record.score.correctnessScore,
      behavior_score: record.score.behaviorScore,
      tool_calls: record.score.efficiencyMetrics.totalToolCalls,
      failed_tool_calls: record.score.efficiencyMetrics.failedToolCalls,
      token_usage: record.trace.tokenUsage,
      diagnostics: [
        ...(record.trace.errorMessage ? [`agent error: ${record.trace.errorMessage}`] : []),
        ...record.score.behaviorFindings,
      ],
    })),
  }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = { taskIds: [], keepSandboxes: false, bare: true };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--task' && args[index + 1]) {
      parsed.taskIds.push(args[++index]);
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
    if (arg === '--model' && args[index + 1]) {
      parsed.model = args[++index];
      continue;
    }
    if (arg === '--keep-sandboxes') {
      parsed.keepSandboxes = true;
      continue;
    }
    if (arg === '--no-bare') {
      parsed.bare = false;
      continue;
    }
    throw new Error(`Unknown eval:claude-code argument: ${arg}`);
  }
  if (parsed.trials !== undefined && (!Number.isInteger(parsed.trials) || parsed.trials <= 0)) {
    throw new Error('--trials must be a positive integer');
  }
  if (parsed.maxBudgetUsd !== undefined && (!Number.isFinite(parsed.maxBudgetUsd) || parsed.maxBudgetUsd <= 0)) {
    throw new Error('--max-budget-usd must be a positive number');
  }
  return parsed;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
