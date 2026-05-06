import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { WriteQueue } from '../../core/write-queue.js';
import type { Task, TaskPhase, TasksFile } from './types.js';

export class TasksManager {
  private static instance: TasksManager | null = null;
  private readonly filePath: string;
  private _memStore: TasksFile | null;

  private constructor(memoryDir: string) {
    this.filePath = memoryDir === ':memory:'
      ? ':memory:'
      : join(memoryDir, 'tasks.json');
    this._memStore = null;
  }

  static getInstance(memoryDir?: string): TasksManager {
    const dir = memoryDir ?? `${process.cwd()}/memory`;
    if (!TasksManager.instance) {
      TasksManager.instance = new TasksManager(dir);
    }
    return TasksManager.instance;
  }

  static resetInstance(): void {
    TasksManager.instance = null;
  }

  async createTask(name: string, phaseDescriptions: string[]): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: `task_${Date.now()}`,
      name,
      active_phase_index: 0,
      phases: phaseDescriptions.map((desc, i) => ({
        id: `phase_${Date.now()}_${i}`,
        description: desc,
        status: 'in_progress',
        retry_count: 0,
        feedbacks: [],
        created_at: now,
      } satisfies TaskPhase)),
      status: 'active',
      created_at: now,
    };

    await this._write(async (file) => {
      file.tasks.push(task);
      file.active_task_id = task.id;
    });

    return task;
  }

  async getActive(): Promise<Task | null> {
    const file = await this._read();
    if (!file.active_task_id) return null;
    return file.tasks.find((t) => t.id === file.active_task_id) ?? null;
  }

  async incrementRetry(taskId: string, feedback: string): Promise<void> {
    await this._write(async (file) => {
      const task = file.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const phase = task.phases[task.active_phase_index];
      if (!phase) return;
      phase.retry_count++;
      phase.feedbacks.push(feedback);
    });
  }

  async completePhase(taskId: string): Promise<void> {
    await this._write(async (file) => {
      const task = file.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const phase = task.phases[task.active_phase_index];
      if (phase) {
        phase.status = 'completed';
        phase.completed_at = new Date().toISOString();
      }
      if (task.active_phase_index < task.phases.length - 1) {
        task.active_phase_index++;
      } else {
        task.status = 'completed';
        file.active_task_id = null;
      }
    });
  }

  async renameTask(taskId: string, newName: string): Promise<void> {
    await this._write(async (file) => {
      const task = file.tasks.find((t) => t.id === taskId);
      if (task) task.name = newName;
    });
  }

  private async _read(): Promise<TasksFile> {
    if (this.filePath === ':memory:') {
      return this._memStore ?? { active_task_id: null, tasks: [] };
    }
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as TasksFile;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return { active_task_id: null, tasks: [] };
      }
      throw err;
    }
  }

  private async _write(mutate: (file: TasksFile) => Promise<void> | void): Promise<void> {
    if (this.filePath === ':memory:') {
      const file = this._memStore ?? { active_task_id: null, tasks: [] };
      await mutate(file);
      this._memStore = file;
      return;
    }
    await WriteQueue.getInstance().enqueue(async () => {
      const file = await this._read();
      await mutate(file);
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(file, null, 2), 'utf-8');
    });
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
