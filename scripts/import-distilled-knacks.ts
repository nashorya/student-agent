import { appendFile, mkdir, readFile } from 'node:fs/promises';
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
  verified_fix?: string; // Audit-only source data; never injected into recall.
}

type ImportedKnack = Knack & {
  trigger: Knack['trigger'] & { keywords: string[] };
};

const sourcePath = resolve(
  process.cwd(),
  'evals/distillation/candidate-knacks.json',
);
const targetPath = resolve(process.cwd(), 'memory/knacks.jsonl');

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

function toKnack(source: DistilledKnack, timestamp: string): ImportedKnack {
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
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function readExistingStore(): Promise<{
  contents: string;
  ids: Set<string>;
}> {
  let contents = '';
  try {
    contents = await readFile(targetPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const ids = new Set<string>();
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    if (!line.trim()) {
      continue;
    }

    const entry = JSON.parse(line) as { id?: unknown };
    if (typeof entry.id !== 'string') {
      throw new Error(
        `Invalid knack at ${targetPath}:${index + 1}: missing string id`,
      );
    }
    ids.add(entry.id);
  }

  return { contents, ids };
}

async function main(): Promise<void> {
  const sources = JSON.parse(
    await readFile(sourcePath, 'utf8'),
  ) as DistilledKnack[];
  if (!Array.isArray(sources)) {
    throw new Error(`Expected an array in ${sourcePath}`);
  }

  const { contents, ids } = await readExistingStore();
  const timestamp = new Date().toISOString();
  const imported: ImportedKnack[] = [];
  let skipped = 0;

  for (const source of sources) {
    if (ids.has(source.id)) {
      skipped += 1;
      continue;
    }

    imported.push(toKnack(source, timestamp));
    ids.add(source.id);
  }

  if (imported.length > 0) {
    await mkdir(dirname(targetPath), { recursive: true });
    const separator = contents.length > 0 && !contents.endsWith('\n') ? '\n' : '';
    const payload = imported.map((knack) => JSON.stringify(knack)).join('\n');
    await appendFile(targetPath, `${separator}${payload}\n`, 'utf8');
  }

  for (const knack of imported) {
    console.log(`imported ${knack.id}`);
  }
  console.log(`imported ${imported.length} / skipped ${skipped}`);
}

await main();
