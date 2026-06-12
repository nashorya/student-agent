import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildEvalWebuiReport,
  writeEvalWebuiReport,
} from '../webui-report.js';

describe('eval webui report', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'eval-webui-report-test-'));
    await seedEvalTree(rootDir);
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('builds a catalog of eval tasks, draft specs, ablation manifest, context evals, and trace grader', async () => {
    const report = await buildEvalWebuiReport({
      rootDir,
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(report.generatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(report.summary).toMatchObject({
      baselineTaskCount: 2,
      draftSpecCount: 1,
      contextRuntimeEvalCount: 2,
      hasTraceGrader: true,
    });
    expect(report.catalog.baselineTasks.map((task) => task.id)).toEqual(['direct-edit', 'task-flow']);
    expect(report.catalog.baselineTasks[0]).toMatchObject({
      title: 'Direct Edit',
      mode: 'direct',
      tags: ['edit'],
      command: 'npm run eval:baseline -- --task direct-edit',
    });
    expect(report.catalog.draftSpecs[0]).toMatchObject({
      id: 'hashline-draft',
      component: 'hashline',
      description: 'Hashline的通用草稿规格，用来评测目标行为是否符合预期。关注指标：hashline_rejection_count。',
      metrics: ['hashline_rejection_count'],
      passCondition: 'hashline_rejection_count == 1',
    });
    expect(report.catalog.ablationManifest).toMatchObject({
      id: 'ablation-test',
      configCount: 2,
      metricCount: 1,
      taskCount: 1,
    });
    expect(report.catalog.contextRuntimeEvals.map((item) => item.id)).toEqual([
      'recall-ranking',
      'tier-selection',
    ]);
    expect(report.catalog.traceGrader).toMatchObject({
      id: 'trace-grader-v0',
      status: 'standalone_ready',
    });
  });

  it('summarizes latest baseline and ablation result files', async () => {
    const report = await buildEvalWebuiReport({
      rootDir,
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(report.results.latestBaseline).toMatchObject({
      path: 'evals/results/baseline-2026-01-02T00-00-00-000Z.json',
      recordCount: 2,
      passedCount: 1,
      failedCount: 1,
      averageCorrectness: 0.5,
      averageBehavior: 0.75,
    });
    expect(report.results.latestBaseline?.records.map((record) => record.taskId)).toEqual([
      'direct-edit',
      'task-flow',
    ]);
    expect(report.results.latestAblation).toMatchObject({
      outputDir: 'evals/results/ablation/2026-01-02T00-00-00-000Z',
      mode: 'dry_run',
      configCount: 2,
    });
    expect(report.results.latestContextRuntime).toMatchObject({
      outputDir: 'evals/results/context-runtime/2026-01-02T00-00-00-000Z',
      summaryCount: 2,
      summaries: [
        {
          variant: 'context_runtime',
          passRate: 1,
          totalTokens: 200,
          totalCostUsd: 0.08,
        },
        {
          variant: 'plain',
          passRate: 0.5,
          totalTokens: 100,
          totalCostUsd: 0.04,
        },
      ],
    });
    expect(report.results.latestAblation?.metricsByConfig.map((item) => item.config)).toEqual([
      'baseline',
      'all_components',
    ]);
    expect(report.results.contextRuntime.status).toBe('test_files_detected');
    expect(report.results.traceGrader.status).toBe('standalone_ready');
  });

  it('writes the report to evals/results/latest/eval-report.json', async () => {
    const outputPath = await writeEvalWebuiReport({
      rootDir,
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(outputPath).toBe(join(rootDir, 'evals', 'results', 'latest', 'eval-report.json'));
    const persisted = JSON.parse(await readFile(outputPath, 'utf-8')) as Awaited<ReturnType<typeof buildEvalWebuiReport>>;
    expect(persisted.summary.baselineTaskCount).toBe(2);
    expect(persisted.results.latestBaseline?.passedCount).toBe(1);
  });
});

async function seedEvalTree(rootDir: string): Promise<void> {
  await writeText(join(rootDir, 'evals/tasks/direct-edit/task.toml'), [
    'id = "direct-edit"',
    'title = "Direct Edit"',
    'mode = "direct"',
    'tags = ["edit"]',
    'expected_files = ["src/a.ts"]',
  ].join('\n'));
  await writeText(join(rootDir, 'evals/tasks/task-flow/task.toml'), [
    'id = "task-flow"',
    'title = "Task Flow"',
    'mode = "task"',
    'tags = ["workflow"]',
    'expected_files = ["src/b.ts"]',
  ].join('\n'));
  await writeJson(join(rootDir, 'evals/drafts/hashline-draft/spec.json'), {
    id: 'hashline-draft',
    component: 'hashline',
    construct: 'Hashline rejection integrity',
    expectedBehavior: 'Reject stale edits',
    metrics: ['hashline_rejection_count'],
    passCondition: 'hashline_rejection_count == 1',
  });
  await writeJson(join(rootDir, 'evals/ablation/benchmark-manifest.json'), {
    id: 'ablation-test',
    version: 'v0',
    configs: ['baseline', 'all_components'],
    metrics: [{ name: 'task_success_rate', source: 'run_archive', required: true }],
    tasks: [{ id: 'direct-edit', regressionRisks: ['risk'] }],
  });
  await writeText(join(rootDir, 'src/evals/context-runtime/tier-selection.eval.test.ts'), 'describe("tier", () => {});');
  await writeText(join(rootDir, 'src/evals/context-runtime/recall-ranking.eval.test.ts'), 'describe("recall", () => {});');
  await writeText(join(rootDir, 'src/evals/trace-grader/__tests__/trace-grader.test.ts'), 'describe("trace", () => {});');
  await writeJson(join(rootDir, 'evals/results/baseline-2026-01-01T00-00-00-000Z.json'), {
    records: [],
  });
  await writeJson(join(rootDir, 'evals/results/baseline-2026-01-02T00-00-00-000Z.json'), {
    records: [
      baselineRecord('direct-edit', 1, 1, 2, 0),
      baselineRecord('task-flow', 0, 0.5, 3, 1),
    ],
  });
  await writeJson(join(rootDir, 'evals/results/ablation/2026-01-02T00-00-00-000Z/config.json'), {
    mode: 'dry_run',
  });
  await writeJson(join(rootDir, 'evals/results/ablation/2026-01-02T00-00-00-000Z/metrics-by-config.json'), {
    metricsByConfig: [
      { config: 'baseline', runs: 1, metrics: { task_success_rate: 0 } },
      { config: 'all_components', runs: 1, metrics: { task_success_rate: 0 } },
    ],
  });
  await writeJson(join(rootDir, 'evals/results/context-runtime/2026-01-02T00-00-00-000Z/summary.json'), {
    summaries: [
      {
        variant: 'context_runtime',
        runs: 1,
        passed: 1,
        failed: 0,
        passRate: 1,
        averageCorrectness: 1,
        averageBehavior: 1,
        totalToolCalls: 5,
        failedToolCalls: 0,
        totalTokens: 200,
        inputTokens: 160,
        outputTokens: 40,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCostUsd: 0.08,
        costPerRunUsd: 0.08,
        costPerPassedTaskUsd: 0.08,
      },
      {
        variant: 'plain',
        runs: 2,
        passed: 1,
        failed: 1,
        passRate: 0.5,
        averageCorrectness: 0.5,
        averageBehavior: 0.75,
        totalToolCalls: 7,
        failedToolCalls: 1,
        totalTokens: 100,
        inputTokens: 70,
        outputTokens: 30,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCostUsd: 0.04,
        costPerRunUsd: 0.02,
        costPerPassedTaskUsd: 0.04,
      },
    ],
  });
}

function baselineRecord(
  taskId: string,
  correctnessScore: number,
  behaviorScore: number,
  totalToolCalls: number,
  failedToolCalls: number,
): unknown {
  return {
    taskId,
    title: taskId,
    mode: 'direct',
    trial: 1,
    score: {
      correctnessScore,
      behaviorScore,
      efficiencyMetrics: {
        totalToolCalls,
        failedToolCalls,
      },
      behaviorFindings: [],
    },
    changedFiles: [],
    modifiedFiles: {},
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, JSON.stringify(value, null, 2));
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf-8');
}
