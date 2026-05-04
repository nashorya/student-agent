export interface SubAgentTask {
  id: string;
  title: string;
  prompt: string;
  writeIntent: string[];
}

export interface TaskPlan {
  id: string;
  originalTask: string;
  tasks: SubAgentTask[];
  conflicts: WriteIntentConflict[];
}

export interface WriteIntentConflict {
  firstTaskId: string;
  secondTaskId: string;
  path: string;
}

export interface PlanGenerator {
  generate(task: string): Promise<SubAgentTask[]>;
}

export class Planner {
  constructor(private readonly generator: PlanGenerator = new HeuristicPlanGenerator()) {}

  async plan(task: string): Promise<TaskPlan> {
    const tasks = await this.generator.generate(task);
    return {
      id: `plan_${Date.now()}`,
      originalTask: task,
      tasks,
      conflicts: detectWriteIntentConflicts(tasks),
    };
  }
}

export function detectWriteIntentConflicts(tasks: SubAgentTask[]): WriteIntentConflict[] {
  const conflicts: WriteIntentConflict[] = [];

  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const overlap = findOverlappingPaths(tasks[i].writeIntent, tasks[j].writeIntent);
      for (const path of overlap) {
        conflicts.push({
          firstTaskId: tasks[i].id,
          secondTaskId: tasks[j].id,
          path,
        });
      }
    }
  }

  return conflicts;
}

export function normalizeWritePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

function findOverlappingPaths(first: string[], second: string[]): string[] {
  const firstPaths = first.map(normalizeWritePath).filter(Boolean);
  const secondPaths = second.map(normalizeWritePath).filter(Boolean);
  const overlap: string[] = [];

  for (const a of firstPaths) {
    for (const b of secondPaths) {
      if (pathsOverlap(a, b)) {
        overlap.push(a.length <= b.length ? a : b);
      }
    }
  }

  return [...new Set(overlap)];
}

function pathsOverlap(first: string, second: string): boolean {
  return (
    first === second
    || first.startsWith(`${second}/`)
    || second.startsWith(`${first}/`)
  );
}

class HeuristicPlanGenerator implements PlanGenerator {
  async generate(task: string): Promise<SubAgentTask[]> {
    return [
      {
        id: 'subtask_1',
        title: '执行用户任务',
        prompt: task,
        writeIntent: [],
      },
    ];
  }
}
