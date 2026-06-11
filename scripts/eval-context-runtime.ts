import {
  describeContextRuntimeRecordDiagnostics,
  runContextRuntimeEval,
  type ContextRuntimeEvalVariant,
} from '../src/evals/context-runtime-runner.js';

interface CliOptions {
  taskIds: string[];
  trials?: number;
  variants: ContextRuntimeEvalVariant[];
  keepSandboxes: boolean;
  maxBudgetUsd?: number;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await runContextRuntimeEval({
    taskIds: options.taskIds,
    trials: options.trials,
    variants: options.variants.length > 0 ? options.variants : undefined,
    keepSandboxes: options.keepSandboxes,
    maxBudgetUsd: options.maxBudgetUsd,
  });
  console.log(JSON.stringify({
    ok: true,
    outputDir: result.outputDir,
    summaries: result.summaries,
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
      turns: record.trace.turnCount ?? record.trace.usageEvents?.length ?? 0,
      guard_rule_counts: record.trace.guardRuleCounts ?? {},
      token_usage: record.trace.tokenUsage,
      usage_events: record.trace.usageEvents ?? [],
      pi_schema_trace: record.trace.piSchemaTrace ?? null,
      diagnostics: describeContextRuntimeRecordDiagnostics(record),
    })),
  }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = { taskIds: [], variants: [], keepSandboxes: false };
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
    if (arg === '--variant' && args[index + 1]) {
      parsed.variants.push(parseVariant(args[++index]));
      continue;
    }
    if (arg === '--max-budget-usd' && args[index + 1]) {
      parsed.maxBudgetUsd = Number.parseFloat(args[++index]);
      continue;
    }
    if (arg === '--keep-sandboxes') {
      parsed.keepSandboxes = true;
      continue;
    }
    throw new Error(`Unknown eval:context-runtime argument: ${arg}`);
  }
  if (parsed.trials !== undefined && (!Number.isInteger(parsed.trials) || parsed.trials <= 0)) {
    throw new Error('--trials must be a positive integer');
  }
  if (parsed.maxBudgetUsd !== undefined && (!Number.isFinite(parsed.maxBudgetUsd) || parsed.maxBudgetUsd <= 0)) {
    throw new Error('--max-budget-usd must be a positive number');
  }
  return parsed;
}

function parseVariant(value: string): ContextRuntimeEvalVariant {
  if (value === 'plain' || value === 'context_runtime') return value;
  throw new Error(`Unknown context runtime variant: ${value}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
