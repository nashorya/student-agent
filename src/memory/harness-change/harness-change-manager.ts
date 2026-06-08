import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { getProjectMemoryDir } from '../../core/paths.js';
import { WriteQueue } from '../../core/write-queue.js';
import type {
  CreateHarnessChangeInput,
  HarnessChange,
  HarnessChangeStatus,
} from './types.js';

export interface HarnessChangeManagerOptions {
  memoryDir?: string;
}

export class HarnessChangeManager {
  private readonly filePath: string;

  constructor(options: HarnessChangeManagerOptions = {}) {
    const memoryDir = options.memoryDir ?? getProjectMemoryDir();
    this.filePath = join(memoryDir, 'harness-changes.jsonl');
  }

  async create(input: CreateHarnessChangeInput): Promise<HarnessChange> {
    if (input.regressionRisk.length === 0) {
      throw new Error('regressionRisk must contain at least one risk');
    }

    const now = new Date().toISOString();
    const change: HarnessChange = {
      id: `hc_${randomUUID()}`,
      targetComponent: input.targetComponent,
      rationale: input.rationale,
      prediction: input.prediction,
      regressionRisk: input.regressionRisk,
      expectedMetrics: input.expectedMetrics,
      risk: input.risk,
      runRef: input.runRef,
      traceRefs: input.traceRefs ?? [],
      evalBefore: input.evalBefore,
      status: 'proposed',
      createdAt: now,
    };

    await WriteQueue.getInstance().enqueue(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, JSON.stringify(change) + '\n', 'utf-8');
    });

    return change;
  }

  async markApplied(id: string): Promise<void> {
    await this.update(id, (change) => ({ ...change, status: 'applied' }));
  }

  async verify(id: string, evalAfter: Record<string, number>): Promise<void> {
    await this.update(id, (change) => ({
      ...change,
      evalAfter,
      status: 'verified',
      verifiedAt: new Date().toISOString(),
    }));
  }

  async revert(id: string): Promise<void> {
    await this.update(id, (change) => ({ ...change, status: 'reverted' }));
  }

  async getAll(): Promise<HarnessChange[]> {
    return readChanges(this.filePath);
  }

  async getById(id: string): Promise<HarnessChange | null> {
    return (await this.getAll()).find((change) => change.id === id) ?? null;
  }

  private async update(
    id: string,
    updater: (change: HarnessChange) => HarnessChange,
  ): Promise<void> {
    await WriteQueue.getInstance().enqueue(async () => {
      const changes = await readChanges(this.filePath);
      let found = false;
      const updated = changes.map((change) => {
        if (change.id !== id) return change;
        found = true;
        return updater(change);
      });
      if (!found) throw new Error(`Harness change not found: ${id}`);
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, serializeChanges(updated), 'utf-8');
    });
  }
}

async function readChanges(filePath: string): Promise<HarnessChange[]> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return raw.split('\n').filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line) as HarnessChange];
      } catch {
        return [];
      }
    });
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return [];
    throw err;
  }
}

function serializeChanges(changes: HarnessChange[]): string {
  return changes.map((change) => JSON.stringify(change)).join('\n')
    + (changes.length > 0 ? '\n' : '');
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
