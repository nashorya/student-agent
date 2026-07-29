import { describe, expect, it } from 'vitest';
import { classifyPlanApprovalInput } from '../plan-approval-input.js';
import { createPlanSnapshot } from '../plan-revision-detector.js';
import type { Task, TaskWorkflowStatus } from '../../../memory/tasks/types.js';

describe('classifyPlanApprovalInput', () => {
  it('approves any ordinary reply while a plan is awaiting approval', () => {
    const task = makeTask('awaiting_plan_approval');
    const snapshot = createPlanSnapshot(task);

    expect(classifyPlanApprovalInput('好，请你开始实现', task, snapshot)).toMatchObject({
      type: 'approve',
    });
  });

  it('approves ordinary replies after restart when the in-memory plan snapshot is gone', () => {
    const task = makeTask('awaiting_plan_approval');

    expect(classifyPlanApprovalInput('开始', task, null)).toMatchObject({
      type: 'approve',
    });
  });

  it('routes plan changes to revision instead of approval', () => {
    const task = makeTask('awaiting_plan_approval');
    const snapshot = createPlanSnapshot(task);

    expect(classifyPlanApprovalInput('先做测试，再改实现', task, snapshot)).toMatchObject({
      type: 'revise',
      revision: expect.objectContaining({ diffType: 'sequencing_change' }),
    });
  });

  it('does not handle input outside the awaiting-plan-approval state', () => {
    const task = makeTask('executing');
    const snapshot = createPlanSnapshot(task);

    expect(classifyPlanApprovalInput('好，请你开始实现', task, snapshot)).toBeNull();
  });
});

function makeTask(workflowStatus: TaskWorkflowStatus): Task {
  return {
    id: 'task_1',
    name: 'TUI 修复',
    active_phase_index: 0,
    status: 'active',
    workflow_status: workflowStatus,
    level: 3,
    requires_user_acceptance: true,
    requires_visual_review: false,
    verification_results: [],
    created_at: '2026-06-14T00:00:00.000Z',
    working_memory: {
      taskId: 'task_1',
      runId: 'run_1',
      goal: '修复 TUI',
      hardConstraints: '',
      phase: 'planning',
      currentStep: '等待确认计划',
      todos: [],
      readFiles: [],
      writeFiles: [],
      recentErrors: [],
      recentSignals: [],
      artifactRefs: [],
      updatedAt: '2026-06-14T00:00:00.000Z',
    },
    phases: [
      {
        id: 'phase_1',
        description: '修输入队列',
        status: 'in_progress',
        retry_count: 0,
        feedbacks: [],
        created_at: '2026-06-14T00:00:00.000Z',
      },
    ],
  };
}
