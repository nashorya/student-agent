import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getProjectCwd, getProjectMemoryDir } from '../../core/paths.js';
import {
  SESSION_FILE_VERSION,
  type SessionIndexEntry,
  type SessionIndexFile,
  type SessionMessage,
  type StudentSessionFile,
} from './types.js';

const INDEX_NAME = 'index.json';

function sessionsDir(memoryDir: string): string {
  return join(memoryDir, 'sessions');
}

function sessionPath(memoryDir: string, id: string): string {
  return join(sessionsDir(memoryDir), `${id}.json`);
}

function indexPath(memoryDir: string): string {
  return join(sessionsDir(memoryDir), INDEX_NAME);
}

function allocSessionId(): string {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const rand = Math.random().toString(36).slice(2, 8);
  return `session_${ts}_${rand}`;
}

function previewFromMessages(messages: SessionMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind === 'user' || m.kind === 'assistant') {
      const oneLine = m.content.replace(/\s+/g, ' ').trim();
      return oneLine.length > 80 ? `${oneLine.slice(0, 77)}…` : oneLine;
    }
  }
  return '';
}

function nameFromMessages(messages: SessionMessage[], fallback: string): string {
  const user = messages.find((m) => m.kind === 'user' && m.content.trim());
  if (!user) return fallback;
  const oneLine = user.content.replace(/\s+/g, ' ').trim();
  return oneLine.length > 48 ? `${oneLine.slice(0, 45)}…` : oneLine;
}

function toIndexEntry(session: StudentSessionFile): SessionIndexEntry {
  return {
    id: session.id,
    name: session.name,
    created_at: session.created_at,
    updated_at: session.updated_at,
    task_id: session.task_id,
    message_count: session.messages.length,
    preview: previewFromMessages(session.messages),
  };
}

function emptyIndex(): SessionIndexFile {
  return { version: 1, current_id: null, sessions: [] };
}

function formatSessionWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/** CLI-only hint after TUI exits (session id is not shown inside the product UI). */
export function formatSessionExitHint(session: {
  id: string;
  name?: string;
} | null | undefined): string | null {
  if (!session?.id) return null;
  const label = session.name && session.name !== 'untitled' ? `「${session.name}」` : '';
  return [
    `已退出${label}。`,
    `session id：${session.id}`,
  ].join(' ');
}

/**
 * Disk-backed interactive sessions under `{memoryDir}/sessions/`.
 * Each /new or TUI launch creates a new `session_*.json`; old files remain.
 */
export class SessionStore {
  private readonly memoryDir: string;
  private current: StudentSessionFile | null = null;

  constructor(memoryDir?: string) {
    this.memoryDir = memoryDir ?? getProjectMemoryDir();
  }

  get currentSession(): StudentSessionFile | null {
    return this.current;
  }

  get currentId(): string | null {
    return this.current?.id ?? null;
  }

  private async ensureDir(): Promise<void> {
    await mkdir(sessionsDir(this.memoryDir), { recursive: true });
  }

  private async readIndex(): Promise<SessionIndexFile> {
    try {
      const raw = await readFile(indexPath(this.memoryDir), 'utf8');
      const parsed = JSON.parse(raw) as SessionIndexFile;
      if (!parsed || !Array.isArray(parsed.sessions)) return emptyIndex();
      return {
        version: 1,
        current_id: parsed.current_id ?? null,
        sessions: parsed.sessions,
      };
    } catch {
      return emptyIndex();
    }
  }

  private async writeIndex(index: SessionIndexFile): Promise<void> {
    await this.ensureDir();
    await writeFile(indexPath(this.memoryDir), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  }

  private async upsertIndex(session: StudentSessionFile, makeCurrent: boolean): Promise<void> {
    const index = await this.readIndex();
    const entry = toIndexEntry(session);
    const without = index.sessions.filter((s) => s.id !== session.id);
    without.unshift(entry);
    // Keep a bounded recent list in the index (files themselves stay on disk).
    index.sessions = without.slice(0, 100);
    if (makeCurrent) index.current_id = session.id;
    await this.writeIndex(index);
  }

  async createSession(options?: { name?: string; cwd?: string }): Promise<StudentSessionFile> {
    const now = new Date().toISOString();
    const session: StudentSessionFile = {
      version: SESSION_FILE_VERSION,
      id: allocSessionId(),
      name: options?.name?.trim() || 'untitled',
      created_at: now,
      updated_at: now,
      cwd: options?.cwd ?? getProjectCwd(),
      task_id: null,
      messages: [],
    };
    await this.ensureDir();
    await writeFile(sessionPath(this.memoryDir, session.id), `${JSON.stringify(session, null, 2)}\n`, 'utf8');
    await this.upsertIndex(session, true);
    this.current = session;
    return session;
  }

  async loadSession(id: string): Promise<StudentSessionFile | null> {
    try {
      const raw = await readFile(sessionPath(this.memoryDir, id), 'utf8');
      const session = JSON.parse(raw) as StudentSessionFile;
      if (!session?.id || !Array.isArray(session.messages)) return null;
      this.current = session;
      await this.upsertIndex(session, true);
      return session;
    } catch {
      return null;
    }
  }

  /**
   * Resolve by exact id, id prefix, or case-insensitive name / preview substring.
   */
  async resolveSession(query: string): Promise<StudentSessionFile | null> {
    const q = query.trim();
    if (!q) return null;

    if (await this.fileExists(q)) {
      return this.loadSession(q);
    }

    const index = await this.readIndex();
    const byPrefix = index.sessions.find((s) => s.id === q || s.id.startsWith(q) || s.id.includes(q));
    if (byPrefix) return this.loadSession(byPrefix.id);

    const lowered = q.toLowerCase();
    const byName = index.sessions.find(
      (s) => s.name.toLowerCase() === lowered || s.name.toLowerCase().includes(lowered),
    );
    if (byName) return this.loadSession(byName.id);

    // Fall back to scanning files not yet in index.
    const files = await this.listSessionFiles();
    for (const id of files) {
      if (id.includes(q)) {
        const loaded = await this.loadSession(id);
        if (loaded) return loaded;
      }
    }
    return null;
  }

  async listSessions(limit = 20): Promise<SessionIndexEntry[]> {
    const index = await this.readIndex();
    if (index.sessions.length > 0) {
      return index.sessions.slice(0, limit);
    }
    // Rebuild index from files if empty.
    const ids = await this.listSessionFiles();
    const entries: SessionIndexEntry[] = [];
    for (const id of ids.slice(0, limit)) {
      const session = await this.readSessionFile(id);
      if (session) entries.push(toIndexEntry(session));
    }
    entries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return entries;
  }

  async saveMessages(messages: SessionMessage[]): Promise<void> {
    if (!this.current) return;
    const mapped: SessionMessage[] = messages.map((m) => ({
      id: m.id,
      kind: m.kind,
      content: m.content,
      timestamp: m.timestamp,
      ...(m.meta ? { meta: m.meta } : {}),
    }));
    this.current.messages = mapped;
    this.current.updated_at = new Date().toISOString();
    if (this.current.name === 'untitled') {
      this.current.name = nameFromMessages(mapped, 'untitled');
    }
    await this.flushCurrent();
  }

  async bindTask(taskId: string | null): Promise<void> {
    if (!this.current) return;
    this.current.task_id = taskId;
    this.current.updated_at = new Date().toISOString();
    await this.flushCurrent();
  }

  async rename(name: string): Promise<void> {
    if (!this.current) return;
    this.current.name = name.trim() || this.current.name;
    this.current.updated_at = new Date().toISOString();
    await this.flushCurrent();
  }

  /**
   * Human-facing list for TUI / help (Codex-style: no session id in-product).
   * Ids stay on disk; they are printed to the CLI only after exit.
   */
  formatList(entries: SessionIndexEntry[], currentId?: string | null): string {
    if (entries.length === 0) return '（暂无历史会话）';
    return entries.map((e) => {
      const mark = e.id === currentId ? '● ' : '  ';
      const when = formatSessionWhen(e.updated_at);
      const preview = e.preview ? ` — ${e.preview}` : '';
      return `${mark}${e.name} · ${e.message_count} msgs · ${when}${preview}`;
    }).join('\n');
  }

  private async flushCurrent(): Promise<void> {
    if (!this.current) return;
    await this.ensureDir();
    await writeFile(
      sessionPath(this.memoryDir, this.current.id),
      `${JSON.stringify(this.current, null, 2)}\n`,
      'utf8',
    );
    await this.upsertIndex(this.current, true);
  }

  private async readSessionFile(id: string): Promise<StudentSessionFile | null> {
    try {
      const raw = await readFile(sessionPath(this.memoryDir, id), 'utf8');
      const session = JSON.parse(raw) as StudentSessionFile;
      if (!session?.id || !Array.isArray(session.messages)) return null;
      return session;
    } catch {
      return null;
    }
  }

  private async fileExists(id: string): Promise<boolean> {
    try {
      await readFile(sessionPath(this.memoryDir, id), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  private async listSessionFiles(): Promise<string[]> {
    try {
      const names = await readdir(sessionsDir(this.memoryDir));
      return names
        .filter((n) => n.startsWith('session_') && n.endsWith('.json'))
        .map((n) => n.replace(/\.json$/, ''))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }
}
