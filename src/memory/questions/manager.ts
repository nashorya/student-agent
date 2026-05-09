import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Question, QuestionsFile } from './types.js';
import { WriteQueue } from '../../core/write-queue.js';

export class QuestionsManager {
  private static instance: QuestionsManager | null = null;
  private readonly filePath: string;

  private constructor(memoryDir: string) {
    this.filePath = `${memoryDir}/questions.json`;
  }

  static getInstance(memoryDir?: string): QuestionsManager {
    const dir = memoryDir ?? `${process.cwd()}/memory`;
    if (!QuestionsManager.instance) {
      QuestionsManager.instance = new QuestionsManager(dir);
    }
    return QuestionsManager.instance;
  }

  static resetInstance(): void {
    QuestionsManager.instance = null;
  }

  async getAll(): Promise<Question[]> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as QuestionsFile;
      return parsed.questions;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') return [];
      console.error('[QuestionsManager] getAll failed:', err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  async append(q: Question): Promise<void> {
    try {
      await WriteQueue.getInstance().enqueue(async () => {
        const questions = await this.readAll();
        const existing = questions.findIndex((x) => x.id === q.id);
        if (existing >= 0) {
          questions[existing] = {
            ...questions[existing],
            hit_count: (questions[existing].hit_count ?? 0) + 1,
            last_hit: new Date().toISOString(),
          };
        } else {
          questions.push(q);
        }
        await this.writeRaw(questions);
      });
    } catch (err) {
      console.error('[QuestionsManager] append failed:', err instanceof Error ? err.message : String(err));
    }
  }

  async resolve(id: string, resolution: string): Promise<void> {
    try {
      await WriteQueue.getInstance().enqueue(async () => {
        const questions = await this.readAll();
        const idx = questions.findIndex((q) => q.id === id);
        if (idx >= 0) {
          questions[idx] = {
            ...questions[idx],
            resolution,
            resolved_at: new Date().toISOString(),
            status: 'resolved',
          };
          await this.writeRaw(questions);
        }
      });
    } catch (err) {
      console.error('[QuestionsManager] resolve failed:', err instanceof Error ? err.message : String(err));
    }
  }

  async findByError(errorType: string, errorSubtype: string): Promise<Question[]> {
    try {
      const questions = await this.getAll();
      return questions.filter(
        (q) => q.error_type === errorType && q.error_subtype === errorSubtype,
      );
    } catch (err) {
      console.error('[QuestionsManager] findByError failed:', err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  async archiveStaleResolved(params: {
    now?: Date;
    baseDays?: number;
  } = {}): Promise<number> {
    const now = params.now ?? new Date();
    const baseDays = params.baseDays ?? 90;
    return WriteQueue.getInstance().enqueue(async () => {
      const questions = await this.readAll();
      let archived = 0;
      const updated = questions.map((question) => {
        if (question.status !== 'resolved') return question;
        const decay = question.decay_factor ?? decayFactorForQuestion(question);
        const thresholdDays = baseDays * decay;
        if (daysSince(question.last_hit || question.resolved_at, now) <= thresholdDays) {
          return { ...question, decay_factor: decay };
        }
        archived++;
        return { ...question, status: 'stale' as const, decay_factor: decay };
      });
      if (archived > 0) {
        await this.writeRaw(updated);
      }
      return archived;
    });
  }

  private async readAll(): Promise<Question[]> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as QuestionsFile;
      return parsed.questions;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') return [];
      throw err;
    }
  }

  private async writeRaw(questions: Question[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const file: QuestionsFile = { questions };
    await writeFile(this.filePath, JSON.stringify(file, null, 2), 'utf-8');
  }
}

function decayFactorForQuestion(question: Question): number {
  if (question.error_type === 'security') return 2;
  if (question.error_type === 'architecture') return 1.5;
  if (question.hit_count >= 3) return 1.25;
  return 1;
}

function daysSince(value: string | undefined, now: Date): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - timestamp) / (24 * 60 * 60 * 1000);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
