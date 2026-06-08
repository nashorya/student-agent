import { describe, expect, it } from 'vitest';
import { selectL1Tier, TIER_BUDGETS, RECALL_LIMITS } from '../tier-selector.js';
import type { L1TierInput } from '../types.js';

describe('selectL1Tier', () => {
  it('selects minimal for simple confirmation with active task and no risks', () => {
    expect(selectL1Tier(input({
      hasActiveTask: true,
      isSimpleConfirmation: true,
    }))).toEqual({
      tier: 'minimal',
      reason: 'simple_confirmation_with_pinned_context',
    });
  });

  it('selects standard for normal active task execution', () => {
    expect(selectL1Tier(input({
      hasActiveTask: true,
    }))).toMatchObject({
      tier: 'standard',
    });
  });

  it('selects heavy when lostness trigger exists', () => {
    expect(selectL1Tier(input({
      hasLostnessTrigger: true,
    }))).toMatchObject({
      tier: 'heavy',
      reason: 'lostness_trigger',
    });
  });

  it('selects heavy when user correction exists', () => {
    expect(selectL1Tier(input({
      hasUserCorrection: true,
    }))).toMatchObject({
      tier: 'heavy',
      reason: 'user_correction',
    });
  });

  it('selects heavy when recentErrorCount is 3 or more', () => {
    expect(selectL1Tier(input({
      recentErrorCount: 3,
    }))).toMatchObject({
      tier: 'heavy',
      reason: 'recent_error_count_gte_3',
    });
  });

  it('keeps simple confirmation with pending error at standard', () => {
    expect(selectL1Tier(input({
      hasActiveTask: true,
      isSimpleConfirmation: true,
      hasRecentError: true,
      recentErrorCount: 1,
    }))).toMatchObject({
      tier: 'standard',
    });
  });

  it('exports budgets and recall limits for all tiers', () => {
    expect(TIER_BUDGETS.minimal.sectionBudgets.knacks).toBe(0);
    expect(TIER_BUDGETS.heavy.sectionBudgets.knacks)
      .toBeGreaterThan(TIER_BUDGETS.standard.sectionBudgets.knacks);
    expect(RECALL_LIMITS.minimal).toMatchObject({
      knacks: 0,
      preferences: 1,
      docFindings: 0,
    });
  });
});

function input(overrides: Partial<L1TierInput> = {}): L1TierInput {
  return {
    hasActiveTask: false,
    isSimpleConfirmation: false,
    hasPendingToolResult: false,
    hasRecentError: false,
    recentErrorCount: 0,
    hasOpenQuestion: false,
    hasLostnessTrigger: false,
    hasUserCorrection: false,
    hasRejectedAssumptionRisk: false,
    isRecoveryMode: false,
    nextActionIsWrite: false,
    ...overrides,
  };
}
