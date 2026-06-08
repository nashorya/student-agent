import { describe, expect, it } from 'vitest';
import { selectL1Tier } from '../../memory/recall/tier-selector.js';
import type { L1TierInput } from '../../memory/recall/types.js';

describe('Context Runtime Eval: L1 tier selection', () => {
  it('selects minimal only for simple confirmation with pinned context and no risk', () => {
    expect(selectL1Tier(input({
      isSimpleConfirmation: true,
      hasActiveTask: true,
    }))).toMatchObject({ tier: 'minimal' });
  });

  it.each([
    ['starting execution', { nextActionIsWrite: true }],
    ['rollback request', { isRecoveryMode: true }],
    ['change everything request', { nextActionIsWrite: true }],
    ['submit request', { hasPendingToolResult: true }],
  ])('does not downgrade short %s messages to minimal', (_label, overrides) => {
    expect(selectL1Tier(input({
      isSimpleConfirmation: true,
      hasActiveTask: true,
      ...overrides,
    })).tier).not.toBe('minimal');
  });

  it('selects heavy for user corrections and lostness triggers before minimal logic', () => {
    expect(selectL1Tier(input({
      isSimpleConfirmation: true,
      hasActiveTask: true,
      hasUserCorrection: true,
    }))).toMatchObject({ tier: 'heavy', reason: 'user_correction' });
    expect(selectL1Tier(input({
      isSimpleConfirmation: true,
      hasActiveTask: true,
      hasLostnessTrigger: true,
    }))).toMatchObject({ tier: 'heavy', reason: 'lostness_trigger' });
  });

  it('selects heavy for eval failure analysis and harness modification contexts', () => {
    expect(selectL1Tier(input({
      isSimpleConfirmation: true,
      hasActiveTask: true,
      isEvalFailureAnalysis: true,
    }))).toMatchObject({ tier: 'heavy', reason: 'eval_failure_analysis' });
    expect(selectL1Tier(input({
      isSimpleConfirmation: true,
      hasActiveTask: true,
      isHarnessModification: true,
    }))).toMatchObject({ tier: 'heavy', reason: 'harness_modification' });
  });

  it('selects heavy for repeated errors and tool thrashing', () => {
    expect(selectL1Tier(input({ recentErrorCount: 3 })))
      .toMatchObject({ tier: 'heavy', reason: 'recent_error_count_gte_3' });
    expect(selectL1Tier(input({ recentToolThrashingCount: 2 })))
      .toMatchObject({ tier: 'heavy', reason: 'recent_tool_thrashing_count_gte_2' });
  });

  it('does not select minimal when open questions or next write actions exist', () => {
    expect(selectL1Tier(input({
      isSimpleConfirmation: true,
      hasActiveTask: true,
      hasOpenQuestion: true,
    })).tier).not.toBe('minimal');
    expect(selectL1Tier(input({
      isSimpleConfirmation: true,
      hasActiveTask: true,
      nextActionIsWrite: true,
    })).tier).not.toBe('minimal');
  });
});

function input(overrides: Partial<L1TierInput> & Record<string, unknown> = {}): L1TierInput {
  return {
    hasActiveTask: true,
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
  } as L1TierInput;
}
