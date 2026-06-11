import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOCOBENCH_AGENT_FINAL_METRICS,
  buildLoCoBenchAgentSessionResult,
  scoreLoCoBenchAgentRecord,
  scoreLoCoBenchAgentRecordsFile,
  summarizeLoCoBenchAgentScores,
} from '../locobench-agent-scorer.js';
import type { EvalRunRecord } from '../types.js';

describe('LoCoBench-Agent scorer adapter', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'locobench-agent-scorer-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('maps a student-agent eval record to LoCoBench-Agent session_result shape', () => {
    const session = buildLoCoBenchAgentSessionResult(record('context_runtime', 1, 1));

    expect(session.status).toBe('completed');
    expect(session.modified_files).toEqual({
      'src/a.ts': 'export function calculateTotal(value: number) {\n  return value + 1;\n}\n',
      'src/b.ts': 'import { calculateTotal } from "./a";\nexport const total = calculateTotal(1);\n',
    });
    expect(session.tool_usage_log).toEqual([
      {
        tool_call: {
          function_name: 'read_file',
          parameters: { path: 'src/a.ts' },
        },
        is_error: false,
      },
      {
        tool_call: {
          function_name: 'edit_file',
          parameters: { path: 'src/a.ts' },
        },
        is_error: false,
      },
    ]);
  });

  it('scores records with the official final 9 LCBA metric names and formula', () => {
    const scored = scoreLoCoBenchAgentRecord(record('context_runtime', 1, 1));

    expect(Object.keys(scored.metrics).sort()).toEqual([...LOCOBENCH_AGENT_FINAL_METRICS].sort());
    expect(scored.lcba.comprehensionScore).toBeGreaterThan(0);
    expect(scored.lcba.efficiencyScore).toBeGreaterThan(0);
    expect(scored.lcba.overallScore).toBeCloseTo(
      scored.lcba.comprehensionScore * 0.6 + scored.lcba.efficiencyScore * 0.4,
      6,
    );
    expect(scored.lcba.overallScore5).toBeCloseTo(scored.lcba.overallScore * 5, 6);
    expect(scored.source).toBe('locobench_agent_bias_free_final_9_adapter');
  });

  it('summarizes LoCoBench-Agent scores by variant', () => {
    const scores = [
      scoreLoCoBenchAgentRecord(record('plain', 1, 0.7)),
      scoreLoCoBenchAgentRecord(record('plain', 2, 0.9)),
      scoreLoCoBenchAgentRecord(record('context_runtime', 1, 1)),
    ];

    expect(summarizeLoCoBenchAgentScores(scores)).toMatchObject([
      {
        variant: 'context_runtime',
        runs: 1,
      },
      {
        variant: 'plain',
        runs: 2,
      },
    ]);
    expect(summarizeLoCoBenchAgentScores(scores)[1].averageOverallScore)
      .toBeCloseTo((scores[0].lcba.overallScore + scores[1].lcba.overallScore) / 2, 6);
  });

  it('reads records.json and writes JSON plus markdown reports', async () => {
    const inputPath = join(tmpDir, 'records.json');
    const outputDir = join(tmpDir, 'scores');
    await writeFile(inputPath, JSON.stringify({
      records: [
        { variant: 'plain', ...record('plain', 1, 0.8) },
        { variant: 'context_runtime', ...record('context_runtime', 1, 1) },
      ],
    }), 'utf-8');

    const report = await scoreLoCoBenchAgentRecordsFile({ inputPath, outputDir });

    expect(report.records).toHaveLength(2);
    expect(report.summaries.map((summary) => summary.variant)).toEqual(['context_runtime', 'plain']);
    await expect(readFile(join(outputDir, 'locobench-agent-scores.json'), 'utf-8'))
      .resolves.toContain('"overallScore"');
    await expect(readFile(join(outputDir, 'locobench-agent-scores.md'), 'utf-8'))
      .resolves.toContain('LoCoBench-Agent LCBA Scores');
  });
});

function record(
  variant: string,
  trial: number,
  correctnessScore: number,
): EvalRunRecord & { variant: string } {
  return {
    variant,
    taskId: 'sample-locobench',
    title: 'Sample LoCoBench Task',
    mode: 'direct',
    trial,
    trace: {
      taskId: 'sample-locobench',
      mode: 'direct',
      instruction: 'Modify src/a.ts and keep related file src/b.ts consistent.',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:04.000Z',
      durationMs: 4000,
      status: correctnessScore >= 1 ? 'success' : 'failed',
      finalOutput: 'Done. Previously read src/a.ts and validated the change.',
      toolCalls: [
        {
          id: 'read-1',
          name: 'read',
          args: { path: 'src/a.ts' },
          startedAt: '2026-01-01T00:00:00.000Z',
          endedAt: '2026-01-01T00:00:01.000Z',
          isError: false,
        },
        {
          id: 'edit-1',
          name: 'edit',
          args: { path: 'src/a.ts' },
          startedAt: '2026-01-01T00:00:01.000Z',
          endedAt: '2026-01-01T00:00:02.000Z',
          isError: false,
        },
      ],
      tokenUsage: {
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 500,
        cacheWriteTokens: 0,
        totalTokens: 1700,
        costUsd: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0.01 * trial,
        },
      },
    },
    verifier: {
      exitCode: correctnessScore >= 1 ? 0 : 1,
      stdout: '',
      stderr: '',
      durationMs: 1,
      correctnessScore,
      rewardSource: 'exit_code',
    },
    changedFiles: ['src/a.ts', 'src/b.ts'],
    modifiedFiles: {
      'src/a.ts': 'export function calculateTotal(value: number) {\n  return value + 1;\n}\n',
      'src/b.ts': 'import { calculateTotal } from "./a";\nexport const total = calculateTotal(1);\n',
    },
    score: {
      correctnessScore,
      behaviorScore: 1,
      efficiencyMetrics: {
        totalToolCalls: 2,
        failedToolCalls: 0,
        repeatedToolCalls: 0,
        durationMs: 4000,
        toolCounts: { read: 1, edit: 1 },
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
