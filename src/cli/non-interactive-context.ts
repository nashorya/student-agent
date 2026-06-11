import { TasksManager } from '../memory/tasks/manager.js';
import type { Task } from '../memory/tasks/types.js';

const MAX_TASK_NAME_CHARS = 200;
const NON_INTERACTIVE_STEP = 'Execute non-interactive instruction';

export async function beginNonInteractiveContextTask(options: {
  memoryDir: string;
  instruction: string;
}): Promise<Task> {
  TasksManager.resetInstance();
  const manager = TasksManager.getInstance(options.memoryDir);
  const now = new Date().toISOString();
  const taskName = compactTaskName(options.instruction);
  return manager.createTask(taskName, [NON_INTERACTIVE_STEP], {
    workflowStatus: 'executing',
    workingMemory: {
      goal: taskName,
      hardConstraints: options.instruction,
      phase: 'executing',
      currentStep: NON_INTERACTIVE_STEP,
      todos: [{
        id: `todo_noninteractive_${Date.now()}`,
        content: taskName,
        status: 'in_progress',
        updatedAt: now,
      }],
      recentErrors: [],
      recentSignals: [],
      readFiles: [],
      writeFiles: [],
      artifactRefs: [],
      updatedAt: now,
    },
  });
}

export async function finishNonInteractiveContextTask(options: {
  memoryDir: string;
  taskId: string;
  exitCode: number;
  errorMessage?: string;
}): Promise<void> {
  const manager = TasksManager.getInstance(options.memoryDir);
  if (options.exitCode === 0) {
    await manager.completePhase(options.taskId);
    return;
  }
  await manager.blockTask(
    options.taskId,
    options.errorMessage || `Non-interactive run exited with code ${options.exitCode}.`,
  );
}

function compactTaskName(instruction: string): string {
  const compact = instruction.replace(/\s+/gu, ' ').trim();
  if (compact.length <= MAX_TASK_NAME_CHARS) return compact;
  return compact.slice(0, MAX_TASK_NAME_CHARS - 3).trimEnd() + '...';
}
