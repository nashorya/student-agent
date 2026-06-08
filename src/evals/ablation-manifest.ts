import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AblationConfigName } from './ablation-config.js';
import { ABLATION_CONFIGS } from './ablation-config.js';

export type AblationMetricSource = 'run_archive' | 'verifier' | 'trace' | 'blocked_for_trace_grader';

export interface AblationMetricSpec {
  name: string;
  source: AblationMetricSource;
  required: boolean;
}

export interface AblationTaskSpec {
  id: string;
  family: string;
  expectedRelevantComponent: keyof typeof ABLATION_CONFIGS['all_components'];
  requiredVerifier: string;
  requiredTraceMetrics: string[];
  regressionRisks: string[];
}

export interface AblationBenchmarkManifest {
  schemaVersion: 1;
  id: string;
  version: string;
  description: string;
  configs: AblationConfigName[];
  metrics: AblationMetricSpec[];
  tasks: AblationTaskSpec[];
}

const DEFAULT_MANIFEST_PATH = 'evals/ablation/benchmark-manifest.json';

export async function loadAblationManifest(
  manifestPath = resolve(process.cwd(), DEFAULT_MANIFEST_PATH),
): Promise<AblationBenchmarkManifest> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as AblationBenchmarkManifest;
  validateAblationManifest(manifest);
  return manifest;
}

export function validateAblationManifest(manifest: AblationBenchmarkManifest): void {
  if (manifest.schemaVersion !== 1) {
    throw new Error('Ablation manifest schemaVersion must be 1');
  }
  if (!manifest.id) throw new Error('Ablation manifest id is required');
  if (!manifest.version) throw new Error('Ablation manifest version is required');
  if (manifest.configs.length === 0) throw new Error('Ablation manifest configs must be non-empty');
  for (const config of manifest.configs) {
    if (!(config in ABLATION_CONFIGS)) throw new Error(`Unknown ablation config: ${config}`);
  }
  if (manifest.tasks.length === 0) throw new Error('Ablation manifest tasks must be non-empty');
  for (const task of manifest.tasks) {
    if (!task.id) throw new Error('Ablation task id is required');
    if (!task.family) throw new Error(`Ablation task ${task.id} family is required`);
    if (!task.requiredVerifier) throw new Error(`Ablation task ${task.id} requiredVerifier is required`);
    if (task.regressionRisks.length === 0) {
      throw new Error(`Ablation task ${task.id} regressionRisks must be non-empty`);
    }
  }
  if (manifest.metrics.length === 0) throw new Error('Ablation manifest metrics must be non-empty');
  for (const metric of manifest.metrics) {
    if (!metric.name) throw new Error('Ablation metric name is required');
    if (!['run_archive', 'verifier', 'trace', 'blocked_for_trace_grader'].includes(metric.source)) {
      throw new Error(`Unknown ablation metric source: ${metric.source}`);
    }
  }
}
