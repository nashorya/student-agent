import { describe, it, expect, beforeEach } from 'vitest';
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
    const task = await mgr.createTask('测试任务', ['Phase 1']);
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
    const task = await mgr.createTask('视觉任务', ['改 UI'], { requiresUserAcceptance: true });
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
    const task = await mgr.createTask('视觉任务', ['改 UI'], { requiresUserAcceptance: true });
    await mgr.requestRevision(task.id, '按钮太挤');

    const active = await mgr.getActive();
    expect(active?.status).toBe('active');
    expect(active?.workflow_status).toBe('revision_requested');
    expect(active?.working_memory.design_feedback).toContain('按钮太挤');
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
