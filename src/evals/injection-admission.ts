import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WriteQueue } from '../core/write-queue.js';
import type { Knack } from '../memory/knacks/types.js';
import type { LessonCandidate } from '../memory/lessons/types.js';

export interface InjectionAdmissionEntry {
  runId: string;
  taskId: string;
  instanceId: string;
  resolved: boolean;
  recordedAt: string;
}

export interface InjectionMemoryInventory {
  admittedRunIds: string[];
  rejectedRunIds: string[];
  mainLessonIds: string[];
  eligibleLessonIds: string[];
  ephemeralLessonIds: string[];
  knackIds: string[];
  eligibleKnackIds: string[];
}

interface InjectionAdmissionFile {
  version: 1;
  entries: InjectionAdmissionEntry[];
}

const ADMISSION_FILE = 'injection-admission.json';

export async function recordInjectionAdmission(
  memoryDir: string,
  entry: Omit<InjectionAdmissionEntry, 'recordedAt'> & { recordedAt?: string },
): Promise<InjectionAdmissionEntry> {
  const value: InjectionAdmissionEntry = {
    ...entry,
    recordedAt: entry.recordedAt ?? new Date().toISOString(),
  };
  await WriteQueue.getInstance().enqueue(async () => {
    const current = await readAdmissionFile(memoryDir);
    const entries = [
      ...current.entries.filter((item) => item.runId !== value.runId),
      value,
    ].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.runId.localeCompare(b.runId));
    await writeFile(join(memoryDir, ADMISSION_FILE), JSON.stringify({ version: 1, entries }, null, 2));
  });
  return value;
}

export async function readInjectionAdmissions(memoryDir: string): Promise<InjectionAdmissionEntry[]> {
  return (await readAdmissionFile(memoryDir)).entries;
}

export async function readEligibleInjectionRunIds(memoryDir: string): Promise<string[]> {
  return (await readInjectionAdmissions(memoryDir))
    .filter((entry) => entry.resolved)
    .map((entry) => entry.runId)
    .sort();
}

export async function buildInjectionMemoryInventory(memoryDir: string): Promise<InjectionMemoryInventory> {
  const [admissions, main, ephemeral, knacks] = await Promise.all([
    readInjectionAdmissions(memoryDir),
    readJsonl<LessonCandidate>(join(memoryDir, 'lessons.jsonl')),
    readJsonl<LessonCandidate>(join(memoryDir, 'ephemeral', 'lessons.jsonl')),
    readJsonl<Knack>(join(memoryDir, 'knacks.jsonl')),
  ]);
  const admittedRunIds = admissions.filter((entry) => entry.resolved).map((entry) => entry.runId).sort();
  const admitted = new Set(admittedRunIds);
  const eligibleLessons = main.filter((lesson) =>
    lesson.quality === 'high'
    && lesson.status !== 'archived'
    && admitted.has(lesson.provenance.sessionRef),
  );
  const eligibleLessonIds = new Set(eligibleLessons.map((lesson) => lesson.id));
  return {
    admittedRunIds,
    rejectedRunIds: admissions.filter((entry) => !entry.resolved).map((entry) => entry.runId).sort(),
    mainLessonIds: main.map((lesson) => lesson.id).sort(),
    eligibleLessonIds: [...eligibleLessonIds].sort(),
    ephemeralLessonIds: ephemeral.map((lesson) => lesson.id).sort(),
    knackIds: knacks.map((knack) => knack.id).sort(),
    eligibleKnackIds: knacks
      .filter((knack) => eligibleLessonIds.has(knack.lessonCandidateId))
      .map((knack) => knack.id)
      .sort(),
  };
}

async function readAdmissionFile(memoryDir: string): Promise<InjectionAdmissionFile> {
  try {
    const parsed = JSON.parse(await readFile(join(memoryDir, ADMISSION_FILE), 'utf8')) as Partial<InjectionAdmissionFile>;
    return {
      version: 1,
      entries: Array.isArray(parsed.entries) ? parsed.entries.filter(isAdmissionEntry) : [],
    };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return { version: 1, entries: [] };
    throw error;
  }
}

async function readJsonl<T>(path: string): Promise<T[]> {
  try {
    return (await readFile(path, 'utf8')).split(/\r?\n/u).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as T]; } catch { return []; }
    });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return [];
    throw error;
  }
}

function isAdmissionEntry(value: unknown): value is InjectionAdmissionEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<InjectionAdmissionEntry>;
  return typeof entry.runId === 'string'
    && typeof entry.taskId === 'string'
    && typeof entry.instanceId === 'string'
    && typeof entry.resolved === 'boolean'
    && typeof entry.recordedAt === 'string';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
