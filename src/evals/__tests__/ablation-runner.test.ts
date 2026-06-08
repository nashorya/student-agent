import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAblationDryRun } from '../ablation-runner.js';

describe('ablation runner dry-run', () => {
  let resultsRoot: string;

  beforeEach(async () => {
    resultsRoot = await mkdtemp(join(tmpdir(), 'ablation-runner-test-'));
  });

  afterEach(async () => {
    await rm(resultsRoot, { recursive: true, force: true });
  });

  it('expands manifest configs into dry-run records and writes reports', async () => {
    const result = await runAblationDryRun({ resultsRoot });

    expect(result.records).toHaveLength(result.manifest.configs.length * result.manifest.tasks.length);
    expect(result.metricsByConfig).toHaveLength(result.manifest.configs.length);
    expect(result.comparison.metric).toBe('task_success_rate');

    const config = JSON.parse(await readFile(join(result.outputDir, 'config.json'), 'utf-8')) as {
      mode: string;
      configs: Record<string, unknown>;
    };
    expect(config.mode).toBe('dry_run');
    expect(Object.keys(config.configs)).toEqual(result.manifest.configs);

    const perRun = await readFile(join(result.outputDir, 'per-run.jsonl'), 'utf-8');
    expect(perRun.trim().split('\n')).toHaveLength(result.records.length);

    const report = await readFile(join(result.outputDir, 'comparison.md'), 'utf-8');
    expect(report).toContain('Ablation Dry Run Report');
    expect(report).toContain('blocked_for_trace_grader');
  });
});
