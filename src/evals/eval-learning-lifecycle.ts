import { PreferenceCandidatesManager } from '../memory/candidates/manager.js';
import { KnacksManager } from '../memory/knacks/index.js';
import { LessonsManager } from '../memory/lessons/index.js';
import { PreferencesManager } from '../memory/preferences/manager.js';
import {
  RunArchiveWriter,
  extractWorkingMemorySnapshot,
} from '../memory/run-archive/index.js';
import { TasksManager } from '../memory/tasks/manager.js';
import { BreakerLogManager } from '../reflect/breaker-log-manager.js';
import { ReflectAgent } from '../reflect/reflect-agent.js';

export interface EvalLearningRunRef {
  taskId: string;
  runId: string;
}

export interface EvalLearningSummary extends EvalLearningRunRef {
  patternsExtracted: number;
  lessonsExtracted: number;
  knacksPromoted: number;
}

export async function beginEvalLearningRun(memoryDir: string): Promise<EvalLearningRunRef> {
  const active = await TasksManager.getInstance(memoryDir).getActive();
  if (!active) {
    throw new Error('Cannot start eval learning lifecycle without an active task');
  }
  const run = {
    taskId: active.id,
    runId: active.working_memory.runId,
  };
  await new RunArchiveWriter({ memoryDir }).startRun(run.taskId, run.runId);
  return run;
}

export async function finalizeEvalLearningRun(options: {
  memoryDir: string;
  run: EvalLearningRunRef;
  taskDescription: string;
  gitDiff: string;
  status: 'success' | 'partial' | 'failed' | 'cancelled';
  finalSummary: string;
  totalTaskCount: number;
}): Promise<EvalLearningSummary> {
  const tasks = TasksManager.getInstance(options.memoryDir);
  const task = await tasks.getTask(options.run.taskId);
  if (!task || task.working_memory.runId !== options.run.runId) {
    throw new Error(`Eval learning task ${options.run.taskId}/${options.run.runId} is unavailable`);
  }

  const snapshot = extractWorkingMemorySnapshot(
    task.working_memory,
    options.run.taskId,
    options.run.runId,
  );
  await new RunArchiveWriter({ memoryDir: options.memoryDir }).finalizeRun(options.run.runId, {
    taskId: options.run.taskId,
    status: options.status,
    finalSummary: options.finalSummary,
    wmSnapshot: snapshot,
  });

  resetReflectManagers();
  const reflect = await new ReflectAgent(
    PreferenceCandidatesManager.getInstance(options.memoryDir),
    PreferencesManager.getInstance(options.memoryDir),
    undefined,
    new BreakerLogManager(options.memoryDir),
    LessonsManager.getInstance(options.memoryDir),
    KnacksManager.getInstance(options.memoryDir),
  ).run({
    taskId: options.run.taskId,
    sessionRef: options.run.runId,
    taskDescription: options.taskDescription,
    gitDiff: options.gitDiff,
    totalTaskCount: options.totalTaskCount,
  });

  await tasks.completePhase(options.run.taskId);
  return {
    taskId: options.run.taskId,
    runId: options.run.runId,
    patternsExtracted: reflect.patternsExtracted,
    lessonsExtracted: reflect.lessonsExtracted,
    knacksPromoted: reflect.knacksPromoted,
  };
}

function resetReflectManagers(): void {
  PreferenceCandidatesManager.resetInstance();
  PreferencesManager.resetInstance();
  LessonsManager.resetInstance();
  KnacksManager.resetInstance();
}
