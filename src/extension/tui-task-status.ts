import type { TUIBridge } from '../tui/bridge.js';
import type { TasksManager } from '../memory/tasks/manager.js';
import type { Task } from '../memory/tasks/types.js';

export function buildTaskStatusUpdate(
  task: Task,
  state: 'running' | 'aborting' | 'idle' | 'failed',
) {
  const phase = task.phases[task.active_phase_index];
  return {
    name: task.name,
    phaseIndex: task.active_phase_index,
    totalPhases: task.phases.length,
    workflowStatus: task.workflow_status,
    level: task.level,
    goal: task.working_memory.goal,
    acceptanceCriteria: taskWorkingMemoryItems(task, 'acceptance_criterion'),
    phases: task.phases.map((p) => ({ description: p.description, status: p.status })),
    constraints: taskWorkingMemoryItems(task, 'constraint'),
    openQuestions: taskWorkingMemoryItems(task, 'open_question'),
    userPreferences: taskWorkingMemoryItems(task, 'user_preference'),
    verificationSummary: taskWorkingMemoryItems(task, 'verification_result'),
    requiresUserAcceptance: task.requires_user_acceptance,
    requiresVisualReview: task.requires_visual_review,
    retryCount: phase?.retry_count ?? 0,
    toolCallCount: 0,
    elapsedMs: 0,
    state,
  };
}

export async function hydrateActiveTaskStatus(
  manager: Pick<TasksManager, 'getActive'>,
  bridge: Pick<TUIBridge, 'updateTaskStatus' | 'clearTaskStatus'>,
): Promise<void> {
  const activeTask = await manager.getActive();
  if (!activeTask) {
    bridge.clearTaskStatus();
    return;
  }
  bridge.updateTaskStatus(buildTaskStatusUpdate(activeTask, 'idle'));
}

export function taskWorkingMemoryItems(task: Task, kind: string): string[] {
  const memory = task.working_memory;
  const artifactItems = memory.artifactRefs
    .filter((artifact) => artifact.kind === kind)
    .map((artifact) => artifact.summary);
  const signalItems = memory.recentSignals
    .filter((signal) => signal.kind === kind)
    .map((signal) => signal.summary);
  const todoItems = kind === 'acceptance_criterion'
    ? memory.todos.map((todo) => todo.content)
    : [];
  const writtenItems = kind === 'changed_file'
    ? memory.writeFiles.map((file) => file.path)
    : [];
  return [...new Set([...artifactItems, ...signalItems, ...todoItems, ...writtenItems])];
}
