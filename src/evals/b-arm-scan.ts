import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export interface ScanInstance {
  instance_id: string;
  repo: 'django' | 'sympy';
  familyHint?: string;
}

function instanceRe(): RegExp {
  return /((?:django__django|sympy__sympy)-\d+)/g;
}

export function parseScreeningTableInstances(markdown: string): ScanInstance[] {
  const seen = new Set<string>();
  const out: ScanInstance[] = [];
  let family = '';
  for (const line of markdown.split('\n')) {
    const familyMatch = line.match(/^\|\s*(F-[A-Z0-9-]+)\s*\|/);
    if (familyMatch) family = familyMatch[1]!;
    for (const match of line.matchAll(instanceRe())) {
      const instanceId = match[1]!;
      if (seen.has(instanceId)) continue;
      seen.add(instanceId);
      out.push({
        instance_id: instanceId,
        repo: instanceId.startsWith('django__') ? 'django' : 'sympy',
        familyHint: family || undefined,
      });
    }
  }
  return out;
}

export function parseLiteIdsFromBlob(blob: string | Buffer): ScanInstance[] {
  const text = typeof blob === 'string' ? blob : blob.toString('binary');
  const seen = new Set<string>();
  const out: ScanInstance[] = [];
  for (const match of text.matchAll(instanceRe())) {
    const instanceId = match[1]!;
    if (seen.has(instanceId)) continue;
    seen.add(instanceId);
    out.push({
      instance_id: instanceId,
      repo: instanceId.startsWith('django__') ? 'django' : 'sympy',
    });
  }
  return out.sort((a, b) => a.instance_id.localeCompare(b.instance_id));
}

export function filterScanPool(
  instances: ScanInstance[],
  repo?: 'django' | 'sympy',
): ScanInstance[] {
  return repo ? instances.filter((item) => item.repo === repo) : instances;
}

export async function loadScanPool(options: {
  screeningTablePath?: string;
  liteIdBlob?: string;
  instances?: ScanInstance[];
  repo?: 'django' | 'sympy';
}): Promise<ScanInstance[]> {
  const collected: ScanInstance[] = [...(options.instances ?? [])];
  if (options.screeningTablePath) {
    collected.push(...parseScreeningTableInstances(await readFile(options.screeningTablePath, 'utf8')));
  }
  if (options.liteIdBlob) {
    collected.push(...parseLiteIdsFromBlob(options.liteIdBlob));
  }
  const seen = new Set<string>();
  const unique: ScanInstance[] = [];
  for (const item of collected.flat().sort((a, b) => a.instance_id.localeCompare(b.instance_id))) {
    if (seen.has(item.instance_id)) continue;
    seen.add(item.instance_id);
    unique.push(item);
  }
  return filterScanPool(unique, options.repo);
}

export function estimateScanRuns(instances: ScanInstance[]): {
  repos: Record<string, number>;
  estimatedRuns: number;
} {
  const repos: Record<string, number> = {};
  for (const item of instances) {
    repos[item.repo] = (repos[item.repo] ?? 0) + 1;
  }
  return { repos, estimatedRuns: instances.length };
}

export interface ReusableRun {
  instance_id: string;
  predictionsPath: string;
  model_patch: string;
  model_name_or_path?: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export function parsePredictionRecord(raw: string): {
  instance_id?: string;
  model_patch: string;
  model_name_or_path?: string;
} | null {
  const line = raw.trim().split(/\r?\n/u).find(Boolean);
  if (!line) return null;
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const patch = typeof parsed.model_patch === 'string' ? parsed.model_patch : '';
    return {
      instance_id: typeof parsed.instance_id === 'string' ? parsed.instance_id : undefined,
      model_patch: patch,
      model_name_or_path: typeof parsed.model_name_or_path === 'string'
        ? parsed.model_name_or_path
        : undefined,
    };
  } catch {
    return null;
  }
}

export function isReusablePatch(patch: string | undefined): boolean {
  return Boolean(patch?.trim());
}

function tokenUsageFromRecords(raw: string): {
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
} {
  const empty = { tokens: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const record = Array.isArray(parsed)
      ? parsed[0]
      : Array.isArray(parsed.records) ? parsed.records[0] : parsed;
    if (!record || typeof record !== 'object') return empty;
    const usage = (record as { trace?: { tokenUsage?: Record<string, unknown> } }).trace?.tokenUsage;
    const cost = usage?.costUsd;
    return {
      tokens: Number(usage?.totalTokens ?? 0) || 0,
      inputTokens: Number(usage?.inputTokens ?? 0) || 0,
      outputTokens: Number(usage?.outputTokens ?? 0) || 0,
      costUsd: Number(
        cost && typeof cost === 'object' ? (cost as { total?: unknown }).total : cost,
      ) || 0,
    };
  } catch {
    return empty;
  }
}

export async function loadReusableRun(runDir: string): Promise<ReusableRun | null> {
  const predictionsPath = join(runDir, 'predictions.jsonl');
  let raw: string;
  try {
    raw = await readFile(predictionsPath, 'utf8');
  } catch {
    return null;
  }
  const prediction = parsePredictionRecord(raw);
  if (!prediction || !isReusablePatch(prediction.model_patch)) return null;
  let usage = { tokens: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  try {
    usage = tokenUsageFromRecords(await readFile(join(runDir, 'records.json'), 'utf8'));
  } catch {
    // Token totals are optional for rescoring; the patch is what must be kept.
  }
  return {
    instance_id: prediction.instance_id ?? basename(runDir),
    predictionsPath,
    model_patch: prediction.model_patch,
    model_name_or_path: prediction.model_name_or_path,
    ...usage,
  };
}

export async function inventoryReusableRuns(runsDir: string): Promise<ReusableRun[]> {
  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch {
    return [];
  }
  const found: ReusableRun[] = [];
  for (const name of entries.sort()) {
    const run = await loadReusableRun(join(runsDir, name));
    if (run) found.push(run);
  }
  return found;
}

export type ScanVerdict = 'resolved' | 'unresolved' | 'harness_error';

export interface ScanResultRow {
  instance_id: string;
  repo: 'django' | 'sympy';
  verdict: ScanVerdict;
  /** Only set when verdict is `resolved`. Never `false`. */
  resolved?: true;
  tokens: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  emptyPatch?: boolean;
  reusedPatch?: boolean;
  error?: string;
  stopped?: boolean;
  voided?: boolean;
  voidReason?: string;
  [key: string]: unknown;
}

export function isOfficialVerdict(verdict: ScanVerdict | undefined): boolean {
  return verdict === 'resolved' || verdict === 'unresolved';
}

export function buildScanResult(
  input: Omit<ScanResultRow, 'verdict' | 'resolved'> & { verdict: ScanVerdict },
): ScanResultRow {
  const row = { ...input } as ScanResultRow;
  delete row.resolved;
  row.verdict = input.verdict;
  if (input.verdict === 'resolved') row.resolved = true;
  return row;
}

export function isMasqueradingHarnessFail(row: Record<string, unknown>): boolean {
  if (row.voided === true) return false;
  if (row.verdict === 'resolved' || row.verdict === 'unresolved') return false;
  if (row.source === 'rescore-probe' && row.verdict === undefined) return false;
  const error = typeof row.error === 'string' ? row.error : '';
  return row.resolved === false && /Official SWE-bench harness|harness exited|harness report is incomplete/i.test(error);
}

export function normalizeScanResult(row: Record<string, unknown>): ScanResultRow {
  if (isMasqueradingHarnessFail(row)) {
    const next = { ...row };
    delete next.resolved;
    return buildScanResult({
      ...(next as Omit<ScanResultRow, 'verdict' | 'resolved'>),
      instance_id: String(row.instance_id),
      repo: row.instance_id && String(row.instance_id).startsWith('sympy__') ? 'sympy' : 'django',
      tokens: Number(row.tokens ?? 0) || 0,
      verdict: 'harness_error',
      voided: true,
      voidReason: 'harness_error recorded as resolved=false',
    });
  }
  if (row.verdict === 'resolved' || row.verdict === 'unresolved' || row.verdict === 'harness_error') {
    return buildScanResult({
      ...(row as Omit<ScanResultRow, 'verdict' | 'resolved'>),
      instance_id: String(row.instance_id),
      repo: (row.repo === 'sympy' ? 'sympy' : 'django'),
      tokens: Number(row.tokens ?? 0) || 0,
      verdict: row.verdict,
    });
  }
  if (row.resolved === true) {
    return buildScanResult({
      ...(row as Omit<ScanResultRow, 'verdict' | 'resolved'>),
      instance_id: String(row.instance_id),
      repo: (row.repo === 'sympy' ? 'sympy' : 'django'),
      tokens: Number(row.tokens ?? 0) || 0,
      verdict: 'resolved',
    });
  }
  if (row.source === 'rescore-probe' && row.resolved === false) {
    const next = { ...row };
    delete next.resolved;
    return buildScanResult({
      ...(next as Omit<ScanResultRow, 'verdict' | 'resolved'>),
      instance_id: String(row.instance_id),
      repo: (row.repo === 'sympy' ? 'sympy' : 'django'),
      tokens: Number(row.tokens ?? 0) || 0,
      verdict: 'unresolved',
    });
  }
  if (row.resolved === false && !row.error) {
    const next = { ...row };
    delete next.resolved;
    return buildScanResult({
      ...(next as Omit<ScanResultRow, 'verdict' | 'resolved'>),
      instance_id: String(row.instance_id),
      repo: (row.repo === 'sympy' ? 'sympy' : 'django'),
      tokens: Number(row.tokens ?? 0) || 0,
      verdict: 'unresolved',
    });
  }
  const next = { ...row };
  delete next.resolved;
  return buildScanResult({
    ...(next as Omit<ScanResultRow, 'verdict' | 'resolved'>),
    instance_id: String(row.instance_id ?? 'unknown'),
    repo: String(row.instance_id ?? '').startsWith('sympy__') ? 'sympy' : 'django',
    tokens: Number(row.tokens ?? 0) || 0,
    verdict: 'harness_error',
  });
}

export function latestNonVoidedRow(
  rows: Array<Record<string, unknown>>,
): Map<string, ScanResultRow> {
  const last = new Map<string, ScanResultRow>();
  for (const row of rows) {
    const normalized = normalizeScanResult(row);
    if (normalized.voided) continue;
    last.set(normalized.instance_id, normalized);
  }
  return last;
}

export function officialVerdictIds(rows: Array<Record<string, unknown>>): Set<string> {
  return new Set([...latestNonVoidedRow(rows).values()]
    .filter((row) => isOfficialVerdict(row.verdict))
    .map((row) => row.instance_id));
}

export function buildRetryQueue(rows: Array<Record<string, unknown>>): ScanResultRow[] {
  return [...latestNonVoidedRow(rows).values()]
    .filter((row) => row.verdict === 'harness_error')
    .sort((a, b) => a.instance_id.localeCompare(b.instance_id));
}

export function proposeFamiliesFromFailures(
  rows: Array<{ instance_id: string; verdict?: ScanVerdict; resolved?: boolean; familyHint?: string }>,
): Array<{ familyId: string; instanceIds: string[]; failed: number }> {
  const byFamily = new Map<string, { instanceIds: string[]; failed: number }>();
  for (const row of rows) {
    if (row.verdict === 'harness_error') continue;
    const familyId = row.familyHint ?? 'UNGROUPED';
    const current = byFamily.get(familyId) ?? { instanceIds: [], failed: 0 };
    current.instanceIds.push(row.instance_id);
    const failed = row.verdict === 'unresolved' || (row.verdict === undefined && row.resolved === false);
    if (failed) current.failed += 1;
    byFamily.set(familyId, current);
  }
  return [...byFamily.entries()]
    .map(([familyId, value]) => ({ familyId, ...value }))
    .filter((family) => family.instanceIds.length >= 3 && family.failed >= 2);
}
