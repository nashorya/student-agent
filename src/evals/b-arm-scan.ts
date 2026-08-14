import { readFile } from 'node:fs/promises';

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

export function proposeFamiliesFromFailures(
  rows: Array<{ instance_id: string; resolved: boolean; familyHint?: string }>,
): Array<{ familyId: string; instanceIds: string[]; failed: number }> {
  const byFamily = new Map<string, { instanceIds: string[]; failed: number }>();
  for (const row of rows) {
    const familyId = row.familyHint ?? 'UNGROUPED';
    const current = byFamily.get(familyId) ?? { instanceIds: [], failed: 0 };
    current.instanceIds.push(row.instance_id);
    if (!row.resolved) current.failed += 1;
    byFamily.set(familyId, current);
  }
  return [...byFamily.entries()]
    .map(([familyId, value]) => ({ familyId, ...value }))
    .filter((family) => family.instanceIds.length >= 3 && family.failed >= 2);
}
