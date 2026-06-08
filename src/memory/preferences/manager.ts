import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { WriteQueue } from '../../core/write-queue.js';
import { getProjectMemoryDir } from '../../core/paths.js';
import type {
  PreferenceEntry,
  PreferenceProvenance,
  PreferenceScope,
  PreferencesFile,
  PreferencesFileHeader,
} from './types.js';

/**
 * PreferencesManager — preferences.md 的唯一读写入口。
 *
 * 双通道：
 *   显式通道 addExplicit()        — 用户直接指令，跳过候选池和 Breaker
 *   隐式通道 promoteFromCandidate() — Reflect Agent 从候选池升级而来
 *
 * 所有写入通过 WriteQueue 串行化。
 * 每次写入前自动创建版本快照到 preferences-history/。
 */
export class PreferencesManager {
  private static instance: PreferencesManager | null = null;
  private readonly filePath: string;
  private readonly historyDir: string;

  private constructor(memoryDir: string) {
    this.filePath = join(memoryDir, 'preferences.md');
    this.historyDir = join(memoryDir, 'preferences-history');
  }

  static getInstance(memoryDir?: string): PreferencesManager {
    const dir = memoryDir ?? getProjectMemoryDir();
    if (!PreferencesManager.instance) {
      PreferencesManager.instance = new PreferencesManager(dir);
    }
    return PreferencesManager.instance;
  }

  /** 仅测试用 */
  static resetInstance(): void {
    PreferencesManager.instance = null;
  }

  // ── 读取 ──────────────────────────────────────────

  async getAll(): Promise<PreferenceEntry[]> {
    const file = await this.readFile();
    return file ? file.preferences : [];
  }

  async getByScope(scope: PreferenceScope): Promise<PreferenceEntry[]> {
    const all = await this.getAll();
    return all.filter((p) => p.scope === scope);
  }

  async getHeader(): Promise<PreferencesFileHeader | null> {
    const file = await this.readFile();
    return file ? file.header : null;
  }

  // ── 显式通道 ──────────────────────────────────────

  /** 用户直接指令写入，跳过候选池和 Breaker */
  async addExplicit(params: {
    rule: string;
    scope: PreferenceScope;
    taskId: string;
    sessionRef: string;
  }): Promise<void> {
    const entry: PreferenceEntry = {
      id: `pref_${randomUUID()}`,
      rule: params.rule,
      scope: params.scope,
      recall: makePreferenceRecall(params.rule, params.scope),
      provenance: {
        source_type: 'user-explicit',
        task_id: params.taskId,
        session_ref: params.sessionRef,
        created_at: new Date().toISOString(),
      },
    };
    const changeSummary = `新增 ${params.scope} 规则（来源：${params.taskId}，显式指令）`;
    await this.appendEntry(entry, changeSummary);
  }

  // ── 隐式通道 ──────────────────────────────────────

  /** 从 preference-candidates 升级写入（被 Reflect Agent 调用） */
  async promoteFromCandidate(params: {
    rule: string;
    scope: PreferenceScope;
    provenance: PreferenceProvenance;
    applyCaution?: boolean;
  }): Promise<void> {
    const entry: PreferenceEntry = {
      id: `pref_${randomUUID()}`,
      rule: params.rule,
      scope: params.scope,
      recall: makePreferenceRecall(params.rule, params.scope),
      provenance: params.provenance,
      apply_caution: params.applyCaution,
    };
    const changeSummary = `新增 ${params.scope} 规则（来源：${params.provenance.task_id}，${params.provenance.source_type}）`;
    await this.appendEntry(entry, changeSummary);
  }

  // ── 内部方法 ──────────────────────────────────────

  private async appendEntry(entry: PreferenceEntry, changeSummary: string): Promise<void> {
    await WriteQueue.getInstance().enqueue(async () => {
      const current = await this.readFile();
      if (current?.preferences.some((p) => p.scope === entry.scope && p.rule === entry.rule)) {
        return;
      }

      const preferences = current ? [...current.preferences, entry] : [entry];
      const version = current ? current.header.version + 1 : 1;

      const file: PreferencesFile = {
        header: {
          version,
          last_updated: new Date().toISOString(),
          change: changeSummary,
        },
        preferences,
      };

      await mkdir(dirname(this.filePath), { recursive: true });
      await this.createVersionSnapshot(version - 1);
      await writeFile(this.filePath, JSON.stringify(file, null, 2), 'utf-8');
    });
  }


  private async readFile(): Promise<PreferencesFile | null> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as PreferencesFile;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') return null;
      console.error(
        '[PreferencesManager] readFile failed:',
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  }

  private async createVersionSnapshot(previousVersion: number): Promise<void> {
    if (previousVersion < 1) return;

    try {
      await readFile(this.filePath, 'utf-8'); // 确认文件存在
    } catch {
      return; // 无文件则无需快照
    }

    await mkdir(this.historyDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotPath = join(this.historyDir, `v${previousVersion}_${timestamp}.json`);
    await copyFile(this.filePath, snapshotPath);
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

function makePreferenceRecall(rule: string, scope: PreferenceScope): PreferenceEntry['recall'] {
  return {
    trigger: {
      scopes: [scope],
      keywords: extractKeywords(rule),
    },
    applicableWhen: [`Applying ${scope} preference`],
    doNotApplyWhen: [`The task is unrelated to ${scope}`],
    tags: [scope],
    updatedAt: new Date().toISOString(),
  };
}

function extractKeywords(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  return [...new Set(tokens)].slice(0, 12);
}
