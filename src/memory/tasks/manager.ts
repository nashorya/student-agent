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
  TaskWorkingMemoryArtifactRef,
  TaskWorkingMemoryReadFile,
  TaskWorkingMemoryRecentError,
  TaskWorkingMemoryRecentSignal,
  TaskWorkingMemoryTodo,
  TaskWorkingMemoryWriteFile,
  WorkingMemoryErrorSource,
  WorkingMemoryPhase,
  WorkingMemorySignalSeverity,
  WorkingMemoryTodoStatus,
  WorkingMemoryWriteTool,
} from './types.js';
import {
  createWorkflowActor,
  isWorkflowMachineStatus,
  workflowStatusToEvent,
  type WorkflowActor,
  type WorkflowEvent,
} from './workflow-machine.js';

export class TasksManager {
  private static instance: TasksManager | null = null;
  private readonly filePath: string;
  private _memStore: TasksFile | null;
  private actors: Map<string, WorkflowActor>;

  private constructor(memoryDir: string) {
    this.filePath = memoryDir === ':memory:'
      ? ':memory:'
      : join(memoryDir, 'tasks.json');
    this._memStore = null;
    this.actors = new Map();
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
    const taskId = `task_${Date.now()}`;
    const workflowStatus = options.workflowStatus ?? 'awaiting_plan_approval';
    const workingMemory = normalizeWorkingMemory(options.workingMemory, {
      taskId,
      workflowStatus,
      currentStep: phaseDescriptions[0] ?? '',
      now,
    });
    const task: Task = {
      id: taskId,
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
      workflow_status: workflowStatus,
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
      this.applyWorkflowEvent(task, { type: 'RETRY' }, 'retrying', { fallbackToTarget: true });
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
        this.applyWorkflowEvent(task, { type: 'EXECUTE' }, 'executing', { fallbackToTarget: true });
      } else {
        if (task.requires_visual_review) {
          this.applyWorkflowEvent(task, { type: 'COMPLETE_PHASE', target: 'visual_review' }, 'visual_review', {
            fallbackToTarget: true,
          });
        } else if (task.requires_user_acceptance) {
          this.applyWorkflowEvent(task, { type: 'COMPLETE_PHASE', target: 'user_review' }, 'user_review', {
            fallbackToTarget: true,
          });
        } else {
          completeTaskInFile(file, task, 'All phases completed.');
          this.actors.delete(task.id);
        }
      }
    });
  }

  async updateWorkflowStatus(taskId: string, status: TaskWorkflowStatus): Promise<void> {
    await this._write(async (file) => {
      const task = file.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const event = workflowStatusToEvent(status);
      if (!event) {
        task.workflow_status = status;
      } else {
        const nextStatus = this.applyWorkflowEvent(task, event, status, { fallbackToTarget: false });
        if (nextStatus !== status) return;
      }
      if (task.workflow_status === 'executing') {
        const phase = task.phases[task.active_phase_index];
        if (phase && phase.status === 'pending') phase.status = 'in_progress';
      }
      if (task.workflow_status === 'cancelled') {
        task.status = 'cancelled';
        file.active_task_id = null;
        this.actors.delete(task.id);
      }
      if (task.workflow_status === 'failed') {
        task.status = 'failed';
      }
      if (task.workflow_status === 'completed') {
        completeTaskInFile(file, task, 'Workflow marked completed.');
        this.actors.delete(task.id);
      }
    });
  }

  async updateWorkingMemory(taskId: string, patch: Partial<TaskWorkingMemory> | Record<string, unknown>): Promise<void> {
    await this._write(async (file) => {
      const task = file.tasks.find((t) => t.id === taskId);
      if (!task) return;
      task.working_memory = mergeWorkingMemory(task.working_memory, patch);
    });
  }

  async trackFileRead(taskId: string, filePath: string): Promise<void> {
    const now = new Date().toISOString();
    await this.updateWorkingMemory(taskId, {
      readFiles: [{ path: filePath, ranges: [], lastReadAt: now }],
    });
  }

  async trackFileWrite(taskId: string, filePath: string): Promise<void> {
    const now = new Date().toISOString();
    await this.updateWorkingMemory(taskId, {
      writeFiles: [{
        path: filePath,
        tool: 'hashline_edit',
        summary: `Edited ${filePath}`,
        writtenAt: now,
      }],
    });
  }

  async trackError(taskId: string, error: string): Promise<void> {
    const now = new Date().toISOString();
    await this.updateWorkingMemory(taskId, {
      recentErrors: [{
        id: makeMemoryId('err', error, now),
        source: 'runtime',
        pattern: error,
        summary: error,
        createdAt: now,
      }],
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
        artifactRefs: [{
          id: makeMemoryId('artifact', `${verification.status}:${verification.summary}`, verification.created_at),
          kind: 'verification_result',
          summary: `${verification.status}: ${verification.summary}`,
        }],
      });
    });
  }

  async requestRevision(taskId: string, feedback: string): Promise<void> {
    await this._write(async (file) => {
      const task = file.tasks.find((t) => t.id === taskId);
      if (!task) return;
      this.applyWorkflowEvent(task, { type: 'REQUEST_REVISION' }, 'revision_requested', { fallbackToTarget: true });
    });
  }

  async acceptTask(taskId: string, reason: string): Promise<void> {
    await this._write(async (file) => {
      const task = file.tasks.find((t) => t.id === taskId);
      if (!task) return;
      this.applyWorkflowEvent(task, { type: 'ACCEPT' }, 'accepted', { fallbackToTarget: true });
      task.accepted_at = new Date().toISOString();
      if (reason) {
        task.working_memory = mergeWorkingMemory(task.working_memory, {
          artifactRefs: [{
            id: makeMemoryId('artifact', `Accepted:${reason}`, task.accepted_at),
            kind: 'decision',
            summary: `Accepted: ${reason}`,
          }],
        });
      }
    });
  }

  async completeTask(taskId: string, reason: string): Promise<void> {
    await this._write(async (file) => {
      const task = file.tasks.find((t) => t.id === taskId);
      if (!task) return;
      this.applyWorkflowEvent(task, { type: 'COMPLETE' }, 'completed', { fallbackToTarget: true });
      completeTaskInFile(file, task, reason);
      this.actors.delete(task.id);
    });
  }

  async blockTask(taskId: string, diagnostic: string): Promise<void> {
    await this._write(async (file) => {
      const task = file.tasks.find((t) => t.id === taskId);
      if (!task) return;
      this.applyWorkflowEvent(task, { type: 'BLOCK' }, 'blocked', { fallbackToTarget: true });
      const phase = task.phases[task.active_phase_index];
      if (phase) {
        phase.status = 'blocked';
        phase.blocked_reason = diagnostic;
      }
      task.working_memory = mergeWorkingMemory(task.working_memory, {
        recentSignals: diagnostic ? [{
          id: makeMemoryId('signal', diagnostic, new Date().toISOString()),
          kind: 'open_question',
          summary: diagnostic,
          severity: 'high',
          createdAt: new Date().toISOString(),
        }] : [],
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
      this.applyWorkflowEvent(task, { type: 'CANCEL' }, 'cancelled', { fallbackToTarget: true });
      file.active_task_id = null;
      this.actors.delete(task.id);
      cancelledTask = task;
    });
    return cancelledTask;
  }

  private getOrCreateActor(task: Task): WorkflowActor | null {
    if (!isWorkflowMachineStatus(task.workflow_status)) return null;

    const existing = this.actors.get(task.id);
    if (existing?.getSnapshot().value === task.workflow_status) {
      return existing;
    }

    const actor = createWorkflowActor(task.workflow_status);
    this.actors.set(task.id, actor);
    return actor;
  }

  private applyWorkflowEvent(
    task: Task,
    event: WorkflowEvent,
    targetStatus: TaskWorkflowStatus,
    options: { fallbackToTarget: boolean },
  ): TaskWorkflowStatus {
    const actor = this.getOrCreateActor(task);
    if (!actor) {
      if (options.fallbackToTarget) task.workflow_status = targetStatus;
      return task.workflow_status;
    }

    const before = actor.getSnapshot().value as TaskWorkflowStatus;
    actor.send(event);
    const after = actor.getSnapshot().value as TaskWorkflowStatus;

    if (after === before && after !== targetStatus) {
      console.warn(
        `[TasksManager] Invalid workflow transition: ${before} -> ${targetStatus} (event: ${event.type}). Ignored.`,
      );
      if (options.fallbackToTarget) {
        task.workflow_status = targetStatus;
        this.actors.delete(task.id);
      }
      return task.workflow_status;
    }

    task.workflow_status = after;
    return after;
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
      artifactRefs: [{
        id: makeMemoryId('artifact', `Completed:${reason}`, now),
        kind: 'decision',
        summary: `Completed: ${reason}`,
      }],
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
  const record: Record<string, unknown> = isRecord(value) ? value : {};
  const phases = Array.isArray(record.phases)
    ? record.phases.map((phase, index) => normalizePhase(phase, index))
    : [];
  const status = normalizeTaskStatus(record.status);
  const id = typeof record.id === 'string' ? record.id : `task_${Date.now()}`;
  const workflowStatus = normalizeWorkflowStatus(record.workflow_status, status);
  const activePhaseIndex = typeof record.active_phase_index === 'number' ? record.active_phase_index : 0;
  return {
    id,
    name: typeof record.name === 'string' ? record.name : 'Untitled task',
    active_phase_index: activePhaseIndex,
    phases,
    status,
    workflow_status: workflowStatus,
    level: normalizeLevel(record.level),
    working_memory: normalizeWorkingMemory(isRecord(record.working_memory) ? record.working_memory : undefined, {
      taskId: id,
      workflowStatus,
      currentStep: phases[activePhaseIndex]?.description ?? '',
    }),
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
  const record: Record<string, unknown> = isRecord(value) ? value : {};
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

interface WorkingMemoryNormalizeMeta {
  taskId: string;
  workflowStatus?: TaskWorkflowStatus;
  currentStep?: string;
  now?: string;
}

const WORKING_MEMORY_LIMITS = {
  todos: 8,
  readFiles: 12,
  writeFiles: 12,
  recentErrors: 5,
  recentSignals: 5,
  artifactRefs: 10,
};

function normalizeWorkingMemory(
  value: Partial<TaskWorkingMemory> | Record<string, unknown> | undefined,
  meta: WorkingMemoryNormalizeMeta,
): TaskWorkingMemory {
  const record: Record<string, unknown> = isRecord(value) ? value : {};
  const now = meta.now ?? new Date().toISOString();
  const phase = normalizeWorkingMemoryPhase(record.phase)
    ?? workflowStatusToWorkingMemoryPhase(meta.workflowStatus)
    ?? 'executing';

  return {
    taskId: typeof record.taskId === 'string' ? record.taskId : meta.taskId,
    runId: typeof record.runId === 'string' ? record.runId : `run_${Date.now()}`,
    goal: typeof record.goal === 'string' ? record.goal : '',
    hardConstraints: typeof record.hardConstraints === 'string' ? record.hardConstraints : '',
    phase,
    currentStep: typeof record.currentStep === 'string' ? record.currentStep : meta.currentStep ?? '',
    todos: capArray(normalizeTodos(record.todos, now), WORKING_MEMORY_LIMITS.todos),
    readFiles: capArray(
      mergeReadFiles([], [
        ...normalizeReadFiles(record.readFiles, now),
        ...normalizeLegacyReadFiles(record['read_files'], now),
      ]),
      WORKING_MEMORY_LIMITS.readFiles,
    ),
    writeFiles: capArray(
      mergeWriteFiles([], [
        ...normalizeWriteFiles(record.writeFiles, now),
        ...normalizeLegacyWriteFiles(record['written_files'], now),
      ]),
      WORKING_MEMORY_LIMITS.writeFiles,
    ),
    recentErrors: capArray(
      [
        ...normalizeRecentErrors(record.recentErrors, now),
        ...normalizeLegacyErrors(record['recent_errors'], now),
      ],
      WORKING_MEMORY_LIMITS.recentErrors,
    ),
    recentSignals: capArray(normalizeRecentSignals(record.recentSignals, now), WORKING_MEMORY_LIMITS.recentSignals),
    artifactRefs: capArray(
      mergeById([
        ...normalizeArtifactRefs(record.artifactRefs),
        ...legacyArtifactRefs(record),
      ]),
      WORKING_MEMORY_LIMITS.artifactRefs,
    ),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : now,
  };
}

function mergeWorkingMemory(
  current: TaskWorkingMemory,
  patch: Partial<TaskWorkingMemory> | Record<string, unknown>,
): TaskWorkingMemory {
  const patchRecord = isRecord(patch) ? patch : {};
  const now = new Date().toISOString();
  const normalizedPatch = normalizeWorkingMemory(patchRecord, {
    taskId: current.taskId,
    currentStep: current.currentStep,
    now,
  });

  return {
    taskId: typeof patchRecord.taskId === 'string' ? patchRecord.taskId : current.taskId,
    runId: typeof patchRecord.runId === 'string' ? patchRecord.runId : current.runId,
    goal: typeof patchRecord.goal === 'string' ? patchRecord.goal : current.goal,
    hardConstraints: typeof patchRecord.hardConstraints === 'string'
      ? patchRecord.hardConstraints
      : current.hardConstraints,
    phase: normalizeWorkingMemoryPhase(patchRecord.phase) ?? current.phase,
    currentStep: typeof patchRecord.currentStep === 'string' ? patchRecord.currentStep : current.currentStep,
    todos: capArray(mergeTodos(current.todos, normalizedPatch.todos), WORKING_MEMORY_LIMITS.todos),
    readFiles: capArray(mergeReadFiles(current.readFiles, normalizedPatch.readFiles), WORKING_MEMORY_LIMITS.readFiles),
    writeFiles: capArray(mergeWriteFiles(current.writeFiles, normalizedPatch.writeFiles), WORKING_MEMORY_LIMITS.writeFiles),
    recentErrors: capArray([...current.recentErrors, ...normalizedPatch.recentErrors], WORKING_MEMORY_LIMITS.recentErrors),
    recentSignals: capArray([...current.recentSignals, ...normalizedPatch.recentSignals], WORKING_MEMORY_LIMITS.recentSignals),
    artifactRefs: capArray(mergeById([...current.artifactRefs, ...normalizedPatch.artifactRefs]), WORKING_MEMORY_LIMITS.artifactRefs),
    updatedAt: now,
  };
}

function capArray<T>(arr: T[], max: number): T[] {
  return arr.length > max ? arr.slice(arr.length - max) : arr;
}

function normalizeWorkingMemoryPhase(value: unknown): WorkingMemoryPhase | null {
  return value === 'planning' || value === 'executing' || value === 'verifying' || value === 'reflecting'
    ? value
    : null;
}

function workflowStatusToWorkingMemoryPhase(status: TaskWorkflowStatus | undefined): WorkingMemoryPhase | null {
  if (!status) return null;
  if (status === 'planning' || status === 'awaiting_plan_approval' || status === 'clarifying' || status === 'intake') {
    return 'planning';
  }
  if (status === 'technical_verification' || status === 'visual_review' || status === 'user_review' || status === 'accepted') {
    return 'verifying';
  }
  if (status === 'completed' || status === 'cancelled') {
    return 'reflecting';
  }
  return 'executing';
}

function normalizeTodos(value: unknown, now: string): TaskWorkingMemoryTodo[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const content = typeof item.content === 'string' ? item.content : '';
    if (!content) return [];
    return [{
      id: typeof item.id === 'string' ? item.id : makeMemoryId('todo', content, `${now}_${index}`),
      content,
      status: normalizeTodoStatus(item.status),
      evidenceRefs: normalizeStringArray(item.evidenceRefs),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : now,
    }];
  });
}

function normalizeTodoStatus(value: unknown): WorkingMemoryTodoStatus {
  return value === 'pending' || value === 'in_progress' || value === 'done' || value === 'blocked'
    ? value
    : 'pending';
}

function normalizeReadFiles(value: unknown, now: string): TaskWorkingMemoryReadFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const path = typeof item.path === 'string' ? item.path : '';
    if (!path) return [];
    return [{
      path,
      ranges: normalizeReadRanges(item.ranges, now),
      lastReadAt: typeof item.lastReadAt === 'string' ? item.lastReadAt : now,
      lastKnownHash: typeof item.lastKnownHash === 'string' ? item.lastKnownHash : undefined,
    }];
  });
}

function normalizeReadRanges(value: unknown, now: string): TaskWorkingMemoryReadFile['ranges'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const startLine = typeof item.startLine === 'number' ? item.startLine : 0;
    const endLine = typeof item.endLine === 'number' ? item.endLine : 0;
    const summary = typeof item.summary === 'string' ? item.summary : '';
    return [{
      startLine,
      endLine,
      summary,
      hashlineTag: typeof item.hashlineTag === 'string' ? item.hashlineTag : undefined,
      readAt: typeof item.readAt === 'string' ? item.readAt : now,
    }];
  });
}

function normalizeLegacyReadFiles(value: unknown, now: string): TaskWorkingMemoryReadFile[] {
  return normalizeStringArray(value).map((path) => ({ path, ranges: [], lastReadAt: now }));
}

function normalizeWriteFiles(value: unknown, now: string): TaskWorkingMemoryWriteFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const path = typeof item.path === 'string' ? item.path : '';
    if (!path) return [];
    return [{
      path,
      tool: normalizeWriteTool(item.tool),
      summary: typeof item.summary === 'string' ? item.summary : `Updated ${path}`,
      checkpointId: typeof item.checkpointId === 'string' ? item.checkpointId : undefined,
      writtenAt: typeof item.writtenAt === 'string' ? item.writtenAt : now,
    }];
  });
}

function normalizeLegacyWriteFiles(value: unknown, now: string): TaskWorkingMemoryWriteFile[] {
  return normalizeStringArray(value).map((path) => ({
    path,
    tool: 'hashline_edit',
    summary: `Edited ${path}`,
    writtenAt: now,
  }));
}

function normalizeWriteTool(value: unknown): WorkingMemoryWriteTool {
  return value === 'hashline_edit' || value === 'write_file' || value === 'format' || value === 'other'
    ? value
    : 'other';
}

function normalizeRecentErrors(value: unknown, now: string): TaskWorkingMemoryRecentError[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const summary = typeof item.summary === 'string' ? item.summary : '';
    if (!summary) return [];
    const createdAt = typeof item.createdAt === 'string' ? item.createdAt : now;
    return [{
      id: typeof item.id === 'string' ? item.id : makeMemoryId('err', summary, `${createdAt}_${index}`),
      source: normalizeErrorSource(item.source),
      pattern: typeof item.pattern === 'string' ? item.pattern : summary,
      summary,
      recoveryHint: typeof item.recoveryHint === 'string' ? item.recoveryHint : undefined,
      evidenceRef: typeof item.evidenceRef === 'string' ? item.evidenceRef : undefined,
      createdAt,
    }];
  });
}

function normalizeLegacyErrors(value: unknown, now: string): TaskWorkingMemoryRecentError[] {
  return normalizeStringArray(value).map((summary, index) => ({
    id: makeMemoryId('err', summary, `${now}_${index}`),
    source: 'runtime',
    pattern: summary,
    summary,
    createdAt: now,
  }));
}

function normalizeErrorSource(value: unknown): WorkingMemoryErrorSource {
  return value === 'tool' || value === 'toolguard' || value === 'hashline' || value === 'fileguard' || value === 'runtime'
    ? value
    : 'runtime';
}

function normalizeRecentSignals(value: unknown, now: string): TaskWorkingMemoryRecentSignal[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const summary = typeof item.summary === 'string' ? item.summary : '';
    if (!summary) return [];
    const createdAt = typeof item.createdAt === 'string' ? item.createdAt : now;
    return [{
      id: typeof item.id === 'string' ? item.id : makeMemoryId('signal', summary, `${createdAt}_${index}`),
      kind: typeof item.kind === 'string' ? item.kind : 'runtime',
      summary,
      severity: normalizeSignalSeverity(item.severity),
      evidenceRef: typeof item.evidenceRef === 'string' ? item.evidenceRef : undefined,
      createdAt,
    }];
  });
}

function normalizeSignalSeverity(value: unknown): WorkingMemorySignalSeverity {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'low';
}

function normalizeArtifactRefs(value: unknown): TaskWorkingMemoryArtifactRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const summary = typeof item.summary === 'string' ? item.summary : '';
    if (!summary) return [];
    return [{
      id: typeof item.id === 'string' ? item.id : makeMemoryId('artifact', summary, String(index)),
      kind: typeof item.kind === 'string' ? item.kind : 'note',
      summary,
    }];
  });
}

function legacyArtifactRefs(record: Record<string, unknown>): TaskWorkingMemoryArtifactRef[] {
  return [
    ...legacyStringArtifacts(record.acceptance_criteria, 'acceptance_criterion'),
    ...legacyStringArtifacts(record.constraints, 'constraint'),
    ...legacyStringArtifacts(record.user_preferences, 'user_preference'),
    ...legacyStringArtifacts(record.project_facts, 'project_fact'),
    ...legacyStringArtifacts(record.open_questions, 'open_question'),
    ...legacyStringArtifacts(record.decisions, 'decision'),
    ...legacyStringArtifacts(record.verification_results, 'verification_result'),
    ...legacyStringArtifacts(record.changed_files, 'changed_file'),
  ];
}

function legacyStringArtifacts(value: unknown, kind: string): TaskWorkingMemoryArtifactRef[] {
  return normalizeStringArray(value).map((summary, index) => ({
    id: makeMemoryId('artifact', `${kind}:${summary}`, String(index)),
    kind,
    summary,
  }));
}

function mergeTodos(current: TaskWorkingMemoryTodo[], next: TaskWorkingMemoryTodo[]): TaskWorkingMemoryTodo[] {
  return mergeByKey(current, next, (item) => item.id);
}

function mergeReadFiles(current: TaskWorkingMemoryReadFile[], next: TaskWorkingMemoryReadFile[]): TaskWorkingMemoryReadFile[] {
  return mergeByKey(current, next, (item) => item.path);
}

function mergeWriteFiles(current: TaskWorkingMemoryWriteFile[], next: TaskWorkingMemoryWriteFile[]): TaskWorkingMemoryWriteFile[] {
  return mergeByKey(current, next, (item) => item.path);
}

function mergeById<T extends { id: string }>(items: T[]): T[] {
  return mergeByKey([], items, (item) => item.id);
}

function mergeByKey<T>(current: T[], next: T[], getKey: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of current) map.set(getKey(item), item);
  for (const item of next) map.set(getKey(item), item);
  return [...map.values()];
}

function makeMemoryId(prefix: string, value: string, salt: string): string {
  return `${prefix}_${hashString(`${value}:${salt}`)}`;
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
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
