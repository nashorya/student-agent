import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  analyzeSweBenchPatch,
  createSweBenchPrediction,
  createSweBenchProductionPlan,
  isEmptyAgentTrace,
  loadSweBenchInstances,
  resolveSweBenchStudentContext,
  verifyCleanInitialWorktree,
  writeSweBenchPredictionsFile,
  type SweBenchInstance,
} from '../swebench-patch-producer.js';
import { spawnSync } from 'node:child_process';

describe('SWE-bench patch producer helpers', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'swebench-patch-producer-test-'));
  });

  afterEach(async () => {
    await import('node:fs/promises').then(({ rm }) => rm(tmpDir, { recursive: true, force: true }));
  });

  it('loads SWE-bench instances from JSONL', async () => {
    const inputPath = join(tmpDir, 'instances.jsonl');
    await writeFile(inputPath, [
      JSON.stringify(instance('repo__project-1')),
      JSON.stringify(instance('repo__project-2')),
      '',
    ].join('\n'), 'utf-8');

    await expect(loadSweBenchInstances(inputPath)).resolves.toMatchObject([
      { instance_id: 'repo__project-1' },
      { instance_id: 'repo__project-2' },
    ]);
  });

  it('writes official predictions JSONL with a generated patch', async () => {
    const outputPath = join(tmpDir, 'predictions.jsonl');
    const prediction = createSweBenchPrediction({
      instance: instance('repo__project-1'),
      modelNameOrPath: 'student-agent-context-runtime',
      patch: 'diff --git a/a.py b/a.py\n',
    });

    await writeSweBenchPredictionsFile([prediction], outputPath);

    const lines = (await readFile(outputPath, 'utf-8')).trim().split('\n');
    expect(JSON.parse(lines[0])).toEqual({
      instance_id: 'repo__project-1',
      model_name_or_path: 'student-agent-context-runtime',
      model_patch: 'diff --git a/a.py b/a.py\n',
    });
  });

  it('emits an empty patch when the agent makes no changes', () => {
    expect(createSweBenchPrediction({
      instance: instance('repo__project-1'),
      modelNameOrPath: 'claude-code',
      patch: '',
    })).toEqual({
      instance_id: 'repo__project-1',
      model_name_or_path: 'claude-code',
      model_patch: '',
    });
  });

  it('creates a dry-run production plan without checking out repositories', async () => {
    const inputPath = join(tmpDir, 'instances.jsonl');
    await writeFile(inputPath, [
      JSON.stringify(instance('repo__project-1')),
      JSON.stringify(instance('repo__project-2')),
    ].join('\n'), 'utf-8');

    const plan = await createSweBenchProductionPlan({
      instancesPath: inputPath,
      agent: 'student-agent',
      outputDir: join(tmpDir, 'out'),
      limit: 1,
    });

    expect(plan).toEqual({
      outputDir: join(tmpDir, 'out'),
      predictionsPath: join(tmpDir, 'out', 'predictions.jsonl'),
      recordsPath: join(tmpDir, 'out', 'records.json'),
      studentVariant: 'context_runtime',
      instances: [{ instance_id: 'repo__project-1' }],
    });
  });

  it('seeds L1 context for the SWE context_runtime student variant', async () => {
    const memoryDir = join(tmpDir, 'memory');
    const context = await resolveSweBenchStudentContext({
      variant: 'context_runtime',
      memoryDir,
      task: {
        id: 'repo__project-1',
        title: 'repo__project-1',
        mode: 'direct',
        tags: ['swe-bench'],
        timeoutSeconds: 300,
        expectedFiles: [],
        taskDir: tmpDir,
        instructionPath: join(tmpDir, 'instruction.md'),
        environmentDir: tmpDir,
        testScriptPath: '',
      },
      instruction: 'Fix the bug.',
    });

    const prompt = await context.buildMemoryPrompt!();
    expect(context.memoryDir).toBe(memoryDir);
    expect(prompt).toContain('### taskSpec');
    expect(prompt).toContain('EVAL AUTONOMY RULE');
    expect(context.buildMemoryPrompt?.contextAssemblyTraces[0]?.layers.L1.sectionCount).toBeGreaterThan(0);
  });

  it('keeps context variant metadata out of the official prediction schema', () => {
    const prediction = createSweBenchPrediction({
      instance: instance('repo__project-1'),
      modelNameOrPath: 'student-agent-context-runtime',
      patch: 'diff --git a/a.py b/a.py\n',
    });

    expect(Object.keys(prediction).sort()).toEqual([
      'instance_id',
      'model_name_or_path',
      'model_patch',
    ]);
  });

  it('detects an empty agent trace as a failed run signal', () => {
    expect(isEmptyAgentTrace({
      taskId: 'repo__project-1',
      mode: 'direct',
      instruction: 'Fix it',
      startedAt: '2026-06-11T00:00:00.000Z',
      endedAt: '2026-06-11T00:00:01.000Z',
      durationMs: 1000,
      status: 'success',
      finalOutput: '',
      toolCalls: [],
      tokenUsage: emptyUsage(),
    })).toBe(true);
  });

  it('marks empty and suspicious SWE patches', () => {
    expect(analyzeSweBenchPatch('')).toEqual({
      patchBytes: 0,
      diffFiles: 0,
      emptyPatch: true,
      suspiciousPatch: false,
    });

    const suspiciousPatch = Array.from({ length: 101 }, (_, index) =>
      `diff --git a/file-${index}.txt b/file-${index}.txt\n`,
    ).join('');
    expect(analyzeSweBenchPatch(suspiciousPatch)).toMatchObject({
      diffFiles: 101,
      emptyPatch: false,
      suspiciousPatch: true,
    });
  });

  it('rejects dirty initial SWE worktrees before running an agent', async () => {
    const repo = join(tmpDir, 'repo');
    await import('node:fs/promises').then(({ mkdir, writeFile }) =>
      mkdir(repo).then(() => writeFile(join(repo, 'dirty.txt'), 'changed', 'utf-8')),
    );
    spawnSync('git', ['init'], { cwd: repo });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });

    await expect(verifyCleanInitialWorktree(repo)).rejects.toThrow(/not clean/u);
  });
});

function instance(instanceId: string): SweBenchInstance {
  return {
    instance_id: instanceId,
    repo: 'owner/project',
    base_commit: 'abc123',
    problem_statement: 'Fix the bug.',
  };
}

function emptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUsd: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}
