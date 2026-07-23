import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import type { Knack } from '../src/memory/knacks/types.js';

interface DistilledKnack {
  id: string;
  dedup_key: string;
  repo: string;
  symptom: string;
  fix_summary: string;
  evidence_task: string;
  confidence: string;
  reuse_count?: number;
  injected_count?: number;
  last_succeeded_task?: string | null;
  last_injected_task?: string | null;
  verified_fix?: string; // Audit-only source data; never injected into recall.
  verification?: string;
  execution_evidence?: string;
}

type ImportedKnack = Knack & {
  trigger: Knack['trigger'] & { keywords: string[] };
};

const defaultSourcePath = resolve(
  process.cwd(),
  'evals/distillation/candidate-knacks.json',
);
const defaultTargetPath = resolve(process.cwd(), 'memory/knacks.jsonl');

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function repoSlug(repo: string): string {
  return repo
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function repoKeyword(repo: string): string {
  const segments = repo.split('/').filter(Boolean);
  return segments.at(-1) ?? repo;
}

function toKnack(source: DistilledKnack, timestamp: string, existing?: ImportedKnack): ImportedKnack {
  const keyword = repoKeyword(source.repo);
  const trigger = {
    signalKinds: [],
    paths: [],
    toolNames: [],
    ruleNames: [],
    keywords: [keyword],
  };

  return {
    id: source.id,
    lessonCandidateId: source.dedup_key,
    status: source.confidence === 'verified' ? 'validated' : 'candidate',
    summary: truncate(
      `${source.symptom} Fix: ${source.fix_summary}`,
      200,
    ),
    trigger,
    recall: {
      trigger,
      applicableWhen: [source.symptom],
      doNotApplyWhen: [],
      tags: [repoSlug(source.repo), keyword, 'swe-bench'],
    },
    evidenceRefs: [source.evidence_task],
    counterexamples: [],
    allowPromptInjection: true,
    writesHardToolRule: false,
    breakerReport: null,
    repo: source.repo,
    symptom: source.symptom,
    fixSummary: source.fix_summary,
    ...(source.verification ? { verification: source.verification } : {}),
    ...(source.execution_evidence ? { executionEvidence: source.execution_evidence } : {}),
    reuseCount: existing && 'reuseCount' in existing ? existing.reuseCount ?? 0 : source.reuse_count ?? 0,
    injectedCount: existing && 'injectedCount' in existing ? existing.injectedCount ?? 0 : source.injected_count ?? 0,
    lastSucceededTask: existing && 'lastSucceededTask' in existing
      ? existing.lastSucceededTask ?? null
      : source.last_succeeded_task ?? null,
    lastInjectedTask: existing && 'lastInjectedTask' in existing
      ? existing.lastInjectedTask ?? null
      : source.last_injected_task ?? null,
    creditedUseKeys: existing?.creditedUseKeys ?? [],
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

async function readExistingStore(targetPath: string): Promise<ImportedKnack[]> {
  let contents = '';
  try {
    contents = await readFile(targetPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const entries: ImportedKnack[] = [];
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    if (!line.trim()) {
      continue;
    }

    const entry = JSON.parse(line) as ImportedKnack;
    if (typeof entry.id !== 'string') {
      throw new Error(
        `Invalid knack at ${targetPath}:${index + 1}: missing string id`,
      );
    }
    entries.push(entry);
  }

  return entries;
}

export async function importDistilledKnacks(options: {
  sourcePath?: string;
  targetPath?: string;
  now?: Date;
} = {}): Promise<{ imported: number; updated: number; unchanged: number }> {
  const sourcePath = options.sourcePath ?? defaultSourcePath;
  const targetPath = options.targetPath ?? defaultTargetPath;
  const sources = JSON.parse(
    await readFile(sourcePath, 'utf8'),
  ) as DistilledKnack[];
  if (!Array.isArray(sources)) {
    throw new Error(`Expected an array in ${sourcePath}`);
  }

  const existing = await readExistingStore(targetPath);
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  const hadDuplicateIds = byId.size !== existing.length;
  const timestamp = (options.now ?? new Date()).toISOString();
  let imported = 0;
  let updated = 0;
  let unchanged = 0;

  for (const source of sources) {
    const current = byId.get(source.id);
    const next = toKnack(source, timestamp, current);
    const comparableNext = { ...next, updatedAt: current?.updatedAt ?? next.updatedAt };
    if (current && JSON.stringify(current) === JSON.stringify(comparableNext)) {
      unchanged += 1;
      continue;
    }
    byId.set(source.id, next);
    if (current) updated += 1;
    else imported += 1;
  }

  if (imported > 0 || updated > 0 || hadDuplicateIds) {
    await mkdir(dirname(targetPath), { recursive: true });
    const payload = [...byId.values()].map((knack) => JSON.stringify(knack)).join('\n') + '\n';
    const temporaryPath = `${targetPath}.tmp-${process.pid}`;
    await writeFile(temporaryPath, payload, 'utf8');
    await rename(temporaryPath, targetPath);
  }

  return { imported, updated, unchanged };
}

async function main(): Promise<void> {
  const outcome = await importDistilledKnacks();
  console.log(`imported ${outcome.imported} / updated ${outcome.updated} / unchanged ${outcome.unchanged}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
