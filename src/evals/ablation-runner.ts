import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ABLATION_CONFIGS, type AblationConfigName } from './ablation-config.js';
import { loadAblationManifest, type AblationBenchmarkManifest } from './ablation-manifest.js';
import {
  aggregateAblationMetrics,
  compareAblationConfigs,
  type AblationConfigMetrics,
  type AblationRunMetrics,
} from './ablation-metrics.js';

export interface AblationRunnerOptions {
  manifestPath?: string;
  resultsRoot?: string;
}

export interface AblationDryRunRecord {
  config: AblationConfigName;
  taskId: string;
  mode: 'dry_run';
  blockedMetrics: string[];
  metrics: AblationRunMetrics;
}

export interface AblationRunnerResult {
  manifest: AblationBenchmarkManifest;
  records: AblationDryRunRecord[];
  metricsByConfig: AblationConfigMetrics[];
  comparison: ReturnType<typeof compareAblationConfigs>;
  outputDir: string;
}

export async function runAblationDryRun(
  options: AblationRunnerOptions = {},
): Promise<AblationRunnerResult> {
  const manifest = await loadAblationManifest(options.manifestPath);
  const records = makeDryRunRecords(manifest);
  const metricsByConfig = manifest.configs.map((config) => aggregateAblationMetrics(
    config,
    records.filter((record) => record.config === config).map((record) => record.metrics),
  ));
  const comparison = compareAblationConfigs(metricsByConfig);
  const outputDir = await writeAblationReports({
    manifest,
    records,
    metricsByConfig,
    comparison,
    resultsRoot: options.resultsRoot,
  });
  return {
    manifest,
    records,
    metricsByConfig,
    comparison,
    outputDir,
  };
}

function makeDryRunRecords(manifest: AblationBenchmarkManifest): AblationDryRunRecord[] {
  return manifest.configs.flatMap((config) => manifest.tasks.map((task) => ({
    config,
    taskId: task.id,
    mode: 'dry_run' as const,
    blockedMetrics: manifest.metrics
      .filter((metric) => metric.source === 'blocked_for_trace_grader')
      .map((metric) => metric.name),
    metrics: zeroMetrics(),
  })));
}

async function writeAblationReports(options: {
  manifest: AblationBenchmarkManifest;
  records: AblationDryRunRecord[];
  metricsByConfig: AblationConfigMetrics[];
  comparison: ReturnType<typeof compareAblationConfigs>;
  resultsRoot?: string;
}): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = join(options.resultsRoot ?? resolve(process.cwd(), 'evals/results/ablation'), stamp);
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'config.json'), JSON.stringify({
    manifestId: options.manifest.id,
    manifestVersion: options.manifest.version,
    mode: 'dry_run',
    configs: Object.fromEntries(options.manifest.configs.map((name) => [name, ABLATION_CONFIGS[name]])),
  }, null, 2), 'utf-8');
  await writeFile(
    join(outputDir, 'per-run.jsonl'),
    options.records.map((record) => JSON.stringify(record)).join('\n') + '\n',
    'utf-8',
  );
  await writeFile(
    join(outputDir, 'metrics-by-config.json'),
    JSON.stringify({ metricsByConfig: options.metricsByConfig, comparison: options.comparison }, null, 2),
    'utf-8',
  );
  await writeFile(join(outputDir, 'comparison.md'), renderComparison(options), 'utf-8');
  return outputDir;
}

function renderComparison(options: {
  manifest: AblationBenchmarkManifest;
  records: AblationDryRunRecord[];
  metricsByConfig: AblationConfigMetrics[];
  comparison: ReturnType<typeof compareAblationConfigs>;
}): string {
  const lines = [
    '# Ablation Dry Run Report',
    '',
    `Manifest: ${options.manifest.id}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    'This is a dry-run report. It validates manifest parsing, config expansion, and metric schema only.',
    '',
    '| Config | Runs | Task Success | Verified Pass | Tool Errors | Trace Events |',
    '|---|---:|---:|---:|---:|---:|',
  ];
  for (const item of options.metricsByConfig) {
    lines.push([
      `| ${item.config}`,
      String(item.runs),
      item.metrics.task_success_rate.toFixed(2),
      item.metrics.verified_pass_rate.toFixed(2),
      item.metrics.tool_error_count.toFixed(2),
      item.metrics.trace_event_count.toFixed(2),
    ].join(' | ') + ' |');
  }
  lines.push('', '## Comparison', '');
  lines.push(`- Metric: ${options.comparison.metric}`);
  lines.push(`- Best single component: ${options.comparison.bestSingleComponent ?? 'n/a'}`);
  lines.push(`- Interaction loss: ${options.comparison.interactionLoss ?? 'n/a'}`);
  lines.push('', '## Blocked Metrics', '');
  const blocked = [...new Set(options.records.flatMap((record) => record.blockedMetrics))];
  if (blocked.length === 0) {
    lines.push('- None');
  } else {
    for (const metric of blocked) lines.push(`- ${metric}: blocked_for_trace_grader`);
  }
  lines.push('');
  return lines.join('\n');
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
