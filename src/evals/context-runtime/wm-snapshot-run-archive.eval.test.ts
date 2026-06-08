import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WriteQueue } from '../../core/write-queue.js';
import { RecallRouter } from '../../memory/recall/recall-router.js';
import { JsonlMemoryStore } from '../../memory/recall/jsonl-memory-store.js';
import { RunArchiveWriter } from '../../memory/run-archive/run-archive-writer.js';
import { extractWorkingMemorySnapshot } from '../../memory/run-archive/wm-snapshot.js';
import type { TaskOutcome } from '../../memory/run-archive/types.js';
import { workingMemory } from './fixtures/working-memory.js';
import { recallRouterInput } from './fixtures/recall-query.js';

describe('Context Runtime Eval: WM Snapshot / Run Archive', () => {
  let memoryDir: string;

  beforeEach(async () => {
    memoryDir = await mkdtemp(join(tmpdir(), 'context-runtime-run-archive-'));
    WriteQueue.resetInstance();
  });

  afterEach(async () => {
    WriteQueue.resetInstance();
    await rm(memoryDir, { recursive: true, force: true });
  });

  it('finalizes a run with a working memory snapshot summary and pointer evidence', async () => {
    const writer = new RunArchiveWriter({ memoryDir });
    const wm = workingMemory();
    const snapshot = extractWorkingMemorySnapshot(wm, 'task_snapshot', 'run_snapshot');

    const outcome = await writer.finalizeRun('run_snapshot', {
      taskId: 'task_snapshot',
      status: 'success',
      finalSummary: 'Context runtime eval archived',
      wmSnapshot: snapshot,
    });

    expect(outcome.wmSnapshot).toMatchObject({
      taskId: 'task_snapshot',
      runId: 'run_snapshot',
      goal: wm.goal,
      finalStep: wm.currentStep,
      completedTodoCount: 1,
      evidenceRefs: ['runs/run_snapshot/events.jsonl', 'runs/run_snapshot/outcome.json'],
    });
    expect(outcome.wmSnapshot?.completedTodos[0]).toMatchObject({ id: 'todo_done' });
    expect(outcome.wmSnapshot?.keyFiles).toEqual(expect.arrayContaining([
      { path: 'src/evals/context-runtime/write.ts', role: 'written' },
    ]));
    expect(outcome.wmSnapshot?.createdAt).toEqual(expect.any(String));

    const persisted = JSON.parse(
      await readFile(join(memoryDir, 'runs', 'run_snapshot', 'outcome.json'), 'utf-8'),
    ) as TaskOutcome;
    expect(persisted.wmSnapshot).toEqual(outcome.wmSnapshot);
  });

  it('recalls historical snapshots while excluding the current task and run', async () => {
    const writer = new RunArchiveWriter({ memoryDir });
    const oldSnapshot = extractWorkingMemorySnapshot(workingMemory({
      taskId: 'task_old',
      runId: 'run_old',
      goal: 'Old context runtime task',
      currentStep: 'Old final step',
    }), 'task_old', 'run_old');
    const currentSnapshot = extractWorkingMemorySnapshot(workingMemory({
      taskId: 'task_current',
      runId: 'run_current',
      goal: 'Current context runtime task',
      currentStep: 'Current final step',
    }), 'task_current', 'run_current');
    await writer.finalizeRun('run_old', {
      taskId: 'task_old',
      status: 'success',
      finalSummary: 'Old run',
      wmSnapshot: oldSnapshot,
    });
    await writer.finalizeRun('run_current', {
      taskId: 'task_current',
      status: 'success',
      finalSummary: 'Current run',
      wmSnapshot: currentSnapshot,
    });

    const bundle = await new RecallRouter(new JsonlMemoryStore({ memoryDir, readOnly: true })).recall(recallRouterInput({
      currentTaskId: 'task_current',
      currentRunId: 'run_current',
      excludeTaskIds: ['task_current'],
      excludeRunIds: ['run_current'],
      tier: 'standard',
    }));

    expect(bundle.historicalTaskSnapshots.map((item) => item.id)).toEqual(['wm_snapshot:run_old']);
    expect(bundle.historicalTaskSnapshots[0].summary).toContain('Old context runtime task');
    expect(bundle.historicalTaskSnapshots[0].summary).not.toContain('Current context runtime task');
  });
});
