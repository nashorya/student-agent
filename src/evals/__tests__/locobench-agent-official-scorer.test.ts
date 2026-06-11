import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  scoreOfficialLoCoBenchAgentRecordsFile,
  summarizeOfficialLoCoBenchAgentScores,
} from '../locobench-agent-official-scorer.js';
import type { EvalRunRecord } from '../types.js';

describe('official LoCoBench-Agent scorer bridge', () => {
  let tmpDir: string;
  let officialRoot: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'official-locobench-agent-scorer-test-'));
    officialRoot = join(tmpDir, 'fake-official');
    await writeFakeOfficialEvaluator(officialRoot);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('calls the official BiasFreEvaluator interface and writes reports', async () => {
    const inputPath = join(tmpDir, 'records.json');
    const outputDir = join(tmpDir, 'scores');
    await writeFile(inputPath, JSON.stringify({
      records: [
        { variant: 'plain', ...record('plain', 1) },
        { variant: 'context_runtime', ...record('context_runtime', 1) },
      ],
    }), 'utf-8');

    const report = await scoreOfficialLoCoBenchAgentRecordsFile({
      inputPath,
      outputDir,
      locobenchAgentRoot: officialRoot,
      pythonCommand: 'python3',
    });

    expect(report.records).toHaveLength(2);
    expect(report.records[0]).toMatchObject({
      source: 'locobench_agent_official_bias_free_evaluator',
      variant: 'plain',
      taskId: 'sample-locobench',
      lcba: {
        comprehensionScore: 0.8,
        efficiencyScore: 0.6,
        overallScore: 0.72,
        overallScore5: 3.6,
        confidence: 0.9,
      },
    });
    expect(report.records[0].metrics.execution_success_rate.score).toBe(0.81);
    await expect(readFile(join(outputDir, 'locobench-agent-official-scores.json'), 'utf-8'))
      .resolves.toContain('locobench_agent_official_bias_free_evaluator');
    await expect(readFile(join(outputDir, 'locobench-agent-official-scores.md'), 'utf-8'))
      .resolves.toContain('Official LoCoBench-Agent LCBA Scores');
  });

  it('summarizes official scores by variant', () => {
    const summary = summarizeOfficialLoCoBenchAgentScores([
      officialScore('plain', 0.6, 0.5, 0.56),
      officialScore('plain', 0.8, 0.7, 0.76),
      officialScore('context_runtime', 0.9, 0.8, 0.86),
    ]);

    expect(summary).toEqual([
      {
        variant: 'context_runtime',
        runs: 1,
        averageComprehensionScore: 0.9,
        averageEfficiencyScore: 0.8,
        averageOverallScore: 0.86,
        averageOverallScore5: 4.3,
      },
      {
        variant: 'plain',
        runs: 2,
        averageComprehensionScore: 0.7,
        averageEfficiencyScore: 0.6,
        averageOverallScore: 0.66,
        averageOverallScore5: 3.3,
      },
    ]);
  });
});

async function writeFakeOfficialEvaluator(root: string): Promise<void> {
  const packageDir = join(root, 'locobench', 'evaluation');
  await mkdir(packageDir, { recursive: true });
  await writeFile(join(root, 'locobench', '__init__.py'), '', 'utf-8');
  await writeFile(join(packageDir, '__init__.py'), '', 'utf-8');
  await writeFile(join(packageDir, 'bias_free_evaluator.py'), `
class LCBAScores:
    def __init__(self):
        self.comprehension_score = 0.8
        self.efficiency_score = 0.6
        self.overall_score = 0.72
        self.confidence = 0.9

class MetricResult:
    def __init__(self, score, confidence):
        self.score = score
        self.confidence = confidence
        self.details = {"fake_official": True}
        self.bias_indicators = {}

class Result:
    def __init__(self):
        self.lcba_scores = LCBAScores()
        self.metric_results = {
            "execution_success_rate": MetricResult(0.81, 0.91),
            "multi_session_memory_retention": MetricResult(0.82, 0.92),
        }
        self.bias_report = {"overall_bias_score": 0.1}
        self.evaluation_metadata = {"framework_version": "fake-official"}

class BiasFreEvaluator:
    def __init__(self, enable_human_validation=False):
        self.enable_human_validation = enable_human_validation

    async def evaluate_agent_performance(self, scenario, solution_code, session_result):
        assert scenario["scenario_id"] == "sample-locobench"
        assert "src/a.ts" in solution_code
        assert session_result["modified_files"]["src/a.ts"].startswith("export")
        return Result()
`, 'utf-8');
}

function record(variant: string, trial: number): EvalRunRecord & { variant: string } {
  return {
    variant,
    taskId: 'sample-locobench',
    title: 'Sample LoCoBench Task',
    mode: 'direct',
    trial,
    trace: {
      taskId: 'sample-locobench',
      mode: 'direct',
      instruction: 'Update the calculation.',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1000,
      status: 'success',
      finalOutput: 'Done.',
      toolCalls: [],
      tokenUsage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 2,
        costUsd: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
    },
    verifier: {
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 1,
      correctnessScore: 1,
      rewardSource: 'exit_code',
    },
    changedFiles: ['src/a.ts'],
    modifiedFiles: {
      'src/a.ts': 'export const value = 1;\n',
    },
    score: {
      correctnessScore: 1,
      behaviorScore: 1,
      efficiencyMetrics: {
        totalToolCalls: 0,
        failedToolCalls: 0,
        repeatedToolCalls: 0,
        durationMs: 1000,
        toolCounts: {},
      },
      safetyMetrics: {
        dangerousBashCommands: 0,
        pathEscapeAttempts: 0,
        unexpectedChangedFiles: [],
        writeOverwriteCount: 0,
      },
      behaviorFindings: [],
    },
  };
}

function officialScore(
  variant: string,
  comprehensionScore: number,
  efficiencyScore: number,
  overallScore: number,
) {
  return {
    source: 'locobench_agent_official_bias_free_evaluator' as const,
    variant,
    taskId: 'task',
    trial: 1,
    metrics: {},
    lcba: {
      comprehensionScore,
      efficiencyScore,
      overallScore,
      overallScore5: overallScore * 5,
      confidence: 0.9,
    },
    metadata: {},
  };
}
