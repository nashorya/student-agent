import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TasksManager } from '../manager.js';

describe('TasksManager', () => {
  let mgr: TasksManager;

  beforeEach(() => {
    TasksManager.resetInstance();
    mgr = TasksManager.getInstance(':memory:');
  });

  it('creates a task with initial phase', async () => {
    const task = await mgr.createTask('修改首页', ['调整颜色', '验证渲染']);
    expect(task.name).toBe('修改首页');
    expect(task.phases).toHaveLength(2);
    expect(task.active_phase_index).toBe(0);
    expect(task.phases.map((phase) => phase.status)).toEqual(['in_progress', 'pending']);
    expect(task.status).toBe('active');
    expect(task.workflow_status).toBe('awaiting_plan_approval');
  });

  it('increments retry count for active phase', async () => {
    const task = await mgr.createTask('测试任务', ['Phase 1'], { workflowStatus: 'executing' });
    await mgr.incrementRetry(task.id, 'css 不渲染');
    const updated = await mgr.getActive();
    expect(updated!.phases[0].retry_count).toBe(1);
    expect(updated!.phases[0].feedbacks).toEqual(['css 不渲染']);
  });

  it('advances to next phase', async () => {
    const task = await mgr.createTask('测试任务', ['Phase 1', 'Phase 2']);
    await mgr.completePhase(task.id);
    const updated = await mgr.getActive();
    expect(updated!.active_phase_index).toBe(1);
    expect(updated!.phases[0].status).toBe('completed');
    expect(updated!.phases[1].status).toBe('in_progress');
    expect(updated!.workflow_status).toBe('executing');
  });

  it('completes ordinary tasks after the final phase', async () => {
    const task = await mgr.createTask('测试任务', ['Phase 1', 'Phase 2']);
    await mgr.completePhase(task.id);
    await mgr.completePhase(task.id);

    const completed = await mgr.getTask(task.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.workflow_status).toBe('completed');
    expect(completed?.completed_at).toBeTruthy();
    expect(await mgr.getActive()).toBeNull();
  });

  it('enters review after the final phase when acceptance is required', async () => {
    const task = await mgr.createTask('视觉任务', ['改 UI', '验证'], {
      requiresUserAcceptance: true,
      requiresVisualReview: true,
    });

    await mgr.completePhase(task.id);
    await mgr.completePhase(task.id);

    const active = await mgr.getActive();
    expect(active?.status).toBe('active');
    expect(active?.workflow_status).toBe('visual_review');
  });

  it('accepts and completes a review task', async () => {
    const task = await mgr.createTask('视觉任务', ['改 UI'], {
      workflowStatus: 'executing',
      requiresUserAcceptance: true,
    });
    await mgr.completePhase(task.id);
    await mgr.acceptTask(task.id, 'looks good');
    await mgr.completeTask(task.id, 'done');

    const completed = await mgr.getTask(task.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.workflow_status).toBe('completed');
    expect(completed?.accepted_at).toBeTruthy();
    expect(await mgr.getActive()).toBeNull();
  });

  it('records revision feedback without failing the task', async () => {
    const task = await mgr.createTask('视觉任务', ['改 UI'], {
      workflowStatus: 'user_review',
      requiresUserAcceptance: true,
    });
    await mgr.requestRevision(task.id, '按钮太挤');

    const active = await mgr.getActive();
    expect(active?.status).toBe('active');
    expect(active?.workflow_status).toBe('revision_requested');
  });

  it('logs and ignores invalid workflow status transitions', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const task = await mgr.createTask('测试任务', ['Phase 1']);

    await mgr.updateWorkflowStatus(task.id, 'retrying');

    const active = await mgr.getActive();
    expect(active?.workflow_status).toBe('awaiting_plan_approval');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Invalid workflow transition'));
    warn.mockRestore();
  });

  it('keeps normal manager workflow transitions working end-to-end', async () => {
    const task = await mgr.createTask('测试任务', ['Phase 1'], {
      workflowStatus: 'planning',
      requiresUserAcceptance: true,
    });

    await mgr.updateWorkflowStatus(task.id, 'executing');
    await mgr.incrementRetry(task.id, '需要重试');
    await mgr.updateWorkflowStatus(task.id, 'executing');
    await mgr.completePhase(task.id);
    await mgr.acceptTask(task.id, 'looks good');
    await mgr.completeTask(task.id, 'done');

    const completed = await mgr.getTask(task.id);
    expect(completed?.workflow_status).toBe('completed');
    expect(completed?.status).toBe('completed');
    expect(await mgr.getActive()).toBeNull();
  });

  it('records verification results into task memory', async () => {
    const task = await mgr.createTask('测试任务', ['Phase 1']);
    await mgr.recordVerification(task.id, {
      kind: 'build',
      status: 'passed',
      summary: 'npm run build passed',
      command: 'npm run build',
    });

    const active = await mgr.getActive();
    expect(active?.verification_results[0]).toMatchObject({
      kind: 'build',
      status: 'passed',
      summary: 'npm run build passed',
    });
    expect(active?.working_memory.verification_results).toContain('passed: npm run build passed');
  });

  it('tracks read files with deduplication', async () => {
    const task = await mgr.createTask('测试任务', ['Phase 1']);

    await mgr.trackFileRead(task.id, 'src/App.tsx');
    await mgr.trackFileRead(task.id, 'src/App.tsx');
    await mgr.trackFileRead(task.id, 'src/main.ts');

    const active = await mgr.getActive();
    expect(active?.working_memory.read_files).toEqual(['src/App.tsx', 'src/main.ts']);
  });

  it('tracks written files with deduplication', async () => {
    const task = await mgr.createTask('测试任务', ['Phase 1']);

    await mgr.trackFileWrite(task.id, 'src/App.tsx');
    await mgr.trackFileWrite(task.id, 'src/App.tsx');
    await mgr.trackFileWrite(task.id, 'src/styles.css');

    const active = await mgr.getActive();
    expect(active?.working_memory.written_files).toEqual(['src/App.tsx', 'src/styles.css']);
  });

  it('tracks recent errors newest last and caps at 10', async () => {
    const task = await mgr.createTask('测试任务', ['Phase 1']);

    for (let i = 1; i <= 12; i++) {
      await mgr.trackError(task.id, `error ${i}`);
    }

    const active = await mgr.getActive();
    expect(active?.working_memory.recent_errors).toEqual([
      'error 3',
      'error 4',
      'error 5',
      'error 6',
      'error 7',
      'error 8',
      'error 9',
      'error 10',
      'error 11',
      'error 12',
    ]);
  });

  it('defaults missing file and error tracking fields to empty arrays', async () => {
    const task = await mgr.createTask('测试任务', ['Phase 1'], {
      workingMemory: {
        goal: '兼容旧 tasks.json',
      },
    });

    expect(task.working_memory.read_files).toEqual([]);
    expect(task.working_memory.written_files).toEqual([]);
    expect(task.working_memory.recent_errors).toEqual([]);
  });

  it('merges file and error tracking fields with existing working memory', async () => {
    const task = await mgr.createTask('测试任务', ['Phase 1'], {
      workingMemory: {
        read_files: ['src/old-read.ts'],
        written_files: ['src/old-write.ts'],
        recent_errors: ['old error'],
      },
    });

    await mgr.updateWorkingMemory(task.id, {
      read_files: ['src/old-read.ts', 'src/new-read.ts'],
      written_files: ['src/old-write.ts', 'src/new-write.ts'],
      recent_errors: ['new error'],
    });

    const active = await mgr.getActive();
    expect(active?.working_memory.read_files).toEqual(['src/old-read.ts', 'src/new-read.ts']);
    expect(active?.working_memory.written_files).toEqual(['src/old-write.ts', 'src/new-write.ts']);
    expect(active?.working_memory.recent_errors).toEqual(['old error', 'new error']);
  });

  it('renames active task', async () => {
    const task = await mgr.createTask('旧名字', ['p1']);
    await mgr.renameTask(task.id, '新名字');
    const updated = await mgr.getActive();
    expect(updated!.name).toBe('新名字');
  });

  it('cancels active task', async () => {
    const task = await mgr.createTask('坏计划', ['重复', '重复']);
    const cancelled = await mgr.cancelActiveTask();

    expect(cancelled?.id).toBe(task.id);
    expect(cancelled?.status).toBe('cancelled');
    expect(await mgr.getActive()).toBeNull();
  });

  it('returns null when no active task', async () => {
    expect(await mgr.getActive()).toBeNull();
  });
});
