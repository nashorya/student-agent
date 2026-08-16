import { Type } from '../pi-compat/index.js';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { getProjectMemoryDir } from '../paths.js';
import {
  LessonsManager,
  type ModelAuthoredLessonDraft,
} from '../../memory/lessons/manager.js';
import {
  WRITE_LESSON_AEVO_GUIDELINE,
  formatWriteLessonArcReminder,
  WRITE_LESSON_INSTRUCTION,
} from '../../memory/lessons/write-lesson-instruction.js';
import type { LessonDocRef, LessonEvidence } from '../../memory/lessons/types.js';

export interface LessonArcRecord {
  arcId: string;
  errorToolCallId: string;
  fixToolCallIds: string[];
  verificationToolCallId: string;
}

/** Run-scoped arcId -> real toolCallId triple. Model never sees the real ids. */
export class LessonArcRegistry {
  private nextSeq = 1;
  private readonly arcs = new Map<string, LessonArcRecord>();
  private readonly claimed = new Set<string>();

  issue(triple: Omit<LessonArcRecord, "arcId">): LessonArcRecord {
    const arcId = `arc-${this.nextSeq}`;
    this.nextSeq += 1;
    const record: LessonArcRecord = { arcId, ...triple };
    this.arcs.set(arcId, record);
    return record;
  }

  resolve(arcId: string | undefined): LessonArcRecord | undefined {
    if (!arcId?.trim()) return undefined;
    return this.arcs.get(arcId.trim());
  }

  claim(arcId: string): void {
    if (this.arcs.has(arcId)) this.claimed.add(arcId);
  }

  unclaimedIds(): string[] {
    return [...this.arcs.keys()].filter((id) => !this.claimed.has(id));
  }
}

export interface WriteLessonToolOptions {
  memoryDir?: string;
  getTaskId?: () => string;
  getSessionRef?: () => string;
  repo?: string;
  sessionEvents: Array<Record<string, unknown>>;
  arcRegistry?: LessonArcRegistry;
}

interface WriteLessonInput {
  whatWentWrong: string;
  rootCause: string;
  fixMethod: string;
  contrast: string;
  doNotApplyWhen: string;
  symptomKeys: string[];
  evidence?: { arcId?: string };
  docRefs?: LessonDocRef[];
}

const schema = Type.Object({
  whatWentWrong: Type.String({
    description: 'Which step went wrong and why it looked reasonable at the time.',
  }),
  rootCause: Type.String({
    description: 'True cause at the subsystem + defect-class layer. No line numbers.',
  }),
  fixMethod: Type.String({
    description: 'How the later correction actually fixed it.',
  }),
  contrast: Type.String({
    description: 'Difference between the wrong path and the correct path.',
  }),
  doNotApplyWhen: Type.String({
    description: 'Real boundary where this lesson should not apply.',
  }),
  symptomKeys: Type.Array(Type.String(), {
    description: 'Short recall index keys. Not injected later.',
  }),
  evidence: Type.Optional(Type.Object({
    arcId: Type.Optional(Type.String({
      description: 'Runtime-issued arc handle from the reminder, e.g. arc-3.',
    })),
  })),
  docRefs: Type.Optional(Type.Array(Type.Object({
    library: Type.String({ description: 'Documentation library name or id.' }),
    topic: Type.String({ description: 'Topic looked up inside that library.' }),
  }), {
    description: 'Documentation indexes consulted. Pointers only, never document bodies.',
  })),
});

export function createWriteLessonToolDefinition(options: WriteLessonToolOptions) {
  return defineTool({
    name: 'write_lesson',
    label: 'write_lesson',
    description:
      'Record a lesson after you first got something wrong and then corrected it. Cite the issued arcId in evidence.',
    promptSnippet: 'Call write_lesson after a wrong-then-right correction; cite evidence.arcId from the reminder',
    promptGuidelines: [
      WRITE_LESSON_INSTRUCTION,
      WRITE_LESSON_AEVO_GUIDELINE,
    ],
    parameters: schema,
    async execute(
      _toolCallId: string,
      params: WriteLessonInput,
    ): Promise<{ content: Array<{ type: 'text'; text: string }>; details: Record<string, unknown> }> {
      try {
        const memoryDir = options.memoryDir ?? getProjectMemoryDir();
        const arcId = params.evidence?.arcId?.trim();
        const resolved = options.arcRegistry?.resolve(arcId);
        const evidence: LessonEvidence = resolved
          ? {
            errorToolCallId: resolved.errorToolCallId,
            fixToolCallIds: resolved.fixToolCallIds,
            verificationToolCallId: resolved.verificationToolCallId,
          }
          : { errorToolCallId: '', fixToolCallIds: [], verificationToolCallId: '' };
        const draft: ModelAuthoredLessonDraft = {
          whatWentWrong: params.whatWentWrong,
          rootCause: params.rootCause,
          fixMethod: params.fixMethod,
          contrast: params.contrast,
          doNotApplyWhen: params.doNotApplyWhen,
          symptomKeys: params.symptomKeys,
          evidence,
          docRefs: params.docRefs,
          taskId: options.getTaskId?.() ?? 'unknown_task',
          sessionRef: options.getSessionRef?.() ?? 'unknown_session',
          repo: options.repo,
        };
        const created = await LessonsManager.getInstance(memoryDir)
          .recordModelAuthoredLesson(draft, options.sessionEvents);
        if (resolved) options.arcRegistry?.claim(resolved.arcId);
        const details: Record<string, unknown> = { id: created.id, audit: created.audit };
        if (!resolved) {
          details.errorKind = 'audit';
          details.message = arcId
            ? `invalid or expired arcId: ${arcId}`
            : 'missing arcId';
        }
        return {
          content: [{
            type: 'text',
            text: `Recorded lesson ${created.id} (${created.audit}).`,
          }],
          details,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: 'Recorded lesson failed.' }],
          details: { ok: false, ...classifyWriteLessonError(error) },
        };
      }
    },
  });
}

export function recordWriteLessonBeforeToolCall(
  buffer: Array<Record<string, unknown>>,
  event: { toolCallId: string; toolName: string },
): void {
  upsertSessionEvent(buffer, {
    kind: 'tool_call',
    toolCallId: event.toolCallId,
    id: event.toolCallId,
    toolName: event.toolName,
  });
}

export function recordWriteLessonAfterToolCall(
  buffer: Array<Record<string, unknown>>,
  event: { toolCallId: string; toolName: string; isError: boolean; path?: string },
): void {
  if (event.isError) {
    upsertSessionEvent(buffer, {
      kind: 'tool_error',
      toolCallId: event.toolCallId,
      id: event.toolCallId,
      toolName: event.toolName,
      isError: true,
      ...(event.path ? { path: event.path } : {}),
    });
    return;
  }
  upsertSessionEvent(buffer, {
    kind: 'tool_call',
    toolCallId: event.toolCallId,
    id: event.toolCallId,
    toolName: event.toolName,
    exitCode: 0,
    ...(event.path ? { path: event.path } : {}),
  });
}

export function extractToolPath(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const record = args as Record<string, unknown>;
  for (const key of ['path', 'file', 'file_path', 'filePath']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Error → later same-tool or same-file green. One reminder per error id.
 */
export function detectWriteLessonArc(
  buffer: Array<Record<string, unknown>>,
  justCompleted: { toolCallId: string; toolName: string; isError: boolean; path?: string },
  remindedErrorIds: Set<string>,
  registry: LessonArcRegistry,
): string | undefined {
  if (justCompleted.isError) return undefined;
  const error = [...buffer].reverse().find((event) => {
    if (event.isError !== true) return false;
    const errorId = eventToolCallId(event);
    if (!errorId || remindedErrorIds.has(errorId)) return false;
    const sameTool = typeof event.toolName === 'string'
      && event.toolName === justCompleted.toolName;
    const samePath = typeof event.path === 'string'
      && Boolean(justCompleted.path)
      && event.path === justCompleted.path;
    return sameTool || samePath;
  });
  if (!error) return undefined;
  const errorId = eventToolCallId(error);
  if (!errorId) return undefined;
  remindedErrorIds.add(errorId);
  const issued = registry.issue(extractArcEvidence(buffer, errorId, justCompleted.toolCallId));
  return formatWriteLessonArcReminder(issued.arcId);
}

function eventToolCallId(event: Record<string, unknown>): string | undefined {
  if (typeof event.toolCallId === 'string' && event.toolCallId.trim()) return event.toolCallId;
  if (typeof event.id === 'string' && event.id.trim()) return event.id;
  return undefined;
}

function extractArcEvidence(
  buffer: Array<Record<string, unknown>>,
  errorId: string,
  verificationId: string,
): Omit<LessonArcRecord, "arcId"> {
  const errorIndex = buffer.findIndex((event) => eventToolCallId(event) === errorId);
  const verifyIndex = buffer.findIndex((event) => eventToolCallId(event) === verificationId);
  const start = errorIndex >= 0 ? errorIndex + 1 : 0;
  const end = verifyIndex >= 0 ? verifyIndex : buffer.length;
  const fixToolCallIds = buffer.slice(start, end)
    .map(eventToolCallId)
    .filter((id): id is string => Boolean(id));
  return {
    errorToolCallId: errorId,
    fixToolCallIds,
    verificationToolCallId: verificationId,
  };
}

export function classifyWriteLessonError(error: unknown): {
  errorKind: 'io' | 'audit' | 'unknown';
  message: string;
} {
  const message = oneLine(error instanceof Error ? error.message : String(error));
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  if (code.startsWith('ERR_') || /^(E[A-Z]+)$/.test(code) || /\b(ENOENT|EACCES|EPERM|EIO)\b/.test(message)) {
    return { errorKind: 'io', message };
  }
  if (/\baudit\b/i.test(message)) return { errorKind: 'audit', message };
  return { errorKind: 'unknown', message };
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 240);
}

/**
 * Keep one auditor-facing row per toolCallId. A naive push of the before-hook
 * `tool_call` (no exitCode) would win `find()` and fail error/green predicates.
 */
function upsertSessionEvent(
  buffer: Array<Record<string, unknown>>,
  event: Record<string, unknown>,
): void {
  const id = event.toolCallId;
  const index = buffer.findIndex((existing) => existing.toolCallId === id || existing.id === id);
  if (index >= 0) {
    buffer[index] = event;
    return;
  }
  buffer.push(event);
}
