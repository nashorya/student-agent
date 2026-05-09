import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { WriteQueue } from '../../core/write-queue.js';
import type {
  PlanRevision,
  PlanRevisionAppendInput,
  PlanRevisionsFile,
} from './types.js';

export class PlanRevisionManager {
  private static instance: PlanRevisionManager | null = null;
  private readonly filePath: string;
  private memStore: PlanRevisionsFile | null = null;

  private constructor(memoryDir: string) {
    this.filePath = memoryDir === ':memory:'
      ? ':memory:'
      : join(memoryDir, 'plan-revisions.json');
  }

  static getInstance(memoryDir?: string): PlanRevisionManager {
    const dir = memoryDir ?? `${process.cwd()}/memory`;
    if (!PlanRevisionManager.instance) {
      PlanRevisionManager.instance = new PlanRevisionManager(dir);
    }
    return PlanRevisionManager.instance;
  }

  static resetInstance(): void {
    PlanRevisionManager.instance = null;
  }

  async getAll(): Promise<PlanRevision[]> {
    const file = await this.readFile();
    return file.revisions;
  }

  async getRecent(limit = 3): Promise<PlanRevision[]> {
    const revisions = await this.getAll();
    return revisions
      .filter((revision) => revision.trust_status !== 'contested')
      .sort((a, b) => b.last_observed.localeCompare(a.last_observed))
      .slice(0, limit);
  }

  async search(query = '', limit = 10): Promise<PlanRevision[]> {
    const needle = query.trim().toLowerCase();
    const revisions = await this.getAll();
    return revisions
      .filter((revision) => {
        if (!needle) return true;
        return [
          revision.agent_plan_summary,
          revision.user_revision_summary,
          revision.reason_inferred,
          revision.diff_type,
        ].join('\n').toLowerCase().includes(needle);
      })
      .sort((a, b) => b.last_observed.localeCompare(a.last_observed))
      .slice(0, limit);
  }

  async append(input: PlanRevisionAppendInput): Promise<PlanRevision> {
    let saved: PlanRevision | null = null;

    await this.write((file) => {
      const now = new Date().toISOString();
      const existing = file.revisions.find((revision) =>
        revision.task_id === input.taskId
        && revision.agent_plan_summary === input.agentPlanSummary
        && revision.user_revision_summary === input.userRevisionSummary
      );

      if (existing) {
        existing.last_observed = now;
        existing.observations += 1;
        existing.trust_status = existing.trust_status === 'user_confirmed'
          ? 'user_confirmed'
          : 'reobserved';
        existing.provenance.push({
          source_type: input.sourceType,
          task_id: input.taskId,
          session_ref: input.sessionRef,
          trust_status: existing.trust_status,
        });
        saved = existing;
        return;
      }

      const revision: PlanRevision = {
        id: `plan_revision_${randomUUID()}`,
        task_id: input.taskId,
        session_ref: input.sessionRef,
        created_at: now,
        last_observed: now,
        observations: 1,
        agent_plan_summary: input.agentPlanSummary,
        user_revision_summary: input.userRevisionSummary,
        diff_type: input.diffType,
        reason_inferred: input.reasonInferred,
        outcome: input.outcome,
        trust_status: input.trustStatus,
        provenance: [
          {
            source_type: input.sourceType,
            task_id: input.taskId,
            session_ref: input.sessionRef,
            trust_status: input.trustStatus,
          },
        ],
      };
      file.revisions.push(revision);
      saved = revision;
    });

    if (!saved) {
      throw new Error('Plan revision append failed');
    }
    return saved;
  }

  async markContested(id: string): Promise<void> {
    await this.write((file) => {
      const revision = file.revisions.find((item) => item.id === id);
      if (revision) {
        revision.trust_status = 'contested';
      }
    });
  }

  private async readFile(): Promise<PlanRevisionsFile> {
    if (this.filePath === ':memory:') {
      return this.memStore ?? { revisions: [] };
    }
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as PlanRevisionsFile;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return { revisions: [] };
      }
      throw err;
    }
  }

  private async write(mutate: (file: PlanRevisionsFile) => void): Promise<void> {
    if (this.filePath === ':memory:') {
      const file = this.memStore ?? { revisions: [] };
      mutate(file);
      this.memStore = file;
      return;
    }

    await WriteQueue.getInstance().enqueue(async () => {
      const file = await this.readFile();
      mutate(file);
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(file, null, 2), 'utf-8');
    });
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
