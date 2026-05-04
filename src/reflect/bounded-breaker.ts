import type {
  BreakerConfidenceLevel,
  CandidateBreakerReport,
  PreferenceCandidate,
} from '../memory/candidates/types.js';
import {
  COLD_START_OVERRIDE_MIN_OBS,
  COLD_START_TASK_THRESHOLD,
  UPGRADE_THRESHOLDS,
} from '../memory/candidates/types.js';

export interface BreakerInput {
  candidate: PreferenceCandidate;
  totalTaskCount: number;
}

export interface GeneralizationBreakerInput extends BreakerInput {
  sourceCandidates: PreferenceCandidate[];
}

export interface BreakerReviewInput {
  pattern: string;
  scope: string;
  observations: number;
  contradictions: number;
  coldStart: boolean;
  strategies: string[];
}

export interface BreakerReviewResult {
  confidenceLevel: BreakerConfidenceLevel;
  knownFailureContext: string[];
  unknownRiskZones: string[];
}

export interface BreakerReviewer {
  review(input: BreakerReviewInput): Promise<BreakerReviewResult>;
}

export interface BreakerDecision {
  action: 'promote' | 'promote_with_caution' | 'reject' | 'skipped';
  report: CandidateBreakerReport | null;
  reason: string;
}

export interface BoundedBreakerOptions {
  reviewer?: BreakerReviewer;
  maxReviewsPerRun?: number;
  now?: () => Date;
}

const DEFAULT_MAX_REVIEWS_PER_RUN = 3;

export class BoundedBreaker {
  private readonly reviewer: BreakerReviewer;
  private readonly maxReviewsPerRun: number;
  private readonly now: () => Date;
  private reviewsUsed = 0;

  constructor(options: BoundedBreakerOptions = {}) {
    this.reviewer = options.reviewer ?? new HeuristicBreakerReviewer();
    this.maxReviewsPerRun = options.maxReviewsPerRun ?? DEFAULT_MAX_REVIEWS_PER_RUN;
    this.now = options.now ?? (() => new Date());
  }

  resetBudget(): void {
    this.reviewsUsed = 0;
  }

  async evaluate(input: BreakerInput): Promise<BreakerDecision> {
    if (this.reviewsUsed >= this.maxReviewsPerRun) {
      return {
        action: 'skipped',
        report: null,
        reason: 'Breaker 预算已用尽',
      };
    }

    this.reviewsUsed++;
    const strategies = selectStrategies(input.candidate);
    const review = await this.reviewer.review({
      pattern: input.candidate.pattern,
      scope: input.candidate.scope,
      observations: input.candidate.observations,
      contradictions: input.candidate.contradictions,
      coldStart: input.totalTaskCount < COLD_START_TASK_THRESHOLD,
      strategies,
    });

    const recommendation = recommendationForConfidence(review.confidenceLevel);
    return {
      action: recommendation,
      report: {
        id: `breaker_${this.now().getTime()}_${this.reviewsUsed}`,
        confidence_level: review.confidenceLevel,
        breakers_applied: strategies,
        known_failure_context: review.knownFailureContext,
        unknown_risk_zones: review.unknownRiskZones,
        recommendation,
        created_at: this.now().toISOString(),
      },
      reason: `Breaker confidence: ${review.confidenceLevel}`,
    };
  }

  async evaluateMerge(input: BreakerInput): Promise<BreakerDecision> {
    return this.evaluate(input);
  }

  async evaluateGeneralization(input: GeneralizationBreakerInput): Promise<BreakerDecision> {
    const sourceTaskIds = new Set(
      input.sourceCandidates.flatMap((candidate) =>
        candidate.provenance.map((item) => item.task_id),
      ),
    );

    if (input.sourceCandidates.length < 3 || sourceTaskIds.size < 2) {
      return {
        action: 'reject',
        report: {
          id: `breaker_${this.now().getTime()}_generalization_reject`,
          confidence_level: 'low',
          breakers_applied: ['generalization-admission-check'],
          known_failure_context: ['泛化候选不足：需要至少 3 个具体候选和至少 2 个不同任务来源'],
          unknown_risk_zones: ['泛化规则可能过早扩大适用范围'],
          recommendation: 'reject',
          created_at: this.now().toISOString(),
        },
        reason: '泛化准入条件不足',
      };
    }

    const decision = await this.evaluate(input);
    if (decision.report?.confidence_level !== 'high') {
      return {
        ...decision,
        action: 'reject',
        reason: `${decision.reason}，泛化要求 high confidence`,
      };
    }

    return decision;
  }
}

class HeuristicBreakerReviewer implements BreakerReviewer {
  async review(input: BreakerReviewInput): Promise<BreakerReviewResult> {
    if (input.contradictions > 0) {
      return {
        confidenceLevel: 'low',
        knownFailureContext: ['候选存在矛盾观察'],
        unknownRiskZones: ['规则可能只适用于部分任务上下文'],
      };
    }

    const minObservations = input.coldStart
      ? COLD_START_OVERRIDE_MIN_OBS
      : UPGRADE_THRESHOLDS[input.scope as keyof typeof UPGRADE_THRESHOLDS];

    if (input.observations > minObservations) {
      return {
        confidenceLevel: 'high',
        knownFailureContext: [],
        unknownRiskZones: [],
      };
    }

    return {
      confidenceLevel: 'moderate',
      knownFailureContext: [],
      unknownRiskZones: ['观察次数刚达到阈值，泛化边界仍需后续任务验证'],
    };
  }
}

function selectStrategies(candidate: PreferenceCandidate): string[] {
  const strategies = ['extreme-value-test', 'context-adversarial-test'];
  if (candidate.scope === 'architecture') {
    return [...strategies, 'cross-module-impact-test'].slice(0, 2);
  }
  return strategies.slice(0, 2);
}

function recommendationForConfidence(
  confidenceLevel: BreakerConfidenceLevel,
): CandidateBreakerReport['recommendation'] {
  switch (confidenceLevel) {
    case 'high':
      return 'promote';
    case 'moderate':
      return 'promote_with_caution';
    case 'low':
      return 'reject';
  }
}
