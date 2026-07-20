import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  analyzeSweBenchPatch,
  buildSweBenchProducerMetadata,
  createSweBenchPrediction,
  createSweBenchProductionPlan,
  isEmptyAgentTrace,
  loadSweBenchInstances,
  resolveSweBenchStudentMemoryDir,
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
      metadataPath: join(tmpDir, 'out', 'metadata.json'),
      studentVariant: 'context_runtime',
      studentLearningLifecycle: false,
      studentLearningTaskOffset: 0,
      instances: [{ instance_id: 'repo__project-1' }],
    });
  });

  it('uses one configured memory directory across a learning sequence', () => {
    expect(resolveSweBenchStudentMemoryDir({
      workRoot: join(tmpDir, 'work'),
      instanceId: 'astropy__astropy-6938',
      studentMemoryDir: join(tmpDir, 'shared-memory'),
    })).toBe(join(tmpDir, 'shared-memory'));

    expect(resolveSweBenchStudentMemoryDir({
      workRoot: join(tmpDir, 'work'),
      instanceId: 'astropy__astropy-7746',
    })).toBe(join(tmpDir, 'work', '.student-agent-memory', 'astropy__astropy-7746'));
  });

  it('makes the shared memory and learning lifecycle explicit in dry-run plans', async () => {
    const inputPath = join(tmpDir, 'instances.jsonl');
    await writeFile(inputPath, JSON.stringify(instance('astropy__astropy-6938')), 'utf-8');
    const memoryDir = join(tmpDir, 'shared-memory');

    const plan = await createSweBenchProductionPlan({
      instancesPath: inputPath,
      agent: 'student-agent',
      outputDir: join(tmpDir, 'out'),
      studentMemoryDir: memoryDir,
      studentLearningLifecycle: true,
      studentLearningTaskOffset: 2,
    });

    expect(plan).toMatchObject({
      studentMemoryDir: memoryDir,
      studentLearningLifecycle: true,
      studentLearningTaskOffset: 2,
    });
  });

  it('builds commit and route metadata without exposing credentials', () => {
    const metadata = buildSweBenchProducerMetadata({
      commit: 'abc123',
      agent: 'student-agent',
      modelNameOrPath: 'anthropic/claude-sonnet-4.6',
      studentVariant: 'context_runtime',
      studentInjectionMode: 'recall',
      studentMemoryDir: '/tmp/tier-b-memory',
      studentLearningLifecycle: true,
      studentLearningTaskOffset: 0,
      records: [],
      env: {
        HTTPS_PROXY: 'http://127.0.0.1:6518',
        OPENROUTER_API_KEY: 'must-not-appear',
      },
    });

    expect(metadata).toMatchObject({
      commit: 'abc123',
      agent: 'student-agent',
      modelNameOrPath: 'anthropic/claude-sonnet-4.6',
      studentVariant: 'context_runtime',
      studentInjectionMode: 'recall',
      studentMemoryDir: '/tmp/tier-b-memory',
      studentLearningLifecycle: true,
      networkRoute: 'proxy:127.0.0.1:6518',
    });
    expect(JSON.stringify(metadata)).not.toContain('must-not-appear');
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

  it('keeps the learning task active when injection is off', async () => {
    const memoryDir = join(tmpDir, 'off-memory');
    const context = await resolveSweBenchStudentContext({
      variant: 'plain',
      injectionMode: 'off',
      memoryDir,
      task: sweTask(tmpDir),
      instruction: 'Fix the bug.',
    });

    expect(await context.buildMemoryPrompt()).not.toContain('### taskSpec');
    expect(await import('../../memory/tasks/manager.js').then(({ TasksManager }) =>
      TasksManager.getInstance(memoryDir).getActive())).not.toBeNull();
  });

  it('renders every accumulated lesson in the full-resident arm', async () => {
    const memoryDir = join(tmpDir, 'full-memory');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(memoryDir, { recursive: true }));
    await writeFile(join(memoryDir, 'lessons.jsonl'), [
      JSON.stringify({ id: 'lesson_1', lesson: 'audit generated imports before returning a migration reference' }),
      JSON.stringify({ id: 'lesson_2', lesson: 'preserve the complete qualified name' }),
      '',
    ].join('\n'), 'utf8');
    const context = await resolveSweBenchStudentContext({
      variant: 'context_runtime',
      injectionMode: 'full',
      memoryDir,
      task: sweTask(tmpDir),
      instruction: 'Fix the bug.',
    });

    const prompt = await context.buildMemoryPrompt();
    expect(prompt).toContain('[resident:lesson_1] audit generated imports before returning a migration reference');
    expect(prompt).toContain('[resident:lesson_2] preserve the complete qualified name');
    expect(prompt.indexOf('[resident:lesson_1]')).toBeGreaterThan(prompt.indexOf('cache_prefix_breakpoint'));
    expect(context.buildMemoryPrompt.contextAssemblyTraces?.[0]?.sections)
      .toContainEqual(expect.objectContaining({ id: 'fullResidentLessons' }));
    expect(context.buildMemoryPrompt.contextAssemblyTraces?.[0]?.recall?.items ?? []).toEqual([]);
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

function sweTask(root: string) {
  return {
    id: 'repo__project-1',
    title: 'repo__project-1',
    mode: 'direct' as const,
    tags: ['swe-bench'],
    timeoutSeconds: 300,
    expectedFiles: [],
    taskDir: root,
    instructionPath: join(root, 'instruction.md'),
    environmentDir: root,
    testScriptPath: '',
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
