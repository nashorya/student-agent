import PQueue from 'p-queue';
import type { SubAgentTask, TaskPlan, WriteIntentConflict } from './planner.js';
import { detectWriteIntentConflicts, normalizeWritePath } from './planner.js';
import { MergeAgent, type MergeAgentResult } from './merge-agent.js';

export type SubAgentStatus = 'success' | 'failed' | 'state_conflict' | 'skipped';

export interface SubAgentRunResult {
  taskId: string;
  status: SubAgentStatus;
  summary: string;
  writtenFiles: string[];
  patch?: string;
  error?: string;
}

export interface OrchestratorResult {
  status: 'disabled' | 'blocked_conflicts' | 'completed' | 'completed_with_errors';
  conflicts: WriteIntentConflict[];
  results: SubAgentRunResult[];
  merge?: MergeAgentResult;
}

export interface SubAgentExecutor {
  execute(task: SubAgentTask, signal: AbortSignal): Promise<Omit<SubAgentRunResult, 'taskId'>>;
}

export interface SubAgentOrchestratorOptions {
  enabled?: boolean;
  maxConcurrency?: number;
  rollbackTask?: (task: SubAgentTask, reason: string) => Promise<void>;
}

const DEFAULT_MAX_CONCURRENCY = 3;

export class SubAgentOrchestrator {
  private readonly enabled: boolean;
  private readonly maxConcurrency: number;
  private readonly rollbackTask?: (task: SubAgentTask, reason: string) => Promise<void>;
  private readonly mergeAgent: MergeAgent;

  constructor(
    private readonly executor: SubAgentExecutor,
    options: SubAgentOrchestratorOptions = {},
  ) {
    this.enabled = options.enabled ?? false;
    this.maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    this.rollbackTask = options.rollbackTask;
    this.mergeAgent = new MergeAgent();
  }

  async run(plan: TaskPlan): Promise<OrchestratorResult> {
    if (!this.enabled) {
      return {
        status: 'disabled',
        conflicts: [],
        results: plan.tasks.map((task) => ({
          taskId: task.id,
          status: 'skipped',
          summary: 'Sub-agent orchestration is disabled',
          writtenFiles: [],
        })),
      };
    }

    const conflicts = plan.conflicts.length > 0
      ? plan.conflicts
      : detectWriteIntentConflicts(plan.tasks);
    if (conflicts.length > 0) {
      return {
        status: 'blocked_conflicts',
        conflicts,
        results: [],
      };
    }

    const abortController = new AbortController();
    const queue = new PQueue({ concurrency: this.maxConcurrency });
    const results = await Promise.all(
      plan.tasks.map((task) =>
        queue.add(() => this.runTask(task, abortController.signal)),
      ),
    );

    const runtimeConflicts = await this.detectRuntimeConflicts(plan.tasks, results);
    const mergedResults = results.map((result) => {
      const conflict = runtimeConflicts.get(result.taskId);
      if (!conflict) {
        return result;
      }
      return {
        ...result,
        status: 'state_conflict' as const,
        error: conflict,
      };
    });

    const merge = this.mergeAgent.synchronize({
      tasks: plan.tasks,
      results: mergedResults,
    });

    return {
      status: mergedResults.some((result) => result.status !== 'success')
        ? 'completed_with_errors'
        : 'completed',
      conflicts: merge.conflicts,
      results: mergedResults,
      merge,
    };
  }

  private async runTask(
    task: SubAgentTask,
    signal: AbortSignal,
  ): Promise<SubAgentRunResult> {
    try {
      const result = await this.executor.execute(task, signal);
      return {
        taskId: task.id,
        ...result,
      };
    } catch (err) {
      return {
        taskId: task.id,
        status: 'failed',
        summary: 'Sub-agent failed',
        writtenFiles: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async detectRuntimeConflicts(
    tasks: SubAgentTask[],
    results: SubAgentRunResult[],
  ): Promise<Map<string, string>> {
    const conflicts = new Map<string, string>();
    const declaredByTask = new Map(
      tasks.map((task) => [task.id, new Set(task.writeIntent.map(normalizeWritePath))]),
    );
    const ownerByPath = new Map<string, string>();

    for (const result of results) {
      for (const rawPath of result.writtenFiles) {
        const path = normalizeWritePath(rawPath);
        const declared = declaredByTask.get(result.taskId);
        if (declared && declared.size > 0 && !declared.has(path)) {
          conflicts.set(result.taskId, `写入了未声明路径：${path}`);
        }

        const owner = ownerByPath.get(path);
        if (owner && owner !== result.taskId) {
          conflicts.set(result.taskId, `运行时写入冲突：${path} 已由 ${owner} 写入`);
          conflicts.set(owner, `运行时写入冲突：${path} 也由 ${result.taskId} 写入`);
        }
        ownerByPath.set(path, result.taskId);
      }
    }

    if (this.rollbackTask) {
      const taskById = new Map(tasks.map((task) => [task.id, task]));
      for (const [taskId, reason] of conflicts) {
        const task = taskById.get(taskId);
        if (task) {
          await this.rollbackTask(task, reason);
        }
      }
    }

    return conflicts;
  }
}
