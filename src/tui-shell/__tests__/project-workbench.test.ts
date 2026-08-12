import { describe, expect, it } from 'vitest';
import type { Task } from '../../memory/tasks/types.js';
import {
  formatAgentsOverlay,
  formatPlanOverlay,
  mapPhaseStatusToPlanStep,
  projectMainAgentRow,
  projectTaskToPlanSteps,
  sortAgentRowsForTree,
} from '../project-workbench.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    name: 'Demo',
    active_phase_index: 1,
    phases: [
      {
        id: 'p0',
        description: 'inspect',
        status: 'completed',
        retry_count: 0,
        feedbacks: [],
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'p1',
        description: 'implement',
        status: 'in_progress',
        retry_count: 0,
        feedbacks: [],
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'p2',
        description: 'verify',
        status: 'pending',
        retry_count: 0,
        feedbacks: [],
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    status: 'active',
    workflow_status: 'executing',
    level: 1,
    working_memory: {
      taskId: 't1',
      runId: 'r1',
      goal: 'demo',
      hardConstraints: '',
      phase: 'executing',
      currentStep: 'implement',
      todos: [],
      readFiles: [],
      writeFiles: [],
      recentErrors: [],
      recentSignals: [],
      artifactRefs: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    requires_user_acceptance: false,
    requires_visual_review: false,
    verification_results: [],
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('project-workbench', () => {
  it('maps phase statuses', () => {
    expect(mapPhaseStatusToPlanStep('completed')).toBe('done');
    expect(mapPhaseStatusToPlanStep('in_progress')).toBe('active');
    expect(mapPhaseStatusToPlanStep('pending')).toBe('todo');
    expect(mapPhaseStatusToPlanStep('blocked')).toBe('todo');
  });

  it('projects task phases to plan steps', () => {
    const steps = projectTaskToPlanSteps(makeTask());
    expect(steps).toEqual([
      { id: 'p0', title: 'inspect', status: 'done' },
      { id: 'p1', title: 'implement', status: 'active' },
      { id: 'p2', title: 'verify', status: 'todo' },
    ]);
    expect(projectTaskToPlanSteps(null)).toEqual([]);
  });

  it('projects main agent row and sorts tree children', () => {
    expect(projectMainAgentRow({ streaming: true, taskName: 'Demo' })).toMatchObject({
      id: 'main',
      status: 'running',
      summary: 'Demo',
    });
    const sorted = sortAgentRowsForTree([
      { id: 'worker', name: 'worker', status: 'running', parentId: 'main' },
      { id: 'main', name: 'main', status: 'running' },
      { id: 'research', name: 'research', status: 'done', parentId: 'main' },
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['main', 'worker', 'research']);
  });

  it('formats compact overlays', () => {
    const task = makeTask();
    const steps = projectTaskToPlanSteps(task);
    expect(formatPlanOverlay(task, steps)).toContain('Plan · Demo');
    expect(formatPlanOverlay(task, steps)).toContain('● implement');
    expect(formatAgentsOverlay([
      { id: 'main', name: 'main', status: 'running' },
      { id: 'w', name: 'worker', status: 'done', parentId: 'main' },
    ])).toContain('└─');
  });
});
