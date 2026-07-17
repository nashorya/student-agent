import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  beginEvalLearningRun,
  finalizeEvalLearningRun,
} from '../eval-learning-lifecycle.js';
import { appendSignal } from '../../memory/signals/index.js';
import { TasksManager } from '../../memory/tasks/manager.js';

describe('eval learning lifecycle', () => {
  let memoryDir: string;

  beforeEach(async () => {
    memoryDir = await mkdtemp(join(tmpdir(), 'eval-learning-lifecycle-'));
    TasksManager.resetInstance();
  });

  afterEach(async () => {
    TasksManager.resetInstance();
    await rm(memoryDir, { recursive: true, force: true });
  });

  it('finalizes archive and reflection before clearing the active task', async () => {
    const manager = TasksManager.getInstance(memoryDir);
    const task = await manager.createTask('Astropy sequence task', ['Fix the issue'], {
      workflowStatus: 'executing',
      workingMemory: {
        goal: 'Fix pytest warning handling',
        phase: 'executing',
        currentStep: 'Run targeted tests',
      },
    });
    await manager.trackFileRead(task.id, 'astropy/tests/helper.py');
    await manager.trackFileWrite(task.id, 'astropy/tests/helper.py');
    await appendSignal({
      id: 'sig_warning_failure',
      kind: 'tool_error',
      severity: 'medium',
      summary: 'pytest failed because warnings were treated as errors',
      toolName: 'bash',
      toolCallId: 'call_1',
      pattern: 'warnings treated as errors',
      createdAt: '2026-06-12T00:00:00.000Z',
    }, memoryDir);

    const ref = await beginEvalLearningRun(memoryDir);
    const summary = await finalizeEvalLearningRun({
      memoryDir,
      run: ref,
      taskDescription: 'Fix pytest warning handling',
      gitDiff: 'diff --git a/astropy/tests/helper.py b/astropy/tests/helper.py\n',
      status: 'success',
      finalSummary: 'Implemented and verified the warning fix',
      totalTaskCount: 1,
      toolCalls: [{
        id: 'call_2',
        name: 'bash',
        args: { command: 'pytest astropy/tests/helper.py' },
        startedAt: '2026-06-12T00:00:30.000Z',
        endedAt: '2026-06-12T00:01:00.000Z',
        isError: false,
        resultText: '1 passed',
      }],
      recallAudit: {
        injected_recall_ids: ['knack_6938'],
        cited_recall_ids: ['knack_6938'],
        used_recall_ids: ['knack_6938'],
        invalid_recall_ids: [],
        citation_events: [{
          message_index: 0,
          context_trace_index: 0,
          injected_ids: ['knack_6938'],
          cited_ids: ['knack_6938'],
          used_ids: ['knack_6938'],
          invalid_ids: [],
          alignment_status: 'matched',
        }],
        utilization_rate: 1,
      },
    });

    const outcome = JSON.parse(await readFile(
      join(memoryDir, 'runs', task.working_memory.runId, 'outcome.json'),
      'utf-8',
    )) as Record<string, unknown>;
    const lessons = await readFile(join(memoryDir, 'lessons.jsonl'), 'utf-8');

    expect(summary).toMatchObject({
      taskId: task.id,
      runId: task.working_memory.runId,
      lessonsExtracted: 1,
    });
    expect(outcome).toMatchObject({
      taskId: task.id,
      runId: task.working_memory.runId,
      status: 'success',
      verificationStatus: 'pending',
      recallAudit: {
        used_recall_ids: ['knack_6938'],
      },
      wmSnapshot: {
        goal: 'Fix pytest warning handling',
        readFiles: ['astropy/tests/helper.py'],
        writtenFiles: ['astropy/tests/helper.py'],
      },
    });
    expect(lessons).toContain('warnings were treated as errors');
    expect(lessons).toContain('"quality":"high"');
    expect(lessons).toContain('"successfulToolCallId":"call_2"');
    const events = await readFile(
      join(memoryDir, 'runs', task.working_memory.runId, 'events.jsonl'),
      'utf8',
    );
    expect(events).toContain('"kind":"recall_citation"');
    await expect(manager.getActive()).resolves.toBeNull();
  });
});
