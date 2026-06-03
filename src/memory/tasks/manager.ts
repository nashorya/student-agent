import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { WriteQueue } from '../../core/write-queue.js';
import { getProjectMemoryDir } from '../../core/paths.js';
import type {
  CreateTaskOptions,
  Task,
  TaskLevel,
  TaskPhase,
  TasksFile,
  TaskVerificationResult,
  TaskWorkflowStatus,
  TaskWorkingMemory,
} from './types.js';

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
    const dir = memoryDir ?? getProjectMemoryDir();
    if (!TasksManager.instance) {
      TasksManager.instance = new TasksManager(dir);
    }
    return TasksManager.instance;
  }

  static resetInstance(): void {
    TasksManager.instance = null;
  }

  async createTask(name: string, phaseDescriptions: string[], options: CreateTaskOptions = {}): Promise<Task> {
    const now = new Date().toISOString();
    const workingMemory = normalizeWorkingMemory(options.workingMemory);
    const task: Task = {
      id: `task_${Date.now()}`,
      name,
      active_phase_index: 0,
      phases: phaseDescriptions.map((desc, i) => ({
        id: `phase_${Date.now()}_${i}`,
        description: desc,
        status: i === 0 ? 'in_progress' : 'pending',
        retry_count: 0,
        feedbacks: [],
        created_at: now,
      } satisfies TaskPhase)),
      status: 'active',
      workflow_status: options.workflowStatus ?? 'awaiting_plan_approval',
      level: options.level ?? 3,
      working_memory: workingMemory,
      requires_user_acceptance: options.requiresUserAcceptance ?? false,
      requires_visual_review: options.requiresVisualReview ?? false,
      verification_results: [],
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

  async getTask(taskId: string): Promise<Task | null> {
    const file = await this._read();
    return file.tasks.find((t) => t.id === taskId) ?? null;
  }

  async incrementRetry(taskId: string, feedback: string): Promise<void> {
    await this._write(async (file) => {
      const task = file.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const phase = task.phases[task.active_phase_index];
      if (!phase) return;
      task.workflow_status = 'retrying';
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
        const nextPhase = task.phases[task.active_phase_index];
        if (nextPhase && nextPhase.status === 'pending') {
          nextPhase.status = 'in_progress';
        }
        task.workflow_status = 'executing';
      } else {
        if (task.requires_visual_review) {
          task.workflow_status = 'visual_review';
        } else if (task.requires_user_acceptance) {
          task.workflow_status = 'user_review';
        } else {
          completeTaskInFile(file, task, 'All phases completed.');
        }
      }
    });
  }

  async updateWorkflowStatus(taskId: string, status: TaskWorkflowStatus): Promise<void> {
    await this._write(async (file) => {
      const task = file.tasks.find((t) => t.id === taskId);
      if (!task) return;
      task.workflow_status = status;
      if (status === 'executing') {
        const phase = task.phases[task.active_phase_index];
        if (phase && phase.status === 'pending') phase.status = 'in_progress';
      }
      if (status === 'cancelled') {
        task.status = 'cancelled';
        file.active_task_id = null;
      }
      if (status === 'failed') {
        task.status = 'failed';
      }
      if (status === 'completed') {
        completeTaskInFile(file, task, 'Workflow marked completed.');
      }
    });
  }

  async updateWorkingMemory(taskId: string, patch: Partial<TaskWorkingMemory>): Promise<void> {
    await this._write(async (file) => {
      const task = file.tasks.find((t) => t.id === taskId);
      if (!task) return;
      task.working_memory = mergeWorkingMemory(task.working_memory, patch);
    });
  }

  async recordVerification(taskId: string, result: Omit<TaskVerificationResult, 'created_at'> & { created_at?: string }): Promise<void> {
    await this._write(async (file) => {
      const task = file.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const verification: TaskVerificationResult = {
        ...result,
        created_at: result.created_at ?? new Date().toISOString(),
      };
      task.verification_results.push(verification);
      task.working_memory = mergeWorkingMemory(task.working_memory, {
        verification_results: [`${verification.status}: ${verification.summary}`],
      });
    });
  }

  async requestRevision(taskId: string, feedback: string): Promise<void> {
    await this._write(async (file) => {
      const task = file.tasks.find((t) => t.id === taskId);
      if (!task) return;
      task.workflow_status = 'revision_requested';
      task.working_memory = mergeWorkingMemory(task.working_memory, {
        design_feedback: feedback ? [feedback] : [],
      });
    });
  }

  async acceptTask(taskId: string, reason: string): Promise<void> {
    await this._write(async (file) => {
      const task = file.tasks.find((t) => t.id === taskId);
      if (!task) return;
      task.workflow_status = 'accepted';
      task.accepted_at = new Date().toISOString();
      if (reason) {
        task.working_memory = mergeWorkingMemory(task.working_memory, {
          decisions: [`Accepted: ${reason}`],
        });
      }
    });
  }

  async completeTask(taskId: string, reason: string): Promise<void> {
    await this._write(async (file) => {
      const task = file.tasks.find((t) => t.id === taskId);
      if (!task) return;
      completeTaskInFile(file, task, reason);
    });
  }

  async blockTask(taskId: string, diagnostic: string): Promise<void> {
    await this._write(async (file) => {
      const task = file.tasks.find((t) => t.id === taskId);
      if (!task) return;
      task.workflow_status = 'blocked';
      const phase = task.phases[task.active_phase_index];
      if (phase) {
        phase.status = 'blocked';
        phase.blocked_reason = diagnostic;
      }
      task.working_memory = mergeWorkingMemory(task.working_memory, {
        open_questions: diagnostic ? [diagnostic] : [],
      });
    });
  }

  async renameTask(taskId: string, newName: string): Promise<void> {
    await this._write(async (file) => {
      const task = file.tasks.find((t) => t.id === taskId);
      if (task) task.name = newName;
    });
  }

  async cancelActiveTask(): Promise<Task | null> {
    let cancelledTask: Task | null = null;
    await this._write(async (file) => {
      if (!file.active_task_id) return;
      const task = file.tasks.find((t) => t.id === file.active_task_id);
      if (!task) {
        file.active_task_id = null;
        return;
      }
      task.status = 'cancelled';
      task.workflow_status = 'cancelled';
      file.active_task_id = null;
      cancelledTask = task;
    });
    return cancelledTask;
  }

  private async _read(): Promise<TasksFile> {
    if (this.filePath === ':memory:') {
      return this._memStore ?? { active_task_id: null, tasks: [] };
    }
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      return normalizeTasksFile(JSON.parse(raw));
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

function completeTaskInFile(file: TasksFile, task: Task, reason: string): void {
  const now = new Date().toISOString();
  task.status = 'completed';
  task.workflow_status = 'completed';
  task.accepted_at = task.accepted_at ?? now;
  task.completed_at = now;
  if (reason) {
    task.working_memory = mergeWorkingMemory(task.working_memory, {
      decisions: [`Completed: ${reason}`],
    });
  }
  if (file.active_task_id === task.id) {
    file.active_task_id = null;
  }
}

function normalizeTasksFile(value: unknown): TasksFile {
  if (!isRecord(value)) {
    return { active_task_id: null, tasks: [] };
  }
  const activeTaskId = typeof value.active_task_id === 'string' ? value.active_task_id : null;
  const tasks = Array.isArray(value.tasks) ? value.tasks.map(normalizeTask) : [];
  return { active_task_id: activeTaskId, tasks };
}

function normalizeTask(value: unknown): Task {
  const record = isRecord(value) ? value : {};
  const phases = Array.isArray(record.phases)
    ? record.phases.map((phase, index) => normalizePhase(phase, index))
    : [];
  const status = normalizeTaskStatus(record.status);
  return {
    id: typeof record.id === 'string' ? record.id : `task_${Date.now()}`,
    name: typeof record.name === 'string' ? record.name : 'Untitled task',
    active_phase_index: typeof record.active_phase_index === 'number' ? record.active_phase_index : 0,
    phases,
    status,
    workflow_status: normalizeWorkflowStatus(record.workflow_status, status),
    level: normalizeLevel(record.level),
    working_memory: normalizeWorkingMemory(isRecord(record.working_memory) ? record.working_memory : undefined),
    requires_user_acceptance: record.requires_user_acceptance === true,
    requires_visual_review: record.requires_visual_review === true,
    verification_results: Array.isArray(record.verification_results)
      ? record.verification_results.map(normalizeVerificationResult)
      : [],
    created_at: typeof record.created_at === 'string' ? record.created_at : new Date().toISOString(),
    completed_at: typeof record.completed_at === 'string' ? record.completed_at : undefined,
    accepted_at: typeof record.accepted_at === 'string' ? record.accepted_at : undefined,
  };
}

function normalizePhase(value: unknown, index: number): TaskPhase {
  const record = isRecord(value) ? value : {};
  const status = normalizePhaseStatus(record.status, index);
  return {
    id: typeof record.id === 'string' ? record.id : `phase_${Date.now()}_${index}`,
    description: typeof record.description === 'string' ? record.description : `Phase ${index + 1}`,
    status,
    retry_count: typeof record.retry_count === 'number' ? record.retry_count : 0,
    feedbacks: Array.isArray(record.feedbacks) ? record.feedbacks.filter(isString) : [],
    created_at: typeof record.created_at === 'string' ? record.created_at : new Date().toISOString(),
    completed_at: typeof record.completed_at === 'string' ? record.completed_at : undefined,
    blocked_reason: typeof record.blocked_reason === 'string' ? record.blocked_reason : undefined,
  };
}

function normalizeTaskStatus(value: unknown): Task['status'] {
  return value === 'completed' || value === 'cancelled' || value === 'failed' ? value : 'active';
}

function normalizeWorkflowStatus(value: unknown, status: Task['status']): TaskWorkflowStatus {
  if (isWorkflowStatus(value)) return value;
  if (status === 'completed') return 'completed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed') return 'failed';
  return 'executing';
}

function isWorkflowStatus(value: unknown): value is TaskWorkflowStatus {
  return typeof value === 'string' && [
    'intake',
    'clarifying',
    'planning',
    'awaiting_plan_approval',
    'executing',
    'retrying',
    'blocked',
    'needs_replan',
    'failed',
    'technical_verification',
    'visual_review',
    'user_review',
    'revision_requested',
    'clarify_feedback',
    'revise',
    'accepted',
    'completed',
    'cancelled',
  ].includes(value);
}

function normalizeLevel(value: unknown): TaskLevel {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4 ? value : 3;
}

function normalizePhaseStatus(value: unknown, index: number): TaskPhase['status'] {
  if (
    value === 'pending'
    || value === 'in_progress'
    || value === 'completed'
    || value === 'blocked'
    || value === 'skipped'
  ) {
    return value;
  }
  return index === 0 ? 'in_progress' : 'pending';
}

function normalizeVerificationResult(value: unknown): TaskVerificationResult {
  const record = isRecord(value) ? value : {};
  return {
    kind: typeof record.kind === 'string' ? record.kind : 'manual',
    status: normalizeVerificationStatus(record.status),
    summary: typeof record.summary === 'string' ? record.summary : '',
    command: typeof record.command === 'string' ? record.command : undefined,
    details: typeof record.details === 'string' ? record.details : undefined,
    created_at: typeof record.created_at === 'string' ? record.created_at : new Date().toISOString(),
  };
}

function normalizeVerificationStatus(value: unknown): TaskVerificationResult['status'] {
  return value === 'passed' || value === 'failed' || value === 'skipped' || value === 'unknown' ? value : 'unknown';
}

function normalizeWorkingMemory(value?: Partial<TaskWorkingMemory> | Record<string, unknown>): TaskWorkingMemory {
  return {
    goal: typeof value?.goal === 'string' ? value.goal : '',
    acceptance_criteria: normalizeStringArray(value?.acceptance_criteria),
    constraints: normalizeStringArray(value?.constraints),
    user_preferences: normalizeStringArray(value?.user_preferences),
    project_facts: normalizeStringArray(value?.project_facts),
    open_questions: normalizeStringArray(value?.open_questions),
    decisions: normalizeStringArray(value?.decisions),
    design_feedback: normalizeStringArray(value?.design_feedback),
    verification_results: normalizeStringArray(value?.verification_results),
    changed_files: normalizeStringArray(value?.changed_files),
  };
}

function mergeWorkingMemory(current: TaskWorkingMemory, patch: Partial<TaskWorkingMemory>): TaskWorkingMemory {
  return {
    goal: patch.goal ?? current.goal,
    acceptance_criteria: mergeUnique(current.acceptance_criteria, patch.acceptance_criteria),
    constraints: mergeUnique(current.constraints, patch.constraints),
    user_preferences: mergeUnique(current.user_preferences, patch.user_preferences),
    project_facts: mergeUnique(current.project_facts, patch.project_facts),
    open_questions: mergeUnique(current.open_questions, patch.open_questions),
    decisions: mergeUnique(current.decisions, patch.decisions),
    design_feedback: mergeUnique(current.design_feedback, patch.design_feedback),
    verification_results: mergeUnique(current.verification_results, patch.verification_results),
    changed_files: mergeUnique(current.changed_files, patch.changed_files),
  };
}

function mergeUnique(current: string[], next?: string[]): string[] {
  if (!next || next.length === 0) return current;
  return [...new Set([...current, ...next.filter(Boolean)])];
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isString).filter(Boolean) : [];
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
