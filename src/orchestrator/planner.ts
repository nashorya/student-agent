export interface SubAgentTask {
  id: string;
  title: string;
  prompt: string;
  readIntent?: string[];
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
  kind?: 'write-write' | 'read-write';
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
      for (const path of findOverlappingPaths(tasks[i].writeIntent, tasks[j].writeIntent)) {
        conflicts.push({
          firstTaskId: tasks[i].id,
          secondTaskId: tasks[j].id,
          path,
          kind: 'write-write',
        });
      }
      for (const path of findReadWriteOverlaps(tasks[i], tasks[j])) {
        conflicts.push({
          firstTaskId: tasks[i].id,
          secondTaskId: tasks[j].id,
          path,
          kind: 'read-write',
        });
      }
    }
  }

  return conflicts;
}

function findReadWriteOverlaps(first: SubAgentTask, second: SubAgentTask): string[] {
  return [
    ...findOverlappingPaths(first.readIntent ?? [], second.writeIntent),
    ...findOverlappingPaths(second.readIntent ?? [], first.writeIntent),
  ];
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
