import type { RunEvent, TaskOutcome } from '../memory/run-archive/index.js';
import type { AblationConfigName } from './ablation-config.js';

export interface AblationRunMetrics {
  task_success_rate: number;
  verified_pass_rate: number;
  tool_error_count: number;
  unsafe_tool_block_count: number;
  hashline_rejection_count: number;
  hashline_recovery_count: number;
  lostness_trigger_count: number;
  user_correction_count: number;
  estimated_prompt_tokens: number;
  output_tokens: number;
  repeated_tool_call_count: number;
  run_duration_ms: number;
  trace_event_count: number;
}

export type AblationMetricName = keyof AblationRunMetrics;

export interface AblationRunMetricInput {
  outcome: TaskOutcome;
  events: RunEvent[];
  verifierPassed?: boolean;
  estimatedPromptTokens?: number;
  outputTokens?: number;
  runDurationMs?: number;
}

export interface AblationConfigMetrics {
  config: AblationConfigName;
  runs: number;
  metrics: AblationRunMetrics;
}

export interface AblationComparison {
  baseline: AblationConfigName;
  bestSingleComponent: AblationConfigName | null;
  metric: AblationMetricName;
  deltaVsBaseline: Record<string, number>;
  deltaVsBestSingleComponent: Record<string, number>;
  interactionLoss: number | null;
}

const SINGLE_COMPONENT_CONFIGS: AblationConfigName[] = [
  'toolguard_only',
  'contextbuilder_only',
  'signal_pipeline_only',
  'hashline_only',
];

export function extractAblationRunMetrics(input: AblationRunMetricInput): AblationRunMetrics {
  const verifierPassed = input.verifierPassed ?? (input.outcome.status === 'success');
  return {
    task_success_rate: input.outcome.status === 'success' ? 1 : 0,
    verified_pass_rate: verifierPassed ? 1 : 0,
    tool_error_count: input.outcome.toolErrorCount,
    unsafe_tool_block_count: countEvents(input.events, 'toolguard_block'),
    hashline_rejection_count: input.outcome.hashlineRejectionCount,
    hashline_recovery_count: input.outcome.hashlineRecoveryCount,
    lostness_trigger_count: input.outcome.lostnessTriggerCount,
    user_correction_count: input.outcome.userCorrectionCount,
    estimated_prompt_tokens: input.estimatedPromptTokens ?? 0,
    output_tokens: input.outputTokens ?? 0,
    repeated_tool_call_count: input.outcome.repeatedToolCallCount,
    run_duration_ms: input.runDurationMs ?? 0,
    trace_event_count: input.events.length,
  };
}

export function aggregateAblationMetrics(
  config: AblationConfigName,
  runs: AblationRunMetrics[],
): AblationConfigMetrics {
  if (runs.length === 0) {
    return { config, runs: 0, metrics: zeroMetrics() };
  }
  const totals = runs.reduce<AblationRunMetrics>((acc, metrics) => addMetrics(acc, metrics), zeroMetrics());
  return {
    config,
    runs: runs.length,
    metrics: divideMetrics(totals, runs.length),
  };
}

export function compareAblationConfigs(
  configs: AblationConfigMetrics[],
  metric: AblationMetricName = 'task_success_rate',
): AblationComparison {
  const baseline = requiredConfig(configs, 'baseline');
  const allComponents = configs.find((config) => config.config === 'all_components');
  const singles = SINGLE_COMPONENT_CONFIGS
    .map((name) => configs.find((config) => config.config === name))
    .filter((config): config is AblationConfigMetrics => Boolean(config));
  const bestSingle = singles.reduce<AblationConfigMetrics | null>((best, current) => {
    if (!best || current.metrics[metric] > best.metrics[metric]) return current;
    return best;
  }, null);
  const deltaVsBaseline = Object.fromEntries(configs.map((config) => [
    config.config,
    round(config.metrics[metric] - baseline.metrics[metric]),
  ]));
  const deltaVsBestSingleComponent = bestSingle
    ? Object.fromEntries(configs.map((config) => [
      config.config,
      round(config.metrics[metric] - bestSingle.metrics[metric]),
    ]))
    : {};
  const singleSumGain = singles.reduce((sum, config) => (
    sum + Math.max(0, config.metrics[metric] - baseline.metrics[metric])
  ), 0);
  const allGain = allComponents ? allComponents.metrics[metric] - baseline.metrics[metric] : null;

  return {
    baseline: 'baseline',
    bestSingleComponent: bestSingle?.config ?? null,
    metric,
    deltaVsBaseline,
    deltaVsBestSingleComponent,
    interactionLoss: allGain === null ? null : round(singleSumGain - allGain),
  };
}

function countEvents(events: RunEvent[], kind: RunEvent['kind']): number {
  return events.filter((event) => event.kind === kind).length;
}

function requiredConfig(configs: AblationConfigMetrics[], name: AblationConfigName): AblationConfigMetrics {
  const found = configs.find((config) => config.config === name);
  if (!found) throw new Error(`Missing ablation config metrics: ${name}`);
  return found;
}

function zeroMetrics(): AblationRunMetrics {
  return {
    task_success_rate: 0,
    verified_pass_rate: 0,
    tool_error_count: 0,
    unsafe_tool_block_count: 0,
    hashline_rejection_count: 0,
    hashline_recovery_count: 0,
    lostness_trigger_count: 0,
    user_correction_count: 0,
    estimated_prompt_tokens: 0,
    output_tokens: 0,
    repeated_tool_call_count: 0,
    run_duration_ms: 0,
    trace_event_count: 0,
  };
}

function addMetrics(a: AblationRunMetrics, b: AblationRunMetrics): AblationRunMetrics {
  const result = { ...a };
  for (const key of Object.keys(result) as AblationMetricName[]) {
    result[key] += b[key];
  }
  return result;
}

function divideMetrics(metrics: AblationRunMetrics, divisor: number): AblationRunMetrics {
  const result = { ...metrics };
  for (const key of Object.keys(result) as AblationMetricName[]) {
    result[key] = round(result[key] / divisor);
  }
  return result;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
