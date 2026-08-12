import type { PhaseStatus, Task } from '../memory/tasks/types.js';
import type { ShellAgentRow, ShellPlanStep } from './state.js';

export function mapPhaseStatusToPlanStep(status: PhaseStatus): ShellPlanStep['status'] {
  switch (status) {
    case 'completed':
    case 'skipped':
      return 'done';
    case 'in_progress':
      return 'active';
    case 'pending':
    case 'blocked':
    default:
      return 'todo';
  }
}

/** Project TasksManager Task.phases → Plan sidebar rows. */
export function projectTaskToPlanSteps(task: Task | null | undefined): ShellPlanStep[] {
  if (!task) return [];
  return task.phases.map((phase, index) => {
    let status = mapPhaseStatusToPlanStep(phase.status);
    // Prefer explicit in_progress; otherwise highlight active_phase_index when executing.
    if (
      status === 'todo'
      && index === task.active_phase_index
      && task.status === 'active'
      && (task.workflow_status === 'executing' || task.workflow_status === 'planning')
    ) {
      status = 'active';
    }
    return {
      id: phase.id,
      title: phase.description,
      status,
    };
  });
}

export function projectMainAgentRow(options: {
  streaming: boolean;
  taskName?: string | null;
  error?: boolean;
}): ShellAgentRow {
  return {
    id: 'main',
    name: 'main',
    status: options.error ? 'failed' : options.streaming ? 'running' : 'done',
    summary: options.taskName?.trim() || undefined,
  };
}

/** Flat→tree: children listed under parents when parentId is set. */
export function sortAgentRowsForTree(rows: ShellAgentRow[]): ShellAgentRow[] {
  const roots = rows.filter((row) => !row.parentId);
  const children = rows.filter((row) => row.parentId);
  const ordered: ShellAgentRow[] = [];
  for (const root of roots) {
    ordered.push(root);
    ordered.push(...children.filter((child) => child.parentId === root.id));
  }
  // Orphans (parent missing) append at end
  for (const child of children) {
    if (!ordered.includes(child)) ordered.push(child);
  }
  return ordered;
}

export function formatPlanOverlay(task: Task | null | undefined, steps: ShellPlanStep[]): string {
  if (!task || steps.length === 0) {
    return 'Plan\n(no active task)';
  }
  const done = steps.filter((s) => s.status === 'done').length;
  const lines = [
    `Plan · ${task.name}`,
    `workflow: ${task.workflow_status} · ${done}/${steps.length}`,
    ...steps.map((step) => {
      const mark = step.status === 'done' ? '✓' : step.status === 'active' ? '●' : '○';
      return `${mark} ${step.title}`;
    }),
  ];
  return lines.join('\n');
}

export function formatAgentsOverlay(agents: ShellAgentRow[]): string {
  if (agents.length === 0) return 'Subagents\n(none)';
  const sorted = sortAgentRowsForTree(agents);
  return [
    'Subagents',
    ...sorted.map((agent) => {
      const mark =
        agent.status === 'done' ? '✓' :
        agent.status === 'failed' ? '✗' :
        '●';
      const indent = agent.parentId ? '  └─ ' : '';
      const summary = agent.summary ? ` — ${agent.summary}` : '';
      return `${indent}${mark} ${agent.name}${summary}`;
    }),
  ].join('\n');
}
