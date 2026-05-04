import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WriteQueue } from '../core/write-queue.js';

export type QualityRating = 'up' | 'down';

export interface QualityFeedbackEntry {
  id: string;
  task_id: string;
  session_ref: string;
  task_description: string;
  rating: QualityRating;
  comment: string;
  created_at: string;
}

export interface QualityFeedbackFile {
  feedback: QualityFeedbackEntry[];
}

export class QualityFeedbackManager {
  private static instance: QualityFeedbackManager | null = null;
  private readonly filePath: string;

  private constructor(memoryDir: string) {
    this.filePath = join(memoryDir, 'quality-feedback.json');
  }

  static getInstance(memoryDir?: string): QualityFeedbackManager {
    const dir = memoryDir ?? `${process.cwd()}/memory`;
    if (!QualityFeedbackManager.instance) {
      QualityFeedbackManager.instance = new QualityFeedbackManager(dir);
    }
    return QualityFeedbackManager.instance;
  }

  static resetInstance(): void {
    QualityFeedbackManager.instance = null;
  }

  async getAll(): Promise<QualityFeedbackEntry[]> {
    const file = await this.readFile();
    return file?.feedback ?? [];
  }

  async append(entry: Omit<QualityFeedbackEntry, 'id' | 'created_at'>): Promise<QualityFeedbackEntry> {
    const saved: QualityFeedbackEntry = {
      ...entry,
      id: `quality_feedback_${randomUUID()}`,
      created_at: new Date().toISOString(),
    };

    await WriteQueue.getInstance().enqueue(async () => {
      const file = await this.readFile();
      const feedback = file ? [...file.feedback, saved] : [saved];
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify({ feedback }, null, 2), 'utf-8');
    });

    return saved;
  }

  private async readFile(): Promise<QualityFeedbackFile | null> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as QualityFeedbackFile;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }
}

export function shouldRequestFeedback(taskCount: number): boolean {
  return taskCount > 0 && taskCount % 5 === 0;
}

export function parseFeedbackCommand(command: string): {
  rating: QualityRating;
  comment: string;
} | null {
  const match = /^\/feedback\s+(up|down)\s*(.*)$/i.exec(command.trim());
  if (!match) {
    return null;
  }

  return {
    rating: match[1].toLowerCase() as QualityRating,
    comment: match[2]?.trim() ?? '',
  };
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
