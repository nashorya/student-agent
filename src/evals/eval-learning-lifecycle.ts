import { PreferenceCandidatesManager } from '../memory/candidates/manager.js';
import { KnacksManager } from '../memory/knacks/index.js';
import { LessonsManager } from '../memory/lessons/index.js';
import type { LessonVerificationEvidence } from '../memory/lessons/index.js';
import { PreferencesManager } from '../memory/preferences/manager.js';
import {
  RunArchiveWriter,
  extractWorkingMemorySnapshot,
} from '../memory/run-archive/index.js';
import { TasksManager } from '../memory/tasks/manager.js';
import { BreakerLogManager } from '../reflect/breaker-log-manager.js';
import { ReflectAgent } from '../reflect/reflect-agent.js';
import type { ToolTraceEntry } from './types.js';
import type { RecallCitationAudit } from '../memory/recall/citation.js';

export interface EvalLearningRunRef {
  taskId: string;
  runId: string;
}

export interface EvalLearningSummary extends EvalLearningRunRef {
  patternsExtracted: number;
  lessonsExtracted: number;
  knacksPromoted: number;
  usedRecallIds: string[];
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
  toolCalls?: ToolTraceEntry[];
  recallAudit?: RecallCitationAudit;
  verificationStatus?: 'pending' | 'passed' | 'failed';
  verificationEvidenceRef?: string;
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
  const archive = new RunArchiveWriter({ memoryDir: options.memoryDir });
  for (const event of options.recallAudit?.citation_events ?? []) {
    await archive.appendEvent(options.run.runId, {
      timestamp: new Date().toISOString(),
      kind: 'recall_citation',
      summary: `Used ${event.used_ids.length} recalled item(s)`,
      metadata: {
        messageIndex: event.message_index,
        contextTraceIndex: event.context_trace_index,
        injectedIds: event.injected_ids,
        citedIds: event.cited_ids,
        usedIds: event.used_ids,
        invalidIds: event.invalid_ids,
        alignmentStatus: event.alignment_status,
      },
    });
  }
  await archive.finalizeRun(options.run.runId, {
    taskId: options.run.taskId,
    status: options.status,
    finalSummary: options.finalSummary,
    wmSnapshot: snapshot,
    recallAudit: options.recallAudit,
    verificationStatus: options.verificationStatus ?? 'pending',
    verificationEvidenceRef: options.verificationEvidenceRef,
  });

  resetReflectManagers();
  const toolCalls = options.toolCalls ?? [];
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
    lessonVerificationEvidence: buildLessonVerificationEvidence(toolCalls),
    lessonOperationEvidence: buildLessonOperationEvidence(toolCalls),
  });

  await tasks.completePhase(options.run.taskId);
  return {
    taskId: options.run.taskId,
    runId: options.run.runId,
    patternsExtracted: reflect.patternsExtracted,
    lessonsExtracted: reflect.lessonsExtracted,
    knacksPromoted: reflect.knacksPromoted,
    usedRecallIds: options.recallAudit?.used_recall_ids ?? [],
  };
}

export function buildLessonVerificationEvidence(
  toolCalls: ToolTraceEntry[],
): LessonVerificationEvidence[] {
  return toolCalls.flatMap((call) => {
    if (call.isError !== false || !call.endedAt || !isProcessTool(call.name)) {
      return [];
    }
    const command = extractCommand(call.args);
    if (!command || !isVerificationCommand(command)) {
      return [];
    }
    return [{
      toolCallId: call.id,
      toolName: call.name,
      exitCode: 0,
      completedAt: call.endedAt,
    }];
  });
}

/** Non-error tool ops for provisional causal pairs (error → recovery tools). */
export function buildLessonOperationEvidence(
  toolCalls: ToolTraceEntry[],
): Array<{ toolName: string; completedAt: string }> {
  return toolCalls.flatMap((call) => {
    if (call.isError === true || !call.endedAt) return [];
    return [{ toolName: call.name, completedAt: call.endedAt }];
  });
}

function isProcessTool(name: string): boolean {
  return /^(?:student_)?(?:bash|shell|exec)$/.test(name.toLowerCase());
}

function extractCommand(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const command = (args as Record<string, unknown>).command;
  return typeof command === 'string' ? command : undefined;
}

function isVerificationCommand(command: string): boolean {
  return /\b(?:test|tests|pytest|vitest|jest|tsc|lint|check|verify)\b/i.test(command);
}

function resetReflectManagers(): void {
  PreferenceCandidatesManager.resetInstance();
  PreferencesManager.resetInstance();
  LessonsManager.resetInstance();
  KnacksManager.resetInstance();
}
