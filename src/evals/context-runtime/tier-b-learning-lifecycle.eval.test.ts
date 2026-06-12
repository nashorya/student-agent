import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createContextRuntimeBuildMemoryPrompt,
  seedContextRuntimeEvalMemory,
} from '../context-runtime-runner.js';
import {
  beginEvalLearningRun,
  finalizeEvalLearningRun,
} from '../eval-learning-lifecycle.js';
import { TasksManager } from '../../memory/tasks/manager.js';
import type { EvalTaskDefinition } from '../types.js';

describe('Tier B learning lifecycle', () => {
  let memoryDir: string;

  beforeEach(async () => {
    memoryDir = await mkdtemp(join(tmpdir(), 'tier-b-learning-'));
    TasksManager.resetInstance();
  });

  afterEach(async () => {
    TasksManager.resetInstance();
    await rm(memoryDir, { recursive: true, force: true });
  });

  it('recalls the previous task snapshot in the next task trace', async () => {
    const first = task('astropy__astropy-6938');
    await seedContextRuntimeEvalMemory({
      memoryDir,
      task: first,
      instruction: 'Fix D exponent formatting.',
    });
    const firstRun = await beginEvalLearningRun(memoryDir);
    const manager = TasksManager.getInstance(memoryDir);
    await manager.trackFileWrite(firstRun.taskId, 'astropy/io/fits/fitsrec.py');
    await finalizeEvalLearningRun({
      memoryDir,
      run: firstRun,
      taskDescription: 'Fix D exponent formatting.',
      gitDiff: 'diff --git a/astropy/io/fits/fitsrec.py b/astropy/io/fits/fitsrec.py\n',
      status: 'success',
      finalSummary: 'Assigned the replaced chararray result.',
      totalTaskCount: 1,
    });

    const second = task('astropy__astropy-7746');
    await seedContextRuntimeEvalMemory({
      memoryDir,
      task: second,
      instruction: 'Handle empty WCS coordinate arrays.',
    });
    const prompt = createContextRuntimeBuildMemoryPrompt('context_runtime', memoryDir);
    await prompt?.();

    expect(prompt?.contextAssemblyTraces[0]?.recall?.items).toContainEqual(expect.objectContaining({
      id: `wm_snapshot:${firstRun.runId}`,
      kind: 'run_archive_ref',
      summary: expect.stringContaining('SWE-bench astropy__astropy-6938'),
    }));
  });
});

function task(id: string): EvalTaskDefinition {
  return {
    id,
    title: `SWE-bench ${id}`,
    mode: 'direct',
    tags: ['swebench'],
    timeoutSeconds: 300,
    expectedFiles: [],
    taskDir: '/tmp',
    instructionPath: '/tmp/instruction.md',
    environmentDir: '/tmp',
    testScriptPath: '',
  };
}
