import { describe, expect, it } from 'vitest';
import {
  buildClaudeCodeArgs,
  parseClaudeCodeJsonResult,
  summarizeClaudeCodeRecords,
  type ClaudeCodeEvalRecord,
} from '../claude-code-runner.js';

describe('claude code eval runner helpers', () => {
  it('parses Claude Code JSON usage and cost', () => {
    const result = parseClaudeCodeJsonResult(JSON.stringify({
      type: 'result',
      is_error: false,
      result: 'done',
      total_cost_usd: 0.0123,
      usage: {
        input_tokens: 100,
        output_tokens: 25,
        cache_read_input_tokens: 60,
        cache_creation_input_tokens: 10,
      },
    }));

    expect(result.finalOutput).toBe('done');
    expect(result.errorMessage).toBeUndefined();
    expect(result.tokenUsage).toEqual({
      inputTokens: 100,
      outputTokens: 25,
      cacheReadTokens: 60,
      cacheWriteTokens: 10,
      totalTokens: 195,
      costUsd: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0.0123,
      },
    });
  });

  it('surfaces Claude Code JSON error results', () => {
    const result = parseClaudeCodeJsonResult(JSON.stringify({
      is_error: true,
      result: 'Not logged in · Please run /login',
      total_cost_usd: 0,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }));

    expect(result.errorMessage).toBe('Not logged in · Please run /login');
    expect(result.finalOutput).toBe('Not logged in · Please run /login');
  });

  it('builds non-interactive Claude Code args with JSON output and budget', () => {
    expect(buildClaudeCodeArgs({
      instruction: 'Do the task',
      maxBudgetUsd: 0.25,
      model: 'sonnet',
    })).toEqual([
      '-p',
      '--bare',
      '--output-format',
      'json',
      '--permission-mode',
      'bypassPermissions',
      '--no-session-persistence',
      '--max-budget-usd',
      '0.25',
      '--model',
      'sonnet',
      'Do the task',
    ]);
  });

  it('summarizes Claude Code records with token totals', () => {
    const records = [
      record(1, 1, 0.9, 100),
      record(2, 0, 0.7, 200),
    ];

    expect(summarizeClaudeCodeRecords(records)).toEqual({
      variant: 'claude_code',
      runs: 2,
      passed: 1,
      failed: 1,
      passRate: 0.5,
      averageCorrectness: 0.5,
      averageBehavior: 0.8,
      totalToolCalls: 0,
      failedToolCalls: 0,
      totalTokens: 300,
      inputTokens: 150,
      outputTokens: 50,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
      totalCostUsd: 0.03,
      costPerRunUsd: 0.015,
      costPerPassedTaskUsd: 0.03,
    });
  });
});

function record(
  trial: number,
  correctnessScore: number,
  behaviorScore: number,
  totalTokens: number,
): ClaudeCodeEvalRecord {
  return {
    variant: 'claude_code',
    taskId: 'sample',
    title: 'Sample',
    mode: 'task',
    trial,
    trace: {
      taskId: 'sample',
      mode: 'task',
      instruction: '',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1000,
      status: correctnessScore >= 1 ? 'success' : 'failed',
      finalOutput: '',
      toolCalls: [],
      tokenUsage: {
        inputTokens: totalTokens / 2,
        outputTokens: totalTokens / 6,
        cacheReadTokens: totalTokens / 3,
        cacheWriteTokens: 0,
        totalTokens,
        costUsd: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: totalTokens / 10000,
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
    changedFiles: [],
    score: {
      correctnessScore,
      behaviorScore,
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
