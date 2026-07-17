import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getProjectMemoryDir } from '../../core/paths.js';
import { WriteQueue } from '../../core/write-queue.js';
import {
  findCausalPair,
  type VerificationKind,
} from '../../evals/causal-pair.js';
import { extractFixSummary } from '../../evals/knack-distillation.js';
import { readRecentSignals } from '../signals/index.js';
import type { Signal } from '../signals/types.js';
import type { LessonCandidate, LessonCandidateStatus, LessonConfidence } from './types.js';

export interface ObserveRecentSignalsOptions {
  taskId: string;
  sessionRef: string;
  limit?: number;
  verificationEvidence?: LessonVerificationEvidence[];
  /** Optional external terminator (e.g. harness reward=1), same as distill. */
  verification?: VerificationKind;
  /** Used for fix-summary confidence when paired (shared extractFixSummary). */
  finalSummary?: string;
}

export interface LessonVerificationEvidence {
  toolCallId: string;
  toolName: string;
  exitCode: number;
  completedAt: string;
}

export class LessonsManager {
  private static instance: LessonsManager | null = null;
  private readonly memoryDir: string;
  private readonly filePath: string;
  private readonly ephemeralFilePath: string;

  private constructor(memoryDir: string) {
    this.memoryDir = memoryDir;
    this.filePath = join(memoryDir, 'lessons.jsonl');
    this.ephemeralFilePath = join(memoryDir, 'ephemeral', 'lessons.jsonl');
  }

  static getInstance(memoryDir?: string): LessonsManager {
    const dir = memoryDir ?? getProjectMemoryDir();
    if (!LessonsManager.instance) {
      LessonsManager.instance = new LessonsManager(dir);
    }
    return LessonsManager.instance;
  }

  static resetInstance(): void {
    LessonsManager.instance = null;
  }

  async getAll(): Promise<LessonCandidate[]> {
    return readLessons(this.filePath);
  }

  async getEphemeral(): Promise<LessonCandidate[]> {
    return readLessons(this.ephemeralFilePath);
  }

  async observeRecentSignals(options: ObserveRecentSignalsOptions): Promise<LessonCandidate[]> {
    const signals = await readRecentSignals(options.limit ?? 20, this.memoryDir);
    return this.observeSignals(signals, options);
  }

  async observeSignals(
    signals: Signal[],
    options: Pick<
      ObserveRecentSignalsOptions,
      'taskId' | 'sessionRef' | 'verificationEvidence' | 'verification' | 'finalSummary'
    >,
  ): Promise<LessonCandidate[]> {
    if (signals.length === 0) return [];

    const existing = [
      ...await this.getAll(),
      ...await this.getEphemeral(),
    ];
    const seenSignalIds = new Set(existing.map((lesson) => lesson.sourceSignalId));
    const candidates = signals
      .filter((signal) => !seenSignalIds.has(signal.id))
      .map((signal) => signalToLessonCandidate(signal, options));

    for (const candidate of candidates) {
      await this.append(candidate);
    }

    return candidates;
  }

  async updateStatus(lessonId: string, status: LessonCandidateStatus): Promise<void> {
    await WriteQueue.getInstance().enqueue(async () => {
      const lessons = await this.getAll();
      const now = new Date().toISOString();
      const updated = lessons.map((lesson) =>
        lesson.id === lessonId
          ? { ...lesson, status, updatedAt: now }
          : lesson,
      );
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(
        this.filePath,
        updated.map((lesson) => JSON.stringify(lesson)).join('\n') + (updated.length > 0 ? '\n' : ''),
        'utf-8',
      );
    });
  }

  private async append(candidate: LessonCandidate): Promise<void> {
    const targetPath = candidate.quality === 'low'
      ? this.ephemeralFilePath
      : this.filePath;
    await mkdir(dirname(targetPath), { recursive: true });
    await appendFile(targetPath, JSON.stringify(candidate) + '\n', 'utf-8');
  }
}

function signalToLessonCandidate(
  signal: Signal,
  options: Pick<
    ObserveRecentSignalsOptions,
    'taskId' | 'sessionRef' | 'verificationEvidence' | 'verification' | 'finalSummary'
  >,
): LessonCandidate {
  const now = new Date().toISOString();
  const path = signal.path ? [signal.path] : [];
  const evidenceRefs = [signal.evidenceRef, signal.toolCallId].filter((value): value is string => Boolean(value));
  const admission = admitSignalCausalPair(signal, options);

  return {
    id: `lesson_${randomUUID()}`,
    sourceSignalId: signal.id,
    lesson: lessonText(signal),
    trigger: {
      signalKinds: [signal.kind],
      paths: path,
      toolNames: signal.toolName ? [signal.toolName] : undefined,
      ruleNames: signal.ruleName ? [signal.ruleName] : undefined,
    },
    applicableWhen: applicableWhen(signal),
    doNotApplyWhen: doNotApplyWhen(signal),
    evidenceRefs,
    severity: signal.severity,
    // ADR-003: unpaired → quality low → ephemeral/; paired → lessons/
    quality: admission.paired ? 'high' : 'low',
    confidence: admission.confidence,
    verification: admission.verification,
    status: 'observed',
    provenance: {
      taskId: options.taskId,
      sessionRef: options.sessionRef,
      signalId: signal.id,
    },
    createdAt: now,
    updatedAt: now,
  };
}

/** Signal + later evidence → shared findCausalPair (same predicate as knack distill). */
function admitSignalCausalPair(
  signal: Signal,
  options: Pick<
    ObserveRecentSignalsOptions,
    'verificationEvidence' | 'verification' | 'finalSummary'
  >,
): {
  paired: boolean;
  confidence?: LessonConfidence;
  verification?: LessonCandidate['verification'];
} {
  const evidence = options.verificationEvidence ?? [];
  const events = buildCausalEventsFromSignal(signal, evidence);
  const pair = findCausalPair(events, { verification: options.verification });
  if (!pair) return { paired: false };

  const actionSequence = pair.operationIndices
    .map((i) => {
      const e = events[i];
      return (typeof e.toolName === 'string' && e.toolName)
        || (typeof e.name === 'string' && e.name)
        || 'tool';
    })
    .join(' -> ');
  const verifiedFix = `Tool sequence: ${actionSequence}.${
    options.finalSummary ? ` ${options.finalSummary}` : ''
  }`.trim();
  const { confidence } = extractFixSummary(verifiedFix, options.finalSummary);
  const successful = evidence
    .filter((item) => item.exitCode === 0)
    .sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt))
    .at(0);

  return {
    paired: true,
    confidence,
    verification: signal.toolCallId && successful
      ? {
        sourceToolCallId: signal.toolCallId,
        successfulToolCallId: successful.toolCallId,
        toolName: successful.toolName,
        exitCode: 0,
        completedAt: successful.completedAt,
      }
      : undefined,
  };
}

function buildCausalEventsFromSignal(
  signal: Signal,
  evidence: LessonVerificationEvidence[],
): Record<string, unknown>[] {
  const t0 = Date.parse(signal.createdAt);
  const later = evidence
    .filter((item) => Number.isFinite(t0) && Number.isFinite(Date.parse(item.completedAt))
      && Date.parse(item.completedAt) >= t0)
    .sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt));
  const isErr = signal.kind === 'tool_error' || signal.kind.includes('error');
  const events: Record<string, unknown>[] = [{
    kind: isErr ? 'tool_error' : signal.kind,
    toolName: signal.toolName,
    summary: signal.summary,
    isError: isErr,
  }];
  for (const item of later) {
    if (item.exitCode === 0) {
      events.push({ kind: 'tool_call', toolName: item.toolName, name: item.toolName });
      events.push({ kind: 'verification', exitCode: 0 });
      break;
    }
    events.push({
      kind: 'tool_call',
      toolName: item.toolName,
      name: item.toolName,
      exitCode: item.exitCode,
    });
  }
  return events;
}

async function readLessons(path: string): Promise<LessonCandidate[]> {
  try {
    const raw = await readFile(path, 'utf-8');
    return raw.split('\n').filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line) as LessonCandidate];
      } catch {
        return [];
      }
    });
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return [];
    throw err;
  }
}

function lessonText(signal: Signal): string {
  switch (signal.kind) {
    case 'hashline_rejection':
      return `Avoid repeating stale edits after ${signal.summary}`;
    case 'tool_error':
      return `Treat tool error as a retry pattern: ${signal.summary}`;
    case 'toolguard_block':
      return `Avoid tool usage blocked by ToolGuard: ${signal.summary}`;
    case 'fileguard_block':
      return `Avoid file access blocked by FileGuard: ${signal.summary}`;
    case 'hashline_recovery':
      return `Prefer the recovery path that worked: ${signal.summary}`;
    case 'user_correction':
      return `Preserve user correction: ${signal.summary}`;
    case 'turn_intake_degraded':
      return `Refresh task context when turn intake degrades: ${signal.summary}`;
    case 'lostness_hard':
      return `Recover immediately from hard lostness: ${signal.summary}`;
    case 'lostness_soft':
      return `Adjust strategy after soft lostness: ${signal.summary}`;
  }
}

function applicableWhen(signal: Signal): string[] {
  if (signal.kind === 'hashline_rejection') return ['Editing a file after a stale hashline rejection'];
  if (signal.toolName) return [`Using ${signal.toolName}`];
  return [`Signal kind is ${signal.kind}`];
}

function doNotApplyWhen(signal: Signal): string[] {
  if (signal.kind === 'hashline_rejection') return ['No file edit is being retried'];
  if (signal.kind === 'toolguard_block') return ['A hard ToolGuard rule already blocks the action'];
  return ['The triggering context is absent'];
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
