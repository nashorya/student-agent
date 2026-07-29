import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../../memory/tasks/types.js';
import { hydrateActiveTaskStatus } from '../tui-task-status.js';

describe('tui task status hydration', () => {
  it('hydrates the visible TUI task panel from the persisted active task on startup', async () => {
    const task = makeTask();
    const manager = {
      getActive: vi.fn(async () => task),
    };
    const bridge = {
      updateTaskStatus: vi.fn(),
      clearTaskStatus: vi.fn(),
    };

    await hydrateActiveTaskStatus(manager, bridge);

    expect(bridge.updateTaskStatus).toHaveBeenCalledWith(expect.objectContaining({
      name: 'AIVTuber 全栈实现',
      phaseIndex: 1,
      totalPhases: 3,
      workflowStatus: 'executing',
      state: 'idle',
    }));
    expect(bridge.clearTaskStatus).not.toHaveBeenCalled();
  });

  it('clears the visible task panel when there is no persisted active task', async () => {
    const manager = {
      getActive: vi.fn(async () => null),
    };
    const bridge = {
      updateTaskStatus: vi.fn(),
      clearTaskStatus: vi.fn(),
    };

    await hydrateActiveTaskStatus(manager, bridge);

    expect(bridge.clearTaskStatus).toHaveBeenCalled();
    expect(bridge.updateTaskStatus).not.toHaveBeenCalled();
  });
});

function makeTask(): Task {
  return {
    id: 'task_1',
    name: 'AIVTuber 全栈实现',
    active_phase_index: 1,
    phases: [
      { id: 'p1', description: 'Phase 1', status: 'completed', retry_count: 0, feedbacks: [], created_at: '2026-06-14T00:00:00.000Z' },
      { id: 'p2', description: 'Phase 2', status: 'in_progress', retry_count: 2, feedbacks: [], created_at: '2026-06-14T00:00:00.000Z' },
      { id: 'p3', description: 'Phase 3', status: 'pending', retry_count: 0, feedbacks: [], created_at: '2026-06-14T00:00:00.000Z' },
    ],
    status: 'active',
    workflow_status: 'executing',
    level: 2,
    requires_user_acceptance: true,
    requires_visual_review: false,
    verification_results: [],
    created_at: '2026-06-14T00:00:00.000Z',
    working_memory: {
      taskId: 'task_1',
      runId: 'run_1',
      goal: 'Build the app',
      hardConstraints: '',
      phase: 'executing',
      currentStep: 'Implement Phase 2',
      todos: [{ id: 'todo_1', content: 'Run dotnet test', status: 'pending', updatedAt: '2026-06-14T00:00:00.000Z' }],
      readFiles: [],
      writeFiles: [],
      recentErrors: [],
      recentSignals: [{ id: 'sig_1', kind: 'constraint', summary: 'Keep macOS stubs', severity: 'medium', createdAt: '2026-06-14T00:00:00.000Z' }],
      artifactRefs: [],
      updatedAt: '2026-06-14T00:00:00.000Z',
    },
  };
}
