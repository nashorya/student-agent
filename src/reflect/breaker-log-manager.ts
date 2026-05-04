import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WriteQueue } from '../core/write-queue.js';
import type { CandidateBreakerReport } from '../memory/candidates/types.js';

export interface BreakerLogEntry {
  task_id: string;
  candidate_id: string;
  report: CandidateBreakerReport;
}

export class BreakerLogManager {
  private readonly logDir: string;

  constructor(memoryDir: string) {
    this.logDir = join(memoryDir, 'breaker-logs');
  }

  async append(entry: BreakerLogEntry): Promise<void> {
    await WriteQueue.getInstance().enqueue(async () => {
      await mkdir(this.logDir, { recursive: true });
      const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}-${entry.task_id}-${entry.candidate_id}.json`;
      await writeFile(join(this.logDir, filename), JSON.stringify(entry, null, 2), 'utf-8');
    });
  }
}
