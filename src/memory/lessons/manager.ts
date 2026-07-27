import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getProjectMemoryDir } from '../../core/paths.js';
import { WriteQueue } from '../../core/write-queue.js';
import {
  findCausalPair,
  type VerificationKind,
} from '../../evals/causal-pair.js';
import {
  extractExecutionEvidence,
  extractFixSummary,
  extractSymptom,
} from '../distill/index.js';
import { readRecentSignals } from '../signals/index.js';
import type { Signal } from '../signals/types.js';
import type { LessonCandidate, LessonCandidateStatus, LessonConfidence } from './types.js';

export interface ObserveRecentSignalsOptions {
  taskId: string;
  sessionRef: string;
  limit?: number;
  /** In-stream exit-0 verification tools (pytest etc.). */
  verificationEvidence?: LessonVerificationEvidence[];
  /** Intermediate tool ops after the error (recovery path) for provisional pairs. */
  operationEvidence?: LessonOperationEvidence[];
  /** Optional external terminator (harness reward=1), same distill fallback. */
  verification?: VerificationKind;
  finalSummary?: string;
  /** Issue/instruction text — preferred symptom source (fidelity v2). */
  taskDescription?: string;
  /** Repository identity for knack schema-v1 ranking; never inferred from cwd. */
  repo?: string;
}

export interface LessonVerificationEvidence {
  toolCallId: string;
  toolName: string;
  exitCode: number;
  completedAt: string;
}

export interface LessonOperationEvidence {
  toolName: string;
  completedAt: string;
  /** Edit / patch summary — φ_exec grounding corpus (fidelity v3). */
  summary?: string;
}

export type SignalObservationOptions = Pick<
  ObserveRecentSignalsOptions,
  | 'taskId'
  | 'sessionRef'
  | 'verificationEvidence'
  | 'operationEvidence'
  | 'verification'
  | 'finalSummary'
  | 'taskDescription'
  | 'repo'
>;

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
    options: SignalObservationOptions,
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

  /** Distill product → main via same findCausalPair gate as distillRunEvents (no provisional). */
  async admitDistilled(options: {
    events: Array<Record<string, unknown> | { line?: number; data: Record<string, unknown> }>;
    verification?: VerificationKind;
    lesson: string;
    sourceSignalId: string;
    taskId: string;
    sessionRef: string;
  }): Promise<LessonCandidate | null> {
    const pair = findCausalPair(options.events, { verification: options.verification });
    if (!pair?.verification) return null;
    const now = new Date().toISOString();
    const candidate: LessonCandidate = {
      id: `lesson_${randomUUID()}`,
      sourceSignalId: options.sourceSignalId,
      lesson: options.lesson,
      trigger: { signalKinds: ['tool_error'], paths: [] },
      applicableWhen: [options.lesson],
      doNotApplyWhen: [],
      evidenceRefs: [options.sourceSignalId],
      severity: 'medium',
      quality: 'high',
      confidence: pair.streamVerified ? 'verified' : 'candidate',
      status: 'observed',
      provenance: {
        taskId: options.taskId,
        sessionRef: options.sessionRef,
        signalId: options.sourceSignalId,
      },
      createdAt: now,
      updatedAt: now,
    };
    await this.append(candidate);
    return candidate;
  }

  /**
   * After harness reward: promote this run's candidate lessons → verified.
   * reward≠1 keeps candidates in place (no delete).
   */
  async promoteCandidatesForRun(options: {
    sessionRef: string;
    reward: number;
    promotedAt?: string;
  }): Promise<{ promoted: number }> {
    return WriteQueue.getInstance().enqueue(async () => {
      const lessons = await this.getAll();
      const now = options.promotedAt ?? new Date().toISOString();
      let promoted = 0;
      const updated = lessons.map((lesson) => {
        if (lesson.confidence !== 'candidate') return lesson;
        if (lesson.provenance.sessionRef !== options.sessionRef) return lesson;
        if (options.reward !== 1) return lesson;
        promoted += 1;
        return {
          ...lesson,
          confidence: 'verified' as const,
          promotedAt: now,
          updatedAt: now,
        };
      });
      if (promoted > 0) {
        await mkdir(dirname(this.filePath), { recursive: true });
        await writeFile(
          this.filePath,
          `${updated.map((lesson) => JSON.stringify(lesson)).join('\n')}\n`,
          'utf-8',
        );
      }
      return { promoted };
    });
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
  options: SignalObservationOptions,
): LessonCandidate {
  const now = new Date().toISOString();
  const path = signal.path ? [signal.path] : [];
  const evidenceRefs = [signal.evidenceRef, signal.toolCallId].filter((value): value is string => Boolean(value));
  const admission = admitSignalCausalPair(signal, options);
  const body = buildLessonBody(signal, options, admission.paired);

  return {
    id: `lesson_${randomUUID()}`,
    sourceSignalId: signal.id,
    lesson: body.lesson,
    repo: options.repo,
    symptom: body.symptom,
    fixSummary: body.fixSummary,
    executionEvidence: body.executionEvidence,
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
    // unpaired → ephemeral; paired → lessons/ (verified if stream, else candidate)
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

/**
 * Paired lessons get the fidelity v2/v3 phrasing ("Symptom: … Fix: …") so the
 * online path reads identically to the audit distiller; unpaired ephemeral
 * notes keep the cheap template text.
 *
 * per SPARK/PDI-2605.09192 · per Honest-Lying-2605.29463
 */
function buildLessonBody(
  signal: Signal,
  options: SignalObservationOptions,
  paired: boolean,
): { lesson: string; symptom?: string; fixSummary?: string; executionEvidence?: string } {
  if (!paired) return { lesson: lessonText(signal) };

  const executionEvidence = extractExecutionEvidence(
    (options.operationEvidence ?? []).map((operation, index) => ({
      line: index,
      data: { toolName: operation.toolName, summary: operation.summary ?? '' },
    })),
  );
  const symptom = extractSymptom({
    verifiedFix: options.finalSummary ?? '',
    fallback: signal.summary,
    events: [{
      line: 0,
      data: { kind: signal.kind, summary: signal.summary, isError: true },
    }],
    taskInstruction: issueLikeInstruction(options.taskDescription),
  });
  const { fix_summary: fixSummary } = extractFixSummary(
    options.finalSummary ?? '',
    options.finalSummary,
    executionEvidence,
  );

  return {
    lesson: `Symptom: ${symptom} Fix: ${fixSummary || '(not extracted)'}`,
    symptom,
    fixSummary: fixSummary || undefined,
    executionEvidence: executionEvidence || undefined,
  };
}

/**
 * Fidelity v2 sources the symptom from the issue text, which only exists when
 * the instruction carries a bug report (SWE `problem_statement`). A one-line
 * interactive task title is a goal, not a symptom, so it must not win the slot.
 */
function issueLikeInstruction(taskDescription?: string): string | undefined {
  const trimmed = taskDescription?.trim();
  if (!trimmed) return undefined;
  return trimmed.includes('\n') || trimmed.length >= 120 ? trimmed : undefined;
}

/** Shared findCausalPair (+ harness fallback + provisional). */
function admitSignalCausalPair(
  signal: Signal,
  options: Pick<
    ObserveRecentSignalsOptions,
    'verificationEvidence' | 'operationEvidence' | 'verification'
  >,
): {
  paired: boolean;
  confidence?: LessonConfidence;
  verification?: LessonCandidate['verification'];
} {
  const evidence = options.verificationEvidence ?? [];
  // Process-noise signals (hashline/import/toolguard) must not enter the main
  // library via provisional recovery or unrelated bash exit-0. Only harness
  // external verification (options.verification) may admit them later.
  if (isProcessNoiseSignal(signal) && !options.verification) {
    return { paired: false };
  }

  const events = buildCausalEventsFromSignal(
    signal,
    evidence,
    options.operationEvidence ?? [],
  );
  const pair = findCausalPair(events, {
    verification: options.verification,
    allowProvisional: true,
  });
  if (!pair) return { paired: false };

  // 流内有证 → verified; 无流内证但 pair 成立（含 harness/provisional）→ candidate
  const confidence: LessonConfidence = pair.streamVerified ? 'verified' : 'candidate';
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
  operations: LessonOperationEvidence[],
): Record<string, unknown>[] {
  const t0 = Date.parse(signal.createdAt);
  const after = (iso: string) => Number.isFinite(t0) && Number.isFinite(Date.parse(iso))
    && Date.parse(iso) >= t0;
  const isErr = signal.kind === 'tool_error' || signal.kind.includes('error');
  const events: Record<string, unknown>[] = [{
    kind: isErr ? 'tool_error' : signal.kind,
    toolName: signal.toolName,
    summary: signal.summary,
    isError: isErr,
  }];
  for (const op of operations.filter((item) => after(item.completedAt))
    .sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt))) {
    events.push({ kind: 'tool_call', toolName: op.toolName, name: op.toolName });
  }
  for (const item of evidence.filter((item) => after(item.completedAt) && item.exitCode === 0)
    .sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt))) {
    events.push({ kind: 'tool_call', toolName: item.toolName, name: item.toolName });
    events.push({ kind: 'verification', exitCode: 0 });
    break;
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

/** Hashline / import / toolguard noise — not verified-fix material. */
export function isProcessNoiseSignal(signal: Signal): boolean {
  if (
    signal.kind === 'toolguard_block'
    || signal.kind === 'hashline_rejection'
    || signal.kind === 'fileguard_block'
  ) {
    return true;
  }
  const summary = signal.summary.toLowerCase();
  return (
    summary.includes('hashline')
    || summary.includes('modulenotfounderror')
    || summary.includes('no module named')
    || summary.includes('traceback (most recent call last)')
    || summary.includes('import error')
    || summary.startsWith('sed:')
  );
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
