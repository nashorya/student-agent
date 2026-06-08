import type {
  L1Tier,
  RecallQuery,
  RecallTrigger,
  RecallableMemoryItem,
} from './types.js';

export interface DimensionScores {
  trigger: number;
  keyword: number;
  recency: number;
  relevance: number;
  metadata: number;
  evidence: number;
}

export interface ScoringWeights {
  trigger: number;
  keyword: number;
  recency: number;
  relevance: number;
  metadata: number;
  evidence: number;
}

export interface ScoringContext {
  tier: L1Tier;
  goal?: string;
  currentStep?: string;
  now?: Date;
}

export interface ScoreRecallItemResult {
  dimensions: DimensionScores;
  total: number;
  metadata: number;
  trigger: number;
  keyword: number;
  vector: number;
}

export const SCORING_WEIGHTS: Record<L1Tier, ScoringWeights> = {
  minimal: {
    trigger: 0.35,
    keyword: 0.20,
    recency: 0.10,
    relevance: 0.20,
    metadata: 0.10,
    evidence: 0.05,
  },
  standard: {
    trigger: 0.30,
    keyword: 0.20,
    recency: 0.10,
    relevance: 0.20,
    metadata: 0.10,
    evidence: 0.10,
  },
  heavy: {
    trigger: 0.25,
    keyword: 0.15,
    recency: 0.10,
    relevance: 0.25,
    metadata: 0.10,
    evidence: 0.15,
  },
};

const HALF_LIFE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export function scoreRecallItem(
  item: RecallableMemoryItem,
  query: RecallQuery,
  context: ScoringContext,
): ScoreRecallItemResult {
  const dimensions: DimensionScores = {
    trigger: scoreTriggerDimension(item, query),
    keyword: scoreKeywordDimension(item, query),
    recency: scoreRecencyDimension(item, context),
    relevance: scoreRelevanceDimension(item, context),
    metadata: scoreMetadataDimension(item, query),
    evidence: scoreEvidenceDimension(item),
  };
  const weights = SCORING_WEIGHTS[context.tier];
  const total = clamp(
    dimensions.trigger * weights.trigger
    + dimensions.keyword * weights.keyword
    + dimensions.recency * weights.recency
    + dimensions.relevance * weights.relevance
    + dimensions.metadata * weights.metadata
    + dimensions.evidence * weights.evidence,
  );

  return {
    dimensions,
    total,
    metadata: dimensions.metadata,
    trigger: dimensions.trigger,
    keyword: dimensions.keyword,
    vector: 0,
  };
}

export function scoreTriggerDimension(
  item: RecallableMemoryItem,
  query: RecallQuery,
): number {
  const itemTrigger = item.recall.trigger;
  const queryTrigger = query.trigger ?? {};
  const scores = [
    triggerSubScore(itemTrigger.signalKinds, queryTrigger.signalKinds),
    triggerSubScore(itemTrigger.paths, queryTrigger.paths),
    triggerSubScore(itemTrigger.toolNames, queryTrigger.toolNames),
    triggerSubScore(itemTrigger.ruleNames, queryTrigger.ruleNames),
  ].filter((score): score is number => score !== null);

  if (scores.length === 0) return 0;
  return clamp(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

export function scoreKeywordDimension(
  item: RecallableMemoryItem,
  query: RecallQuery,
): number {
  const queryTokens = tokenize(query.text ?? '');
  if (queryTokens.length === 0) return 0;
  const itemTokens = tokenize(itemText(item));
  if (itemTokens.length === 0) return 0;
  return clamp(countOverlap(queryTokens, itemTokens) / queryTokens.length);
}

export function scoreRecencyDimension(
  item: RecallableMemoryItem,
  context: Pick<ScoringContext, 'now'>,
): number {
  const timestamp = item.metadata.createdAt ?? item.metadata.updatedAt;
  if (!timestamp) return 0.5;
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return 0.5;
  const now = context.now ?? new Date();
  const ageDays = Math.max(0, (now.getTime() - parsed) / DAY_MS);
  return clamp(Math.max(0.1, Math.pow(0.5, ageDays / HALF_LIFE_DAYS)));
}

export function scoreRelevanceDimension(
  item: RecallableMemoryItem,
  context: Pick<ScoringContext, 'goal' | 'currentStep'>,
): number {
  const contextTokens = tokenize([context.goal, context.currentStep].filter(Boolean).join(' '));
  if (contextTokens.length === 0) return 0;
  const applicableTokens = tokenize(item.recall.applicableWhen.join(' '));
  if (applicableTokens.length === 0) return 0;
  return clamp(countOverlap(applicableTokens, contextTokens) / applicableTokens.length);
}

export function scoreMetadataDimension(
  item: RecallableMemoryItem,
  query: RecallQuery,
): number {
  const filter = query.metadata;
  if (!filter) return 0;
  let matched = 0;
  let total = 0;

  if (filter.kinds) {
    total++;
    if (filter.kinds.includes(item.kind)) matched++;
  }
  if (filter.scopes) {
    total++;
    if (item.metadata.scope && filter.scopes.includes(item.metadata.scope)) matched++;
  }
  if (filter.statuses) {
    total++;
    if (item.metadata.status && filter.statuses.includes(item.metadata.status)) matched++;
  }
  if (filter.tags) {
    total++;
    matched += countOverlap(filter.tags, item.metadata.tags ?? item.recall.tags ?? []) / filter.tags.length;
  }

  if (total === 0) return 0;
  return clamp(matched / total);
}

export function scoreEvidenceDimension(item: RecallableMemoryItem): number {
  const evidenceCount = item.metadata.evidenceRefs?.length ?? 0;
  const counterCount = counterexampleCount(item.payload);
  return clamp(
    Math.min(evidenceCount / 5, 1.0) - Math.min(counterCount / 3, 0.5),
  );
}

function triggerSubScore(
  itemValues?: readonly string[],
  queryValues?: readonly string[],
): number | null {
  const itemCount = itemValues?.length ?? 0;
  const queryCount = queryValues?.length ?? 0;
  if (itemCount === 0 && queryCount === 0) return null;
  if (itemCount === 0 || queryCount === 0) return 0;
  return clamp(countOverlap(itemValues ?? [], queryValues ?? []) / Math.max(itemCount, queryCount));
}

function itemText(item: RecallableMemoryItem): string {
  return [
    item.summary,
    item.recall.applicableWhen.join(' '),
    item.recall.doNotApplyWhen.join(' '),
    Object.values(item.recall.trigger).flat().join(' '),
  ].join(' ');
}

function tokenize(text: string): string[] {
  return [...new Set(text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff_./-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2))];
}

function countOverlap(a: readonly string[], b: readonly string[]): number {
  const normalized = new Set(a.map((value) => value.toLowerCase()));
  return b.filter((value) => normalized.has(value.toLowerCase())).length;
}

function counterexampleCount(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 0;
  const counterexamples = (payload as { counterexamples?: unknown }).counterexamples;
  return Array.isArray(counterexamples) ? counterexamples.length : 0;
}

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
