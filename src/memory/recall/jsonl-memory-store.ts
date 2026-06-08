import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getProjectMemoryDir } from '../../core/paths.js';
import { WriteQueue } from '../../core/write-queue.js';
import type { Knack } from '../knacks/index.js';
import type { PreferenceEntry, PreferencesFile } from '../preferences/types.js';
import type { TaskOutcome, WorkingMemorySnapshot } from '../run-archive/types.js';
import type {
  DocFinding,
  MemoryRecallResult,
  MemoryStore,
  RecallIndex,
  RecallIndexEntry,
  RecallMetadata,
  RecallQuery,
  RecallQueryMetadataFilter,
  RecallableMemoryItem,
} from './types.js';
import { scoreRecallItem, type ScoringContext } from './scoring.js';

export interface JsonlMemoryStoreOptions {
  memoryDir?: string;
  readOnly?: boolean;
}

const DEFAULT_LIMIT = 8;

export class JsonlMemoryStore implements MemoryStore {
  private readonly memoryDir: string;
  private readonly indexPath: string;
  private readonly readOnly: boolean;

  constructor(options: JsonlMemoryStoreOptions = {}) {
    this.memoryDir = options.memoryDir ?? getProjectMemoryDir();
    this.indexPath = join(this.memoryDir, 'recall-index.json');
    this.readOnly = options.readOnly ?? false;
  }

  async refreshIndex(): Promise<RecallIndex> {
    const items = await this.loadItems();
    const index = makeIndex(items, this.memoryDir);
    if (!this.readOnly) {
      await WriteQueue.getInstance().enqueue(async () => {
        await mkdir(dirname(this.indexPath), { recursive: true });
        await writeFile(this.indexPath, JSON.stringify(index, null, 2), 'utf-8');
      });
    }
    return index;
  }

  async search(query: RecallQuery, context: ScoringContext = {
    tier: 'standard',
    now: new Date(),
  }): Promise<MemoryRecallResult[]> {
    const items = await this.loadItems();
    const index = makeIndex(items, this.memoryDir);
    if (!this.readOnly) {
      await WriteQueue.getInstance().enqueue(async () => {
        await mkdir(dirname(this.indexPath), { recursive: true });
        await writeFile(this.indexPath, JSON.stringify(index, null, 2), 'utf-8');
      });
    }

    return items
      .filter((item) => matchesMetadataFilter(item, query.metadata))
      .map((item) => ({
        item,
        score: scoreRecallItem(item, query, context),
      }))
      .filter((result) => result.score.total > 0 || hasActiveFilter(query))
      .sort((a, b) => b.score.total - a.score.total)
      .slice(0, query.limit ?? DEFAULT_LIMIT);
  }

  async loadTaskSnapshots(options: {
    limit?: number;
    excludeRunIds?: string[];
    excludeTaskIds?: string[];
  } = {}): Promise<RecallableMemoryItem[]> {
    const runsDir = join(this.memoryDir, 'runs');
    const excludeRunIds = new Set(options.excludeRunIds ?? []);
    const excludeTaskIds = new Set(options.excludeTaskIds ?? []);
    const outcomes = await readRunOutcomes(runsDir);

    return outcomes
      .filter((outcome) => Boolean(outcome.wmSnapshot))
      .filter((outcome) => !excludeRunIds.has(outcome.runId))
      .filter((outcome) => !excludeTaskIds.has(outcome.taskId))
      .sort((a, b) => timestampOf(b.wmSnapshot?.createdAt ?? b.createdAt) - timestampOf(a.wmSnapshot?.createdAt ?? a.createdAt))
      .slice(0, options.limit ?? 100)
      .map((outcome) => snapshotToMemoryItem(outcome.wmSnapshot as WorkingMemorySnapshot));
  }

  private async loadItems(): Promise<RecallableMemoryItem[]> {
    const [knacks, preferences, docFindings] = await Promise.all([
      this.loadKnacks(),
      this.loadPreferences(),
      this.loadDocFindings(),
    ]);
    return [...knacks, ...preferences, ...docFindings];
  }

  private async loadKnacks(): Promise<RecallableMemoryItem[]> {
    const knacks = await readJsonl<Knack>(join(this.memoryDir, 'knacks.jsonl'));
    return knacks.map((knack) => ({
      id: knack.id,
      kind: 'knack',
      summary: knack.summary,
      recall: knack.recall,
      metadata: {
        status: knack.status,
        tags: knack.recall.tags,
        createdAt: knack.createdAt,
        updatedAt: knack.updatedAt,
        evidenceRefs: knack.evidenceRefs,
      },
      payload: knack,
    }));
  }

  private async loadPreferences(): Promise<RecallableMemoryItem[]> {
    const file = await readJson<PreferencesFile>(join(this.memoryDir, 'preferences.md'));
    return (file?.preferences ?? []).map((preference) => ({
      id: preference.id,
      kind: 'preference',
      summary: preference.rule,
      recall: preference.recall ?? makePreferenceRecall(preference),
      metadata: {
        scope: preference.scope,
        tags: preference.recall?.tags ?? [preference.scope],
        createdAt: preference.provenance.created_at,
        updatedAt: preference.recall?.updatedAt,
      },
      payload: preference,
    }));
  }

  private async loadDocFindings(): Promise<RecallableMemoryItem[]> {
    const findings = await readJsonl<DocFinding>(join(this.memoryDir, 'doc-findings.jsonl'));
    return findings.map((finding) => ({
      id: finding.id,
      kind: 'doc_finding',
      summary: finding.summary,
      recall: finding.recall,
      metadata: {
        source: finding.source,
        tags: finding.recall.tags,
        createdAt: finding.createdAt,
        updatedAt: finding.updatedAt,
        evidenceRefs: finding.evidenceRefs,
      },
      payload: finding,
    }));
  }
}

async function readRunOutcomes(runsDir: string): Promise<TaskOutcome[]> {
  try {
    const entries = await readdir(runsDir, { withFileTypes: true });
    const outcomes: TaskOutcome[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const outcome = await readJson<TaskOutcome>(join(runsDir, entry.name, 'outcome.json'));
      if (outcome) outcomes.push(outcome);
    }
    return outcomes;
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return [];
    throw err;
  }
}

function snapshotToMemoryItem(snapshot: WorkingMemorySnapshot): RecallableMemoryItem {
  const fileSummary = snapshot.keyFiles.slice(0, 3).map((file) => file.path).join(', ');
  return {
    id: `wm_snapshot:${snapshot.runId}`,
    kind: 'run_archive_ref',
    subtype: 'working_memory_snapshot',
    summary: `[${snapshot.goal}] ${snapshot.phase} — ${snapshot.completedTodoCount} todos done, files: ${fileSummary}`,
    recall: {
      trigger: {
        paths: unique([
          ...snapshot.keyFiles.map((file) => file.path),
          ...snapshot.writtenFiles,
        ]),
        keywords: unique([
          ...tokenize(snapshot.goal),
          ...tokenize(snapshot.finalStep),
          ...snapshot.completedTodos.flatMap((todo) => tokenize(todo.label)),
          ...snapshot.keyFiles.flatMap((file) => tokenize(file.path)),
          ...snapshot.errorPatterns,
          ...snapshot.keySignalSummaries.flatMap((summary) => tokenize(summary)),
        ]),
      },
      applicableWhen: ['A previous completed task has similar goal, files, errors, or signals'],
      doNotApplyWhen: ['The historical task conflicts with current task ledger constraints or rejected assumptions'],
      sourceRefs: snapshot.evidenceRefs,
      updatedAt: snapshot.createdAt,
    },
    metadata: {
      taskId: snapshot.taskId,
      runId: snapshot.runId,
      keyFiles: snapshot.keyFiles,
      errorPatterns: snapshot.errorPatterns,
      createdAt: snapshot.createdAt,
      evidenceRefs: snapshot.evidenceRefs,
    },
    payload: snapshot,
  };
}

function makeIndex(items: RecallableMemoryItem[], memoryDir: string): RecallIndex {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: items.map((item): RecallIndexEntry => ({
      id: item.id,
      kind: item.kind,
      summary: item.summary,
      sourcePath: sourcePathFor(item.kind, memoryDir),
      recall: item.recall,
      metadata: item.metadata,
    })),
  };
}

function sourcePathFor(kind: RecallableMemoryItem['kind'], memoryDir: string): string {
  switch (kind) {
    case 'knack':
      return join(memoryDir, 'knacks.jsonl');
    case 'preference':
      return join(memoryDir, 'preferences.md');
    case 'doc_finding':
      return join(memoryDir, 'doc-findings.jsonl');
    case 'artifact_ref':
      return join(memoryDir, 'artifacts.jsonl');
    case 'run_archive_ref':
      return join(memoryDir, 'run-archives.jsonl');
  }
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return raw.split('\n').filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line) as T];
      } catch {
        return [];
      }
    });
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return [];
    throw err;
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as T;
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return null;
    return null;
  }
}

function matchesMetadataFilter(
  item: RecallableMemoryItem,
  filter?: RecallQueryMetadataFilter,
): boolean {
  if (!filter) return true;
  if (filter.kinds && !filter.kinds.includes(item.kind)) return false;
  if (filter.statuses && (!item.metadata.status || !filter.statuses.includes(item.metadata.status))) {
    return false;
  }
  if (filter.scopes && (!item.metadata.scope || !filter.scopes.includes(item.metadata.scope))) {
    return false;
  }
  if (filter.sources && (!item.metadata.source || !filter.sources.includes(item.metadata.source))) {
    return false;
  }
  if (filter.tags && !hasOverlap(filter.tags, item.metadata.tags ?? item.recall.tags ?? [])) {
    return false;
  }
  return true;
}

function makePreferenceRecall(preference: PreferenceEntry): RecallMetadata {
  return {
    trigger: {
      scopes: [preference.scope],
      keywords: tokenize(preference.rule).slice(0, 12),
    },
    applicableWhen: [`Applying ${preference.scope} preference`],
    doNotApplyWhen: [`The task is unrelated to ${preference.scope}`],
    tags: [preference.scope],
  };
}

function tokenize(text: string): string[] {
  return [...new Set(text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2))];
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function timestampOf(value: string): number {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function countOverlap(a?: readonly string[], b?: readonly string[]): number {
  if (!a || !b) return 0;
  const normalized = new Set(a.map((value) => value.toLowerCase()));
  return b.filter((value) => normalized.has(value.toLowerCase())).length;
}

function hasOverlap(a: readonly string[], b: readonly string[]): boolean {
  return countOverlap(a, b) > 0;
}

function hasActiveFilter(query: RecallQuery): boolean {
  return Boolean(query.metadata || query.trigger || query.text);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
