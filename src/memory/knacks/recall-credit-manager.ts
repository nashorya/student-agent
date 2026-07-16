import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getProjectMemoryDir } from '../../core/paths.js';
import { WriteQueue } from '../../core/write-queue.js';
import type { Knack } from './types.js';

export type RecallVerificationStatus = 'pending' | 'passed' | 'failed';

export interface RecallCreditResult {
  creditedIds: string[];
  duplicateIds: string[];
  missingIds: string[];
}

export class RecallCreditManager {
  private readonly memoryDir: string;

  constructor(options: { memoryDir?: string } = {}) {
    this.memoryDir = options.memoryDir ?? getProjectMemoryDir();
  }

  async apply(input: {
    taskId: string;
    runId: string;
    verificationStatus: RecallVerificationStatus;
    verificationRef: string;
    usedRecallIds: string[];
  }): Promise<RecallCreditResult> {
    if (input.verificationStatus !== 'passed' || input.usedRecallIds.length === 0) {
      return { creditedIds: [], duplicateIds: [], missingIds: [] };
    }

    return WriteQueue.getInstance().enqueue(async () => {
      const knackPath = join(this.memoryDir, 'knacks.jsonl');
      const ledgerPath = join(this.memoryDir, 'recall-credits.json');
      const [knacks, ledger] = await Promise.all([
        readJsonl<Knack>(knackPath),
        readJson<{ keys?: string[] }>(ledgerPath),
      ]);
      const byId = new Map(knacks.map((knack) => [knack.id, knack]));
      const keys = new Set(ledger?.keys ?? []);
      const creditedIds: string[] = [];
      const duplicateIds: string[] = [];
      const missingIds: string[] = [];

      for (const id of [...new Set(input.usedRecallIds)].sort()) {
        const knack = byId.get(id);
        if (!knack) {
          missingIds.push(id);
          continue;
        }
        const key = [id, input.taskId, input.runId, input.verificationRef].join(':');
        if (keys.has(key) || knack.creditedUseKeys?.includes(key)) {
          duplicateIds.push(id);
          continue;
        }
        keys.add(key);
        creditedIds.push(id);
        byId.set(id, {
          ...knack,
          reuseCount: (knack.reuseCount ?? 0) + 1,
          lastSucceededTask: input.taskId,
          creditedUseKeys: [...new Set([...(knack.creditedUseKeys ?? []), key])].sort(),
          updatedAt: new Date().toISOString(),
        });
      }

      if (creditedIds.length > 0) {
        await mkdir(this.memoryDir, { recursive: true });
        await atomicWrite(knackPath, [...byId.values()].map((knack) => JSON.stringify(knack)).join('\n') + '\n');
        await atomicWrite(ledgerPath, JSON.stringify({ keys: [...keys].sort() }, null, 2));
      }
      return { creditedIds, duplicateIds, missingIds };
    });
  }
}

async function readJsonl<T>(path: string): Promise<T[]> {
  try {
    return (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as T]; } catch { return []; }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, path);
}
