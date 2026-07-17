import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type PendingArchiveActionType = 'create_adr' | 'update_adr' | 'accept_adr' | 'create_bug' | 'update_bug' | 'append_index';
export interface PendingArchiveActionInput {
  key: string;
  taskId: string;
  type: PendingArchiveActionType;
  entityId?: string;
  payload: Record<string, unknown>;
}
export interface PendingArchiveAction extends PendingArchiveActionInput {
  status: 'pending' | 'applied' | 'failed';
  createdAt: string;
}

export class PendingArchiveActionStore {
  private readonly path: string;
  constructor(root: string) { this.path = join(root, 'memory', 'archive-actions.json'); }

  async stage(input: PendingArchiveActionInput): Promise<PendingArchiveAction> {
    const actions = await this.read();
    const existing = actions.find((item) => item.key === input.key);
    if (existing) return existing;
    const action: PendingArchiveAction = { ...input, status: 'pending', createdAt: new Date().toISOString() };
    actions.push(action);
    await this.write(actions);
    return action;
  }

  async list(taskId?: string): Promise<PendingArchiveAction[]> {
    const actions = await this.read();
    return taskId ? actions.filter((item) => item.taskId === taskId) : actions;
  }

  async markApplied(keys: string[]): Promise<void> {
    const keySet = new Set(keys);
    const actions = await this.read();
    for (const action of actions) if (keySet.has(action.key)) action.status = 'applied';
    await this.write(actions);
  }

  private async read(): Promise<PendingArchiveAction[]> {
    try { return JSON.parse(await readFile(this.path, 'utf8')) as PendingArchiveAction[]; }
    catch (error) { if (isMissing(error)) return []; throw error; }
  }

  private async write(actions: PendingArchiveAction[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(actions, null, 2)}\n`, 'utf8');
    await rename(temporary, this.path);
  }
}

function isMissing(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'; }
