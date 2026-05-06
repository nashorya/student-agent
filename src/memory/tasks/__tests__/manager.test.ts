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
    expect(task.status).toBe('active');
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
  });

  it('renames active task', async () => {
    const task = await mgr.createTask('旧名字', ['p1']);
    await mgr.renameTask(task.id, '新名字');
    const updated = await mgr.getActive();
    expect(updated!.name).toBe('新名字');
  });

  it('returns null when no active task', async () => {
    expect(await mgr.getActive()).toBeNull();
  });
});
