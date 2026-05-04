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

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
