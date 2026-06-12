import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  beginNonInteractiveContextTask,
  finishNonInteractiveContextTask,
} from '../non-interactive-context.js';
import { TasksManager } from '../../memory/tasks/manager.js';

describe('non-interactive context task lifecycle', () => {
  let memoryDir: string | undefined;

  afterEach(async () => {
    TasksManager.resetInstance();
    if (memoryDir) await rm(memoryDir, { recursive: true, force: true });
  });

  it('creates an executing active task before runtime construction', async () => {
    memoryDir = await mkdtemp(join(tmpdir(), 'noninteractive-context-'));

    const task = await beginNonInteractiveContextTask({
      memoryDir,
      instruction: `${'Long benchmark instruction. '.repeat(30)}finish`,
    });
    const active = await TasksManager.getInstance(memoryDir).getActive();

    expect(active?.id).toBe(task.id);
    expect(active?.workflow_status).toBe('executing');
    expect(active?.working_memory.phase).toBe('executing');
    expect(active?.working_memory.currentStep).toBe('Execute non-interactive instruction');
    expect(active?.name.length).toBeLessThanOrEqual(200);
  });

  it('preserves the full instruction as hard constraints even when the task name is compacted', async () => {
    memoryDir = await mkdtemp(join(tmpdir(), 'noninteractive-context-'));
    const instruction = [
      'Ensure that main.tex compiles.',
      'Only edit input.tex.',
      'Every changed word must be replaced with a synonym from the same synonyms.txt family.',
      `${'extra context '.repeat(40)}tail constraint must survive`,
    ].join(' ');

    const task = await beginNonInteractiveContextTask({
      memoryDir,
      instruction,
    });

    expect(task.name.length).toBeLessThanOrEqual(200);
    expect(task.working_memory.hardConstraints).toBe(instruction);
    expect(task.working_memory.hardConstraints).toContain('tail constraint must survive');
  });

  it('completes successful tasks and blocks failed tasks', async () => {
    memoryDir = await mkdtemp(join(tmpdir(), 'noninteractive-context-'));
    const succeeded = await beginNonInteractiveContextTask({
      memoryDir,
      instruction: 'Complete the benchmark task.',
    });
    await finishNonInteractiveContextTask({
      memoryDir,
      taskId: succeeded.id,
      exitCode: 0,
    });
    expect(await TasksManager.getInstance(memoryDir).getActive()).toBeNull();

    TasksManager.resetInstance();
    const failed = await beginNonInteractiveContextTask({
      memoryDir,
      instruction: 'Fail the benchmark task.',
    });
    await finishNonInteractiveContextTask({
      memoryDir,
      taskId: failed.id,
      exitCode: 1,
      errorMessage: 'model failed',
    });
    const file = JSON.parse(await readFile(join(memoryDir, 'tasks.json'), 'utf8')) as {
      tasks: Array<{ id: string; workflow_status: string }>;
    };
    expect(file.tasks.find((task) => task.id === failed.id)?.workflow_status).toBe('blocked');
  });
});
