import type { JsonlMemoryStore } from './jsonl-memory-store.js';
import { DEFAULT_CANDIDATE_POOL_LIMIT } from './jsonl-memory-store.js';
import type { RecallSimilarityProvider } from '../embedding/types.js';
import { rankKnackResults } from './knack-ranking.js';
import { resolveRepositoryIdentity } from './repository-identity.js';
import type {
  MemoryRecallResult,
  RecallBundle,
  RecallQuery,
  RecallRouterInput,
  RecallScore,
  RecallTrigger,
  RecalledItem,
} from './types.js';
import type { L1Tier } from './types.js';
import type { LedgerRejection } from '../tasks/task-ledger.js';

type SearchableMemoryStore = Pick<JsonlMemoryStore, 'search'> & Partial<Pick<JsonlMemoryStore, 'loadTaskSnapshots'>>;

const RECENT_RAW_TURN_LIMIT = 2;
const HISTORICAL_TASK_LIMITS: Record<L1Tier, number> = {
  minimal: 0,
  standard: 2,
  heavy: 3,
};

export class RecallRouter {
  constructor(
    private readonly store: SearchableMemoryStore,
    private readonly options: { similarityProvider?: RecallSimilarityProvider } = {},
  ) {}

  async recall(input: RecallRouterInput): Promise<RecallBundle> {
    const query = buildRecallQuery(input);
    const results = await this.store.search(query, {
      tier: input.tier ?? 'standard',
      goal: input.goal,
      currentStep: input.currentStep,
      now: new Date(),
    });
    const dropped: Array<{ id: string; reason: string }> = [];
    const penalties: RecallBundle['diagnostics']['penalties'] = [];
    const bundle: RecallBundle = {
      knacks: [],
      preferences: [],
      docFindings: [],
      historicalTaskSnapshots: [],
      artifactRefs: [],
      runArchiveRefs: [],
      diagnostics: {
        queryText: query.text ?? '',
        triggerUsed: query.trigger ?? {},
        totalCandidates: results.length,
        dropped,
        penalties,
      },
    };

    const accepted: MemoryRecallResult[] = [];
    for (const result of results) {
      const { result: adjustedResult, penalty } = applyTaskLedgerPenalty(result, input);
      if (penalty) penalties.push(penalty);

      const dropReason = getDoNotApplyReason(adjustedResult, input);
      if (dropReason) {
        dropped.push({ id: adjustedResult.item.id, reason: dropReason });
        continue;
      }

      accepted.push(adjustedResult);
    }

    const knackResults = await rankKnackResults(
      accepted.filter((result) => result.item.kind === 'knack'),
      {
        repository: resolveRepositoryIdentity({
          repository: input.repository,
          taskId: input.currentTaskId ?? input.taskId,
        }),
        queryText: buildKnackQueryText(input, query.text ?? ''),
        currentTaskId: input.currentTaskId ?? input.taskId,
        similarityProvider: this.options.similarityProvider,
      },
    );
    const rankedKnackIds = new Set(knackResults.map((result) => result.item.id));
    const rejectedByEligibility = accepted.filter((result) =>
      result.item.kind === 'knack' && !rankedKnackIds.has(result.item.id),
    );
    for (const result of rejectedByEligibility) {
      dropped.push({ id: result.item.id, reason: 'knack_eligibility_failed' });
    }

    for (const result of [
      ...knackResults,
      ...accepted.filter((entry) => entry.item.kind !== 'knack'),
    ]) {
      const recalled = toRecalledItem(result);
      switch (result.item.kind) {
        case 'knack':
          bundle.knacks.push(recalled);
          break;
        case 'preference':
          bundle.preferences.push(recalled);
          break;
        case 'doc_finding':
          bundle.docFindings.push(recalled);
          break;
        case 'artifact_ref':
          bundle.artifactRefs.push(recalled);
          break;
        case 'run_archive_ref':
          bundle.runArchiveRefs.push(recalled);
          break;
      }
    }

    bundle.diagnostics.candidatePool = {
      scanned: results.length,
      eligibleKnacks: knackResults.length,
      truncated: results.length >= DEFAULT_CANDIDATE_POOL_LIMIT ? 1 : 0,
      limit: DEFAULT_CANDIDATE_POOL_LIMIT,
    };

    const historicalSnapshots = await this.loadHistoricalTaskSnapshots(input, dropped, penalties);
    for (const recalled of historicalSnapshots) {
      bundle.historicalTaskSnapshots.push(recalled);
      bundle.runArchiveRefs.push(recalled);
    }

    return bundle;
  }

  private async loadHistoricalTaskSnapshots(
    input: RecallRouterInput,
    dropped: Array<{ id: string; reason: string }>,
    penalties: RecallBundle['diagnostics']['penalties'],
  ): Promise<RecalledItem[]> {
    const tier = input.tier ?? 'standard';
    const limit = HISTORICAL_TASK_LIMITS[tier];
    if (limit <= 0 || !this.store.loadTaskSnapshots) return [];

    const excludeRunIds = uniqueStrings([
      ...(input.excludeRunIds ?? []),
      input.currentRunId,
    ]);
    const excludeTaskIds = uniqueStrings([
      ...(input.excludeTaskIds ?? []),
      input.currentTaskId ?? input.taskId,
    ]);
    const snapshots = await this.store.loadTaskSnapshots({
      limit,
      excludeRunIds,
      excludeTaskIds,
    });

    const recalled: RecalledItem[] = [];
    for (const item of snapshots) {
      const result: MemoryRecallResult = {
        item,
        score: {
          dimensions: {
            metadata: 0,
            trigger: 0,
            keyword: 1,
            recency: 0,
            relevance: 0,
            evidence: 0,
          },
          metadata: 0,
          trigger: 0,
          keyword: 1,
          vector: 0,
          total: 1,
        },
      };
      const { result: adjustedResult, penalty } = applyTaskLedgerPenalty(result, input);
      if (penalty) penalties.push(penalty);

      const dropReason = getDoNotApplyReason(adjustedResult, input);
      if (dropReason) {
        dropped.push({ id: item.id, reason: dropReason });
        continue;
      }
      recalled.push(toRecalledItem(adjustedResult));
    }

    return recalled.slice(0, limit);
  }
}

export function buildRecallQuery(input: RecallRouterInput): RecallQuery {
  const recentRawText = input.recentRawTurns
    .slice(-RECENT_RAW_TURN_LIMIT)
    .map((turn) => `${turn.role}: ${turn.content}`)
    .join('\n');
  const trigger = buildRecallTrigger(input);
  return {
    text: [input.goal, input.currentStep, recentRawText].filter(Boolean).join('\n'),
    trigger,
  };
}

function buildRecallTrigger(input: RecallRouterInput): RecallTrigger {
  return {
    signalKinds: unique(input.recentSignals.map((signal) => signal.kind)),
    paths: input.currentFile ? [input.currentFile] : undefined,
    toolNames: input.nextTool ? [input.nextTool] : undefined,
  };
}

function getDoNotApplyReason(
  result: MemoryRecallResult,
  input: RecallRouterInput,
): string | null {
  const context = normalizeText(`${input.goal}\n${input.phase}`);
  const matched = result.item.recall.doNotApplyWhen.find((condition) => {
    const normalized = normalizeText(condition);
    return normalized.length > 0 && (context.includes(normalized) || normalized.includes(context));
  });
  return matched ? `do_not_apply_when_matched:${matched}` : null;
}

function applyTaskLedgerPenalty(
  result: MemoryRecallResult,
  input: RecallRouterInput,
): {
  result: MemoryRecallResult;
  penalty?: RecallBundle['diagnostics']['penalties'][number];
} {
  const rejection = findMatchingRejection(result, input.taskLedger?.rejectedAssumptions ?? []);
  if (!rejection) return { result };

  const multiplier = rejection.severity === 'hard' ? 0.3 : 0.6;
  return {
    result: {
      ...result,
      score: multiplyScoreTotal(result.score, multiplier),
    },
    penalty: {
      id: result.item.id,
      reason: 'overlaps_rejected_assumption',
      rejectionId: rejection.id,
      assumption: rejection.assumption,
      severity: rejection.severity,
      multiplier,
    },
  };
}

function findMatchingRejection(
  result: MemoryRecallResult,
  rejections: LedgerRejection[],
): LedgerRejection | null {
  const haystack = normalizeText([
    result.item.summary,
    result.item.recall.applicableWhen.join(' '),
    Object.values(result.item.recall.trigger).flat().join(' '),
  ].join(' '));
  const activeRejections = rejections.filter((rejection) => !rejection.removedAt);

  return activeRejections.find((rejection) => {
    const assumption = normalizeText(rejection.assumption);
    if (!assumption) return false;
    if (haystack.includes(assumption) || assumption.includes(haystack)) return true;

    const assumptionTokens = tokenize(assumption);
    if (assumptionTokens.length === 0) return false;
    const haystackTokens = new Set(tokenize(haystack));
    const overlap = assumptionTokens.filter((token) => haystackTokens.has(token)).length;
    return overlap / assumptionTokens.length >= 0.5;
  }) ?? null;
}

function multiplyScoreTotal(score: RecallScore, multiplier: number): RecallScore {
  return {
    ...score,
    total: clamp(score.total * multiplier),
  };
}

function toRecalledItem(result: MemoryRecallResult): RecalledItem {
  return {
    id: result.item.id,
    kind: result.item.kind,
    subtype: result.item.subtype,
    summary: result.item.summary,
    reason: makeReason(result),
    score: result.score,
    ranking: result.ranking,
  };
}

function makeReason(result: MemoryRecallResult): string {
  const payload = result.item.payload as { repo?: unknown; symptom?: unknown; fixSummary?: unknown };
  if (result.ranking && (payload.repo || payload.symptom || payload.fixSummary)) {
    return `knack_rank:${result.ranking.rankReason}`;
  }
  const reasons: string[] = [];
  if (result.score.trigger > 0) reasons.push('trigger_match');
  if (result.score.metadata > 0) reasons.push('metadata_match');
  if (result.score.keyword > 0) reasons.push('keyword_match');
  if (result.score.vector > 0) reasons.push('vector_match');
  return reasons.length > 0 ? reasons.join('+') : 'store_result';
}

function buildKnackQueryText(input: RecallRouterInput, queryText: string): string {
  return [
    input.repository,
    queryText,
    ...input.recentErrors.map((error) => `${error.source} ${error.pattern ?? ''}`),
    ...input.recentSignals.map((signal) => signal.summary),
  ].filter(Boolean).join('\n');
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenize(text: string): string[] {
  return [...new Set(normalizeText(text)
    .split(/[^a-z0-9\u4e00-\u9fff_./-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2))];
}

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function unique<T>(items: T[]): T[] | undefined {
  const values = [...new Set(items)].filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function uniqueStrings(items: Array<string | undefined>): string[] | undefined {
  const values = [...new Set(items.filter((item): item is string => Boolean(item)))];
  return values.length > 0 ? values : undefined;
}
