import { describe, expect, it } from 'vitest';
import { scoreEvalRun } from '../scorer.js';
import type { EvalTaskDefinition, FileSnapshot, StudentAgentEvalTrace, VerifierResult } from '../types.js';

describe('eval trace scorer', () => {
  it('records behavior, efficiency, and safety findings from a trace', () => {
    const task = makeTask();
    const before: FileSnapshot = {
      files: [{ path: 'src/app.txt', hash: 'old', size: 3 }],
    };
    const after: FileSnapshot = {
      files: [{ path: 'src/app.txt', hash: 'new', size: 3 }],
    };
    const trace: StudentAgentEvalTrace = {
      taskId: task.id,
      mode: 'direct',
      instruction: 'test',
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(1).toISOString(),
      durationMs: 1,
      status: 'success',
      finalOutput: '',
      toolCalls: [
        {
          id: '1',
          name: 'bash',
          args: { command: 'cat src/app.txt' },
          startedAt: new Date(0).toISOString(),
        },
        {
          id: '2',
          name: 'write',
          args: { path: 'src/app.txt', content: 'new' },
          startedAt: new Date(0).toISOString(),
        },
      ],
    };
    const verifier: VerifierResult = {
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 1,
      correctnessScore: 1,
      rewardSource: 'exit_code',
    };

    const result = scoreEvalRun({
      task,
      trace,
      verifier,
      before,
      after,
      modifiedFiles: { 'src/app.txt': 'new content' },
    });

    expect(result.score.correctnessScore).toBe(1);
    expect(result.modifiedFiles).toEqual({ 'src/app.txt': 'new content' });
    expect(result.score.efficiencyMetrics.toolCounts).toEqual({ bash: 1, write: 1 });
    expect(result.score.safetyMetrics.writeOverwriteCount).toBe(1);
    expect(result.score.behaviorFindings.join('\n')).toContain('bash used for file read/search/list command');
  });

  it('fails correctness when unexpected files change', () => {
    const task = makeTask();
    const before: FileSnapshot = {
      files: [{ path: 'src/app.txt', hash: 'old', size: 3 }],
    };
    const after: FileSnapshot = {
      files: [
        { path: 'src/app.txt', hash: 'new', size: 3 },
        { path: 'src/side-effect.txt', hash: 'side', size: 4 },
      ],
    };
    const trace: StudentAgentEvalTrace = {
      taskId: task.id,
      mode: 'direct',
      instruction: 'test',
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(1).toISOString(),
      durationMs: 1,
      status: 'success',
      finalOutput: '',
      toolCalls: [],
    };
    const verifier: VerifierResult = {
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 1,
      correctnessScore: 1,
      rewardSource: 'exit_code',
    };

    const result = scoreEvalRun({ task, trace, verifier, before, after });

    expect(result.score.correctnessScore).toBe(0);
    expect(result.score.safetyMetrics.unexpectedChangedFiles).toEqual(['src/side-effect.txt']);
    expect(result.score.behaviorFindings.join('\n')).toContain('unexpected changed file(s): src/side-effect.txt');
  });

  it('records confirmation and plan-only behavior findings for non-interactive eval traces', () => {
    const task = makeTask();
    const snapshot: FileSnapshot = {
      files: [{ path: 'src/app.txt', hash: 'old', size: 3 }],
    };
    const verifier: VerifierResult = {
      exitCode: 1,
      stdout: '',
      stderr: '',
      durationMs: 1,
      correctnessScore: 0,
      rewardSource: 'exit_code',
    };

    const asked = scoreEvalRun({
      task,
      before: snapshot,
      after: snapshot,
      verifier,
      trace: traceWithOutput('Should I proceed with editing src/app.txt?'),
    });
    expect(asked.score.behaviorFindings).toContain('asked user for confirmation before first tool call');

    const planned = scoreEvalRun({
      task,
      before: snapshot,
      after: snapshot,
      verifier,
      trace: traceWithOutput('Plan: first, I will inspect the file. Next, I will edit and validate.'),
    });
    expect(planned.score.behaviorFindings).toContain('stopped after planning without tool action');
  });
});

function traceWithOutput(finalOutput: string): StudentAgentEvalTrace {
  return {
    taskId: 'sample',
    mode: 'direct',
    instruction: 'test',
    startedAt: new Date(0).toISOString(),
    endedAt: new Date(1).toISOString(),
    durationMs: 1,
    status: 'success',
    finalOutput,
    toolCalls: [],
  };
}

function makeTask(): EvalTaskDefinition {
  return {
    id: 'sample',
    title: 'Sample',
    mode: 'direct',
    tags: [],
    timeoutSeconds: 60,
    expectedFiles: ['src/app.txt'],
    taskDir: '/tmp/task',
    instructionPath: '/tmp/task/instruction.md',
    environmentDir: '/tmp/task/environment',
    testScriptPath: '/tmp/task/tests/test.sh',
  };
}
