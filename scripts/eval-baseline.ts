import { runEvalBaseline } from '../src/evals/baseline-runner.js';

interface CliOptions {
  taskIds: string[];
  trials?: number;
  keepSandboxes: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const records = await runEvalBaseline({
    taskIds: options.taskIds,
    trials: options.trials,
    keepSandboxes: options.keepSandboxes,
  });
  const summary = records.map((record) => ({
    task_id: record.taskId,
    mode: record.mode,
    trial: record.trial,
    outcome: record.score.correctnessScore >= 1 ? 'passed' : 'failed',
    correctness_score: record.score.correctnessScore,
    behavior_score: record.score.behaviorScore,
    tool_calls: record.score.efficiencyMetrics.totalToolCalls,
    failed_tool_calls: record.score.efficiencyMetrics.failedToolCalls,
    diagnostics: record.score.behaviorFindings,
  }));
  console.log(JSON.stringify({ ok: true, records: summary }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = { taskIds: [], keepSandboxes: false };
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
    if (arg === '--keep-sandboxes') {
      parsed.keepSandboxes = true;
      continue;
    }
    throw new Error(`Unknown eval:baseline argument: ${arg}`);
  }
  if (parsed.trials !== undefined && (!Number.isInteger(parsed.trials) || parsed.trials <= 0)) {
    throw new Error('--trials must be a positive integer');
  }
  return parsed;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
