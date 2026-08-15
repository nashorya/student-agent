import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DescribedTool, ListedTool, ToolStats, ToolboxModule } from './types.js';
import {
  getDefaultExport,
  importToolboxModule,
  validateToolboxModule,
} from './runner.js';

const TOOL_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const DEFAULT_FAILURE_THRESHOLD = 3;
const STATS_FILE = 'stats.json';

interface LoadedEntry {
  name: string;
  description: string;
  params?: Record<string, unknown>;
  stats: ToolStats;
  loadError?: string;
  /** True when the .mjs failed to import/validate. */
  badModule: boolean;
}

function defaultStats(): ToolStats {
  return {
    calls: 0,
    consecutiveFailures: 0,
    lastUsedAt: null,
    disabled: false,
  };
}

function normalizeStats(raw: unknown): ToolStats {
  if (!raw || typeof raw !== 'object') return defaultStats();
  const s = raw as Partial<ToolStats>;
  const stats: ToolStats = {
    calls: typeof s.calls === 'number' ? s.calls : 0,
    consecutiveFailures: typeof s.consecutiveFailures === 'number' ? s.consecutiveFailures : 0,
    lastUsedAt: typeof s.lastUsedAt === 'string' || s.lastUsedAt === null ? s.lastUsedAt : null,
    disabled: Boolean(s.disabled),
  };
  if (typeof s.disabledReason === 'string') {
    stats.disabledReason = s.disabledReason;
  }
  return stats;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * ToolboxRegistry — rebuilds tool state from <memoryDir>/toolbox/ on every load().
 * No in-memory ghost state across instances.
 */
export class ToolboxRegistry {
  private readonly memoryDir: string;
  private readonly toolboxDir: string;
  private readonly statsPath: string;
  private readonly failureThreshold: number;
  private entries = new Map<string, LoadedEntry>();
  private stats = new Map<string, ToolStats>();

  constructor(
    memoryDir: string,
    options?: { failureThreshold?: number },
  ) {
    this.memoryDir = memoryDir;
    this.toolboxDir = join(memoryDir, 'toolbox');
    this.statsPath = join(this.toolboxDir, STATS_FILE);
    this.failureThreshold = options?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
  }

  /** Always rescan disk. Never reuse a previous session's in-memory map. */
  async load(): Promise<void> {
    this.entries = new Map();
    this.stats = await this.readStatsFile();

    let names: string[] = [];
    try {
      const files = await readdir(this.toolboxDir);
      names = files
        .filter((f) => f.endsWith('.mjs'))
        .map((f) => f.slice(0, -'.mjs'.length));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return;
      }
      throw err;
    }

    for (const name of names) {
      if (!TOOL_NAME_RE.test(name)) {
        this.entries.set(name, {
          name,
          description: '',
          stats: this.statsFor(name),
          loadError: `Invalid tool name "${name}" (must match ${TOOL_NAME_RE})`,
          badModule: true,
        });
        continue;
      }

      const filePath = this.toolPath(name);
      try {
        const mod = await importToolboxModule(filePath);
        const tool = validateToolboxModule(getDefaultExport(mod), name);
        const stats = this.statsFor(name);
        this.entries.set(name, {
          name: tool.name,
          description: typeof tool.description === 'string' ? tool.description : '',
          params: tool.params,
          stats,
          badModule: false,
        });
      } catch (err) {
        const stats = this.statsFor(name);
        this.entries.set(name, {
          name,
          description: '',
          stats: { ...stats, disabled: true },
          loadError: errorMessage(err),
          badModule: true,
        });
      }
    }
  }

  list(): ListedTool[] {
    return [...this.entries.values()]
      .map((e) => ({
        name: e.name,
        description: e.description,
        disabled: e.badModule || e.stats.disabled,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  describe(name: string): DescribedTool | undefined {
    const e = this.entries.get(name);
    if (!e) return undefined;
    const out: DescribedTool = {
      name: e.name,
      description: e.description,
      disabled: e.badModule || e.stats.disabled,
      stats: { ...e.stats },
    };
    if (e.params !== undefined) out.params = e.params;
    if (e.loadError !== undefined) out.loadError = e.loadError;
    return out;
  }

  async createTool(name: string, source: string): Promise<void> {
    this.assertValidName(name);
    await this.ensureToolboxDir();
    const filePath = this.toolPath(name);

    try {
      await access(filePath);
      throw new Error(`Tool "${name}" already exists`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    await writeFile(filePath, source, 'utf8');
    try {
      await this.importAndValidate(filePath, name);
    } catch (err) {
      await rm(filePath, { force: true });
      throw err instanceof Error ? err : new Error(errorMessage(err));
    }

    if (!this.stats.has(name)) {
      this.stats.set(name, defaultStats());
    }
    await this.persistStats();
    await this.load();
  }

  async updateTool(name: string, source: string): Promise<void> {
    this.assertValidName(name);
    await this.ensureToolboxDir();
    const filePath = this.toolPath(name);

    let previous: string | null = null;
    let hadPrevious = false;
    try {
      previous = await readFile(filePath, 'utf8');
      hadPrevious = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    await writeFile(filePath, source, 'utf8');
    try {
      await this.importAndValidate(filePath, name);
    } catch (err) {
      if (hadPrevious && previous !== null) {
        await writeFile(filePath, previous, 'utf8');
      } else {
        await rm(filePath, { force: true });
      }
      throw err instanceof Error ? err : new Error(errorMessage(err));
    }

    const stats = this.statsFor(name);
    stats.disabled = false;
    stats.consecutiveFailures = 0;
    delete stats.disabledReason;
    this.stats.set(name, stats);
    await this.persistStats();
    await this.load();
  }

  async disableTool(name: string, reason: string): Promise<void> {
    this.assertValidName(name);
    await this.ensureToolboxDir();
    const stats = this.statsFor(name);
    stats.disabled = true;
    stats.disabledReason = reason;
    this.stats.set(name, stats);
    await this.persistStats();
    await this.load();
  }

  async recordUsage(name: string, ok: boolean): Promise<void> {
    this.assertValidName(name);
    await this.ensureToolboxDir();
    const stats = this.statsFor(name);
    stats.calls += 1;
    stats.lastUsedAt = new Date().toISOString();
    if (ok) {
      stats.consecutiveFailures = 0;
    } else {
      stats.consecutiveFailures += 1;
      if (stats.consecutiveFailures >= this.failureThreshold) {
        stats.disabled = true;
        stats.disabledReason =
          `Auto-disabled after ${stats.consecutiveFailures} consecutive failures`;
      }
    }
    this.stats.set(name, stats);
    await this.persistStats();
    // Refresh in-memory entry stats without full rescan when possible.
    const entry = this.entries.get(name);
    if (entry) {
      entry.stats = { ...stats };
    } else {
      await this.load();
    }
  }

  /** Absolute path to `<memoryDir>/toolbox/<name>.mjs`. */
  toolPath(name: string): string {
    return join(this.toolboxDir, `${name}.mjs`);
  }

  private assertValidName(name: string): void {
    if (!TOOL_NAME_RE.test(name)) {
      throw new Error(
        `Invalid tool name "${name}" (must match /^[A-Za-z][A-Za-z0-9_-]*$/)`,
      );
    }
  }

  private async ensureToolboxDir(): Promise<void> {
    await mkdir(this.toolboxDir, { recursive: true });
  }

  private statsFor(name: string): ToolStats {
    const existing = this.stats.get(name);
    if (existing) {
      return { ...existing };
    }
    return defaultStats();
  }

  private async readStatsFile(): Promise<Map<string, ToolStats>> {
    const map = new Map<string, ToolStats>();
    try {
      const raw = await readFile(this.statsPath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          map.set(key, normalizeStats(value));
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        // Corrupt stats: treat as empty rather than blocking load.
        if (!(err instanceof SyntaxError)) {
          throw err;
        }
      }
    }
    return map;
  }

  private async persistStats(): Promise<void> {
    await this.ensureToolboxDir();
    const obj: Record<string, ToolStats> = {};
    for (const [name, stats] of this.stats.entries()) {
      obj[name] = stats;
    }
    const tmp = `${this.statsPath}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    await rename(tmp, this.statsPath);
  }

  private async importAndValidate(filePath: string, expectedName: string): Promise<ToolboxModule> {
    const mod = await importToolboxModule(filePath);
    return validateToolboxModule(getDefaultExport(mod), expectedName);
  }
}

export type { DescribedTool, ListedTool, ToolStats };
