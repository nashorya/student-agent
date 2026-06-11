import {
  createSweBenchProductionPlan,
  produceSweBenchPatches,
  type SweBenchAgent,
} from '../src/evals/swebench-patch-producer.js';
import type { ContextRuntimeEvalVariant } from '../src/evals/context-runtime-runner.js';

interface CliOptions {
  instancesPath: string;
  agent: SweBenchAgent;
  outputDir?: string;
  limit?: number;
  instanceIds: string[];
  modelNameOrPath?: string;
  keepWorktrees: boolean;
  timeoutSeconds?: number;
  claudeCommand?: string;
  claudeModel?: string;
  claudeMaxBudgetUsd?: number;
  claudeBare?: boolean;
  studentVariant: ContextRuntimeEvalVariant;
  dryRun: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.dryRun) {
    const plan = await createSweBenchProductionPlan({
      instancesPath: options.instancesPath,
      agent: options.agent,
      outputDir: options.outputDir,
      limit: options.limit,
      instanceIds: options.instanceIds,
      modelNameOrPath: options.modelNameOrPath,
      timeoutSeconds: options.timeoutSeconds,
      claudeCommand: options.claudeCommand,
      claudeModel: options.claudeModel,
      claudeMaxBudgetUsd: options.claudeMaxBudgetUsd,
      claudeBare: options.claudeBare,
      studentVariant: options.studentVariant,
    });
    console.log(JSON.stringify({
      ok: true,
      benchmark: 'swe-bench',
      phase: 'produce-patches',
      dryRun: true,
      agent: options.agent,
      studentVariant: options.studentVariant,
      outputDir: plan.outputDir,
      predictionsPath: plan.predictionsPath,
      recordsPath: plan.recordsPath,
      instances: plan.instances,
    }, null, 2));
    return;
  }

  const result = await produceSweBenchPatches({
    instancesPath: options.instancesPath,
    agent: options.agent,
    outputDir: options.outputDir,
    limit: options.limit,
    instanceIds: options.instanceIds,
    modelNameOrPath: options.modelNameOrPath,
    keepWorktrees: options.keepWorktrees,
    timeoutSeconds: options.timeoutSeconds,
    claudeCommand: options.claudeCommand,
    claudeModel: options.claudeModel,
    claudeMaxBudgetUsd: options.claudeMaxBudgetUsd,
    claudeBare: options.claudeBare,
    studentVariant: options.studentVariant,
  });
  console.log(JSON.stringify({
    ok: true,
    benchmark: 'swe-bench',
    phase: 'produce-patches',
    outputDir: result.outputDir,
    predictionsPath: result.predictionsPath,
    recordsPath: result.recordsPath,
    records: result.records.map((record) => ({
      instance_id: record.instanceId,
      agent: record.agent,
      student_variant: record.studentVariant,
      status: record.status,
      patch_bytes: Buffer.byteLength(record.prediction.model_patch),
      duration_ms: record.durationMs,
      turns: record.trace?.turnCount ?? 0,
      input_tokens: record.trace?.tokenUsage.inputTokens ?? 0,
      guard_rule_counts: record.trace?.guardRuleCounts ?? {},
      error: record.errorMessage,
    })),
  }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = {
    instancesPath: process.env.SWEBENCH_INSTANCES_PATH ?? '',
    agent: parseAgent(process.env.SWEBENCH_AGENT ?? 'student-agent'),
    instanceIds: [],
    keepWorktrees: false,
    dryRun: false,
    studentVariant: parseStudentVariant(process.env.SWEBENCH_STUDENT_VARIANT ?? 'context_runtime'),
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--instances-path' && args[index + 1]) {
      parsed.instancesPath = args[++index];
      continue;
    }
    if (arg === '--agent' && args[index + 1]) {
      parsed.agent = parseAgent(args[++index]);
      continue;
    }
    if (arg === '--student-variant' && args[index + 1]) {
      parsed.studentVariant = parseStudentVariant(args[++index]);
      continue;
    }
    if (arg === '--output-dir' && args[index + 1]) {
      parsed.outputDir = args[++index];
      continue;
    }
    if (arg === '--limit' && args[index + 1]) {
      parsed.limit = Number.parseInt(args[++index], 10);
      continue;
    }
    if (arg === '--instance-id' && args[index + 1]) {
      parsed.instanceIds.push(args[++index]);
      continue;
    }
    if (arg === '--model-name' && args[index + 1]) {
      parsed.modelNameOrPath = args[++index];
      continue;
    }
    if (arg === '--keep-worktrees') {
      parsed.keepWorktrees = true;
      continue;
    }
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    if (arg === '--timeout-seconds' && args[index + 1]) {
      parsed.timeoutSeconds = Number.parseInt(args[++index], 10);
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
    throw new Error(`Unknown eval-swebench:produce argument: ${arg}`);
  }

  if (!parsed.instancesPath) {
    throw new Error('--instances-path is required. Use a local SWE-bench instances JSON/JSONL file.');
  }
  if (parsed.limit !== undefined && (!Number.isInteger(parsed.limit) || parsed.limit <= 0)) {
    throw new Error('--limit must be a positive integer');
  }
  if (parsed.timeoutSeconds !== undefined && (!Number.isInteger(parsed.timeoutSeconds) || parsed.timeoutSeconds <= 0)) {
    throw new Error('--timeout-seconds must be a positive integer');
  }
  if (parsed.claudeMaxBudgetUsd !== undefined && (!Number.isFinite(parsed.claudeMaxBudgetUsd) || parsed.claudeMaxBudgetUsd <= 0)) {
    throw new Error('--claude-max-budget-usd must be a positive number');
  }
  return parsed;
}

function parseAgent(value: string): SweBenchAgent {
  if (value === 'student-agent' || value === 'claude-code') return value;
  throw new Error(`Unknown SWE-bench patch producer agent: ${value}`);
}

function parseStudentVariant(value: string): ContextRuntimeEvalVariant {
  if (value === 'plain' || value === 'context_runtime') return value;
  throw new Error(`Unknown SWE-bench student variant: ${value}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
