import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createContextRuntimeBuildMemoryPrompt,
  describeContextRuntimeRecordDiagnostics,
  seedContextRuntimeEvalMemory,
  summarizeContextRuntimeRecords,
  type ContextRuntimeEvalRecord,
} from '../context-runtime-runner.js';
import { TasksManager } from '../../memory/tasks/manager.js';
import type { EvalTaskDefinition } from '../types.js';

describe('context runtime eval runner helpers', () => {
  let memoryDir: string;

  beforeEach(async () => {
    memoryDir = await mkdtemp(join(tmpdir(), 'context-runtime-runner-test-'));
  });

  afterEach(async () => {
    TasksManager.resetInstance();
    await rm(memoryDir, { recursive: true, force: true });
  });

  it('seeds an active task so the context_runtime variant injects L1/L2/L3 context', async () => {
    await seedContextRuntimeEvalMemory({
      memoryDir,
      task: taskDefinition('multi-phase-feature', 'Multi Phase Feature', 'task'),
      instruction: 'Implement a multi-step calculator feature.',
    });

    const buildPrompt = createContextRuntimeBuildMemoryPrompt('context_runtime', memoryDir);
    const prompt = await buildPrompt!();

    expect(prompt).toContain('Context Assembly');
    expect(prompt).toContain('### taskSpec');
    expect(prompt).toContain('Goal: Eval task: Multi Phase Feature');
    expect(prompt).toContain('Current step: Execute eval task multi-phase-feature');
  });

  it('does not inject a memory prompt for the plain variant', () => {
    expect(createContextRuntimeBuildMemoryPrompt('plain', memoryDir)).toBeUndefined();
  });

  it('summarizes pass rate and averages per variant', () => {
    const records: ContextRuntimeEvalRecord[] = [
      record('plain', 'task-a', 1, 1, 1, 4, 0),
      record('plain', 'task-a', 2, 0, 0.5, 6, 1),
      record('context_runtime', 'task-a', 1, 1, 0.88, 5, 0),
    ];

    expect(summarizeContextRuntimeRecords(records)).toEqual([
      {
        variant: 'context_runtime',
        runs: 1,
        passed: 1,
        failed: 0,
        passRate: 1,
        averageCorrectness: 1,
        averageBehavior: 0.88,
        totalToolCalls: 5,
        failedToolCalls: 0,
        totalTokens: 80,
        inputTokens: 50,
        outputTokens: 30,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCostUsd: 0.04,
        costPerRunUsd: 0.04,
        costPerPassedTaskUsd: 0.04,
      },
      {
        variant: 'plain',
        runs: 2,
        passed: 1,
        failed: 1,
        passRate: 0.5,
        averageCorrectness: 0.5,
        averageBehavior: 0.75,
        totalToolCalls: 10,
        failedToolCalls: 1,
        totalTokens: 300,
        inputTokens: 200,
        outputTokens: 90,
        cacheReadTokens: 10,
        cacheWriteTokens: 0,
        totalCostUsd: 0.17,
        costPerRunUsd: 0.085,
        costPerPassedTaskUsd: 0.17,
      },
    ]);
  });

  it('surfaces agent errors in CLI diagnostics', () => {
    const failed = record('context_runtime', 'task-a', 1, 0, 0.88, 0, 0);
    failed.trace.status = 'failed';
    failed.trace.errorMessage = '401 Invalid API key.';
    failed.trace.taskState = { status: 'planning_failed', phaseCount: 0, phases: [] };
    failed.score.behaviorFindings = ['task mode did not finish with completed task state'];

    expect(describeContextRuntimeRecordDiagnostics(failed)).toEqual([
      'agent error: 401 Invalid API key.',
      'task state: planning_failed',
      'task mode did not finish with completed task state',
    ]);
  });
});

function taskDefinition(id: string, title: string, mode: EvalTaskDefinition['mode']): EvalTaskDefinition {
  return {
    id,
    title,
    mode,
    tags: [],
    timeoutSeconds: 300,
    expectedFiles: [],
    taskDir: '',
    instructionPath: '',
    environmentDir: '',
    testScriptPath: '',
  };
}

function record(
  variant: ContextRuntimeEvalRecord['variant'],
  taskId: string,
  trial: number,
  correctnessScore: number,
  behaviorScore: number,
  totalToolCalls: number,
  failedToolCalls: number,
): ContextRuntimeEvalRecord {
  return {
    variant,
    taskId,
    title: taskId,
    mode: 'direct',
    trial,
    trace: {
      taskId,
      mode: 'direct',
      instruction: '',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1000,
      status: 'success',
      finalOutput: '',
      toolCalls: [],
      tokenUsage: usageFor(variant, trial),
    },
    verifier: {
      exitCode: correctnessScore >= 1 ? 0 : 1,
      stdout: '',
      stderr: '',
      durationMs: 1,
      correctnessScore,
      rewardSource: 'exit_code',
    },
    changedFiles: [],
    score: {
      correctnessScore,
      behaviorScore,
      efficiencyMetrics: {
        totalToolCalls,
        failedToolCalls,
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

function usageFor(variant: ContextRuntimeEvalRecord['variant'], trial: number) {
  if (variant === 'context_runtime') {
    return {
      inputTokens: 50,
      outputTokens: 30,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 80,
      costUsd: {
        input: 0.02,
        output: 0.02,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0.04,
      },
    };
  }
  return trial === 1
    ? {
      inputTokens: 120,
      outputTokens: 40,
      cacheReadTokens: 10,
      cacheWriteTokens: 0,
      totalTokens: 170,
      costUsd: {
        input: 0.06,
        output: 0.03,
        cacheRead: 0.01,
        cacheWrite: 0,
        total: 0.1,
      },
    }
    : {
      inputTokens: 80,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 130,
      costUsd: {
        input: 0.04,
        output: 0.03,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0.07,
      },
    };
}
