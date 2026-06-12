import { describe, expect, it } from 'vitest';
import {
  buildSweBenchEvaluationCommand,
  buildTerminalBenchCommand,
  defaultExternalBenchmarkOutputDir,
} from '../external-benchmarks.js';

describe('external benchmark command builders', () => {
  it('builds a Harbor Terminal-Bench command with agent, model, dataset, and concurrency', () => {
    expect(buildTerminalBenchCommand({
      dataset: 'terminal-bench@2.0',
      agent: 'claude-code',
      model: 'anthropic/claude-opus-4-1',
      nConcurrent: 4,
      agentSetupTimeoutMultiplier: 3,
      nTasks: 1,
      outputDir: 'evals/results/terminal-bench/run-1',
    })).toEqual({
      command: 'harbor',
      args: [
        'run',
        '--dataset',
        'terminal-bench@2.0',
        '--agent',
        'claude-code',
        '--model',
        'anthropic/claude-opus-4-1',
        '--n-concurrent',
        '4',
        '--agent-setup-timeout-multiplier',
        '3',
        '--n-tasks',
        '1',
        '--jobs-dir',
        'evals/results/terminal-bench/run-1',
      ],
    });
  });

  it('builds a Harbor Terminal-Bench command for a custom agent import path', () => {
    expect(buildTerminalBenchCommand({
      dataset: 'terminal-bench@2.0',
      agentImportPath: 'benchmarks.terminal_bench.student_agent:StudentAgent',
      model: 'deepseek-v4-pro',
      nConcurrent: 1,
      outputDir: 'evals/results/terminal-bench/student-agent',
      envFile: '/tmp/student-agent.env',
    })).toEqual({
      command: 'harbor',
      args: [
        'run',
        '--dataset',
        'terminal-bench@2.0',
        '--agent-import-path',
        'benchmarks.terminal_bench.student_agent:StudentAgent',
        '--model',
        'deepseek-v4-pro',
        '--n-concurrent',
        '1',
        '--jobs-dir',
        'evals/results/terminal-bench/student-agent',
        '--env-file',
        '/tmp/student-agent.env',
      ],
    });
  });

  it('builds a Harbor Terminal-Bench command for a local task path without registry dataset lookup', () => {
    expect(buildTerminalBenchCommand({
      path: '/tmp/harbor/tasks/task-id/fix-git',
      agentImportPath: 'benchmarks.terminal_bench.student_agent:StudentAgent',
      model: 'deepseek-v4-pro',
      nConcurrent: 1,
      outputDir: 'evals/results/terminal-bench/student-agent',
    })).toEqual({
      command: 'harbor',
      args: [
        'run',
        '--path',
        '/tmp/harbor/tasks/task-id/fix-git',
        '--agent-import-path',
        'benchmarks.terminal_bench.student_agent:StudentAgent',
        '--model',
        'deepseek-v4-pro',
        '--n-concurrent',
        '1',
        '--jobs-dir',
        'evals/results/terminal-bench/student-agent',
      ],
    });
  });

  it('builds a SWE-bench official harness command for predictions.jsonl', () => {
    expect(buildSweBenchEvaluationCommand({
      pythonCommand: '/tmp/swebench/.venv/bin/python',
      datasetName: 'princeton-nlp/SWE-bench_Verified',
      predictionsPath: 'evals/results/swebench/predictions.jsonl',
      maxWorkers: 8,
      runId: 'student-agent-smoke',
    })).toEqual({
      command: '/tmp/swebench/.venv/bin/python',
      args: [
        '-m',
        'swebench.harness.run_evaluation',
        '--dataset_name',
        'princeton-nlp/SWE-bench_Verified',
        '--predictions_path',
        'evals/results/swebench/predictions.jsonl',
        '--max_workers',
        '8',
        '--run_id',
        'student-agent-smoke',
      ],
    });
  });

  it('builds timestamped default result directories for external benchmarks', () => {
    expect(defaultExternalBenchmarkOutputDir('terminal-bench', new Date('2026-06-09T01:02:03.456Z')))
      .toMatch(/evals\/results\/terminal-bench\/2026-06-09T01-02-03-456Z$/u);
    expect(defaultExternalBenchmarkOutputDir('swebench', new Date('2026-06-09T01:02:03.456Z')))
      .toMatch(/evals\/results\/swebench\/2026-06-09T01-02-03-456Z$/u);
  });
});
