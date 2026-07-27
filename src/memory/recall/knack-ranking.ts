import type { Knack } from '../knacks/types.js';
import {
  createDefaultRecallSimilarityProvider,
  LexicalRecallSimilarityProvider,
} from '../embedding/provider.js';
import type { RecallSimilarityProvider } from '../embedding/types.js';
import { normalizeRepositoryIdentity } from './repository-identity.js';
import type { KnackRankingDiagnostics, MemoryRecallResult } from './types.js';

const LEXICAL_ELIGIBILITY_THRESHOLD = 0.12;
const SEMANTIC_ELIGIBILITY_THRESHOLD = 0.55;
const REUSE_CAP = 10;

export async function rankKnackResults(results: MemoryRecallResult[], options: {
  repository: string;
  queryText: string;
  currentTaskId: string;
  similarityProvider?: RecallSimilarityProvider;
}): Promise<MemoryRecallResult[]> {
  if (results.length === 0) return [];
  const provider = options.similarityProvider ?? createDefaultRecallSimilarityProvider();
  const candidates = results.map((result) => ({
    id: result.item.id,
    text: knackText(result),
  }));
  let similarities: Map<string, number>;
  let source: 'embedding' | 'lexical';
  try {
    similarities = await provider.score(options.queryText, candidates);
    source = provider.source ?? 'embedding';
  } catch {
    const lexical = new LexicalRecallSimilarityProvider();
    similarities = await lexical.score(options.queryText, candidates);
    source = 'lexical';
  }

  const repository = normalizeRepositoryIdentity(options.repository);
  return results.map((result) => {
    const knack = result.item.payload as Partial<Knack>;
    // Only repo-scoped knacks face the repo/similarity gate. Online-born knacks
    // carry symptom/fixSummary without a repo and stay unconditionally eligible.
    const repoScoped = Boolean(knack.repo);
    const repoMatch = repoScoped
      && normalizeRepositoryIdentity(knack.repo as string) === repository;
    const similarity = clamp(similarities.get(result.item.id) ?? 0);
    const threshold = source === 'lexical' ? LEXICAL_ELIGIBILITY_THRESHOLD : SEMANTIC_ELIGIBILITY_THRESHOLD;
    const eligible = !repoScoped || repoMatch || similarity >= threshold;
    const reuseCount = Math.max(0, Math.min(REUSE_CAP, knack.reuseCount ?? 0));
    const confidence = knack.status === 'validated' || result.item.metadata.status === 'validated' ? 1 : 0;
    const antiRepeat = knack.lastInjectedTask === options.currentTaskId ? 0 : 1;
    const ranking: KnackRankingDiagnostics = {
      repoMatch,
      similarity,
      similaritySource: source,
      reuseCount,
      confidence,
      antiRepeat,
      eligible,
      rankReason: [
        `reuse=${reuseCount}`,
        `confidence=${confidence}`,
        `repo=${repoMatch ? 1 : 0}`,
        `${source}=${similarity.toFixed(3)}`,
        `antiRepeat=${antiRepeat}`,
      ].join(','),
    };
    return { ...result, ranking };
  }).filter((result) => result.ranking?.eligible)
    .sort(compareRankedKnacks);
}

function compareRankedKnacks(left: MemoryRecallResult, right: MemoryRecallResult): number {
  const a = left.ranking as KnackRankingDiagnostics;
  const b = right.ranking as KnackRankingDiagnostics;
  return b.reuseCount - a.reuseCount
    || b.confidence - a.confidence
    || Number(b.repoMatch) - Number(a.repoMatch)
    || b.similarity - a.similarity
    || b.antiRepeat - a.antiRepeat
    || right.score.total - left.score.total
    || left.item.id.localeCompare(right.item.id);
}

function knackText(result: MemoryRecallResult): string {
  const knack = result.item.payload as Partial<Knack>;
  return [knack.repo, knack.symptom, knack.fixSummary, result.item.summary]
    .filter(Boolean)
    .join('\n');
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
