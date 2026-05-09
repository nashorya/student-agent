import { describe, expect, it } from 'vitest';
import { createPlanSnapshot, detectPlanRevisionIntent } from '../plan-revision-detector.js';
import type { Task } from '../../../memory/tasks/types.js';

describe('detectPlanRevisionIntent', () => {
  const task = makeTask();
  const snapshot = createPlanSnapshot(task);

  it('detects priority changes', () => {
    expect(detectPlanRevisionIntent('优先修输入可靠性', task, snapshot)).toMatchObject({
      diffType: 'priority_change',
    });
  });

  it('detects sequencing changes', () => {
    expect(detectPlanRevisionIntent('先修输入可靠性，再处理架构补全', task, snapshot)).toMatchObject({
      diffType: 'sequencing_change',
    });
  });

  it('detects scope reductions', () => {
    expect(detectPlanRevisionIntent('这轮只做低风险修复，不要重构 TUI', task, snapshot)).toMatchObject({
      diffType: 'risk_tolerance_change',
    });
  });

  it('detects acceptance criteria changes', () => {
    expect(detectPlanRevisionIntent('验收标准改成必须有单测覆盖', task, snapshot)).toMatchObject({
      diffType: 'acceptance_criteria_change',
    });
  });

  it('ignores normal feedback without plan changes', () => {
    expect(detectPlanRevisionIntent('报错了', task, snapshot)).toBeNull();
    expect(detectPlanRevisionIntent('继续', task, snapshot)).toBeNull();
  });

  it('requires active task and matching snapshot', () => {
    expect(detectPlanRevisionIntent('先做测试', null, snapshot)).toBeNull();
    expect(detectPlanRevisionIntent('先做测试', task, null)).toBeNull();
    expect(detectPlanRevisionIntent('先做测试', task, { ...snapshot, taskId: 'other' })).toBeNull();
  });
});

function makeTask(): Task {
  return {
    id: 'task_1',
    name: 'TUI 修复',
    active_phase_index: 0,
    status: 'active',
    created_at: '2026-05-09T00:00:00.000Z',
    phases: [
      {
        id: 'phase_1',
        description: '修输入队列',
        status: 'in_progress',
        retry_count: 0,
        feedbacks: [],
        created_at: '2026-05-09T00:00:00.000Z',
      },
    ],
  };
}
