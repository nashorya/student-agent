import { TasksManager } from '../memory/tasks/manager.js';
import type { ShellHandle } from './shell.js';
import {
  projectMainAgentRow,
  projectTaskToPlanSteps,
} from './project-workbench.js';

export interface SyncWorkbenchOptions {
  shell: ShellHandle;
  memoryDir: string;
  streaming?: boolean;
  taskError?: boolean;
  /** Override task name shown on the main agent row. */
  taskName?: string | null;
}

/**
 * Push TasksManager + main-agent status into Plan/Agents panels.
 * Call after task mutations and at the start/end of each TUI turn.
 */
export async function syncWorkbenchProjection(options: SyncWorkbenchOptions): Promise<void> {
  const task = await TasksManager.getInstance(options.memoryDir).getActive();
  const steps = projectTaskToPlanSteps(task);
  options.shell.setPlanSteps(steps);

  const taskName = options.taskName ?? task?.name ?? null;
  options.shell.setAgents([
    projectMainAgentRow({
      streaming: Boolean(options.streaming),
      taskName,
      error: Boolean(options.taskError),
    }),
  ]);

  if (task) {
    options.shell.bridge.updateTaskStatus({
      state: task.workflow_status,
      name: task.name,
      phaseIndex: task.active_phase_index,
      totalPhases: task.phases.length,
    });
  } else {
    options.shell.bridge.clearTaskStatus();
  }
}
