import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { WriteQueue } from '../../core/write-queue.js';
import type { ProjectKbEntry, ProjectKbFile } from './types.js';

const DEFAULT_TTL_DAYS = 14;

export class ProjectKbManager {
  private static instance: ProjectKbManager | null = null;
  private readonly filePath: string;

  private constructor(memoryDir: string) {
    this.filePath = join(memoryDir, 'project-kb.json');
  }

  static getInstance(memoryDir?: string): ProjectKbManager {
    const dir = memoryDir ?? `${process.cwd()}/memory`;
    if (!ProjectKbManager.instance) {
      ProjectKbManager.instance = new ProjectKbManager(dir);
    }
    return ProjectKbManager.instance;
  }

  static resetInstance(): void {
    ProjectKbManager.instance = null;
  }

  async getFresh(limit = 5, now = new Date()): Promise<ProjectKbEntry[]> {
    const entries = await this.getAll();
    return entries
      .filter((entry) => entry.trust_status === 'cached' && !isExpired(entry, now))
      .slice(-limit);
  }

  async getAll(): Promise<ProjectKbEntry[]> {
    return (await this.readFile()).entries;
  }

  async upsert(params: {
    sourceUrl: string;
    title: string;
    content: string;
    versionHint?: string;
    ttlDays?: number;
    trustStatus?: ProjectKbEntry['trust_status'];
    now?: Date;
  }): Promise<ProjectKbEntry> {
    return WriteQueue.getInstance().enqueue(async () => {
      const file = await this.readFile();
      const now = (params.now ?? new Date()).toISOString();
      const existingIndex = file.entries.findIndex((entry) => entry.source_url === params.sourceUrl);
      const entry: ProjectKbEntry = {
        id: existingIndex >= 0 ? file.entries[existingIndex].id : `project_kb_${randomUUID()}`,
        source_url: params.sourceUrl,
        title: params.title,
        content: params.content,
        retrieved_at: now,
        version_hint: params.versionHint,
        ttl_days: params.ttlDays ?? DEFAULT_TTL_DAYS,
        trust_status: params.trustStatus ?? 'cached',
      };

      const entries = existingIndex >= 0
        ? file.entries.map((item, index) => index === existingIndex ? entry : item)
        : [...file.entries, entry];
      await this.writeFile({ entries });
      return entry;
    });
  }

  private async readFile(): Promise<ProjectKbFile> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf-8')) as ProjectKbFile;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') return { entries: [] };
      throw err;
    }
  }

  private async writeFile(file: ProjectKbFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(file, null, 2), 'utf-8');
  }
}

function isExpired(entry: ProjectKbEntry, now: Date): boolean {
  const retrieved = Date.parse(entry.retrieved_at);
  if (!Number.isFinite(retrieved)) return true;
  const ageMs = now.getTime() - retrieved;
  return ageMs > entry.ttl_days * 24 * 60 * 60 * 1000;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
