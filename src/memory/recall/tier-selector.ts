import type {
  L1Tier,
  L1TierBudget,
  L1TierInput,
  RecallLimits,
} from './types.js';

export const TIER_BUDGETS: Record<L1Tier, L1TierBudget> = {
  minimal: {
    tier: 'minimal',
    totalBudget: 2500,
    sectionBudgets: {
      systemRules: 200,
      toolRules: 100,
      taskSpec: 400,
      hardConstraints: 300,
      taskLedger: 800,
      workingMemory: 400,
      recentErrors: 150,
      recentSignals: 100,
      knacks: 0,
      preferences: 100,
      docFindings: 0,
      artifactRefs: 0,
      runArchiveRefs: 0,
      recentRawTurns: 400,
      currentUserMessageReserve: 650,
    },
  },
  standard: {
    tier: 'standard',
    totalBudget: 7000,
    sectionBudgets: {
      systemRules: 400,
      toolRules: 400,
      taskSpec: 800,
      hardConstraints: 800,
      taskLedger: 800,
      workingMemory: 1200,
      recentErrors: 500,
      recentSignals: 300,
      knacks: 1200,
      preferences: 300,
      docFindings: 500,
      artifactRefs: 400,
      runArchiveRefs: 200,
      recentRawTurns: 800,
      currentUserMessageReserve: 700,
    },
  },
  heavy: {
    tier: 'heavy',
    totalBudget: 14000,
    sectionBudgets: {
      systemRules: 600,
      toolRules: 700,
      taskSpec: 1500,
      hardConstraints: 1500,
      taskLedger: 800,
      workingMemory: 1800,
      recentErrors: 1000,
      recentSignals: 700,
      knacks: 2500,
      preferences: 500,
      docFindings: 1000,
      artifactRefs: 1200,
      runArchiveRefs: 900,
      recentRawTurns: 1600,
      currentUserMessageReserve: 2000,
    },
  },
};

export const RECALL_LIMITS: Record<L1Tier, RecallLimits> = {
  minimal: { knacks: 0, docFindings: 0, preferences: 1, artifactRefs: 0, runArchiveRefs: 0 },
  standard: { knacks: 3, docFindings: 2, preferences: 2, artifactRefs: 2, runArchiveRefs: 1 },
  heavy: { knacks: 5, docFindings: 4, preferences: 3, artifactRefs: 5, runArchiveRefs: 3 },
};

export function selectL1Tier(input: L1TierInput): { tier: L1Tier; reason: string } {
  if (input.hasLostnessTrigger) return { tier: 'heavy', reason: 'lostness_trigger' };
  if (input.hasUserCorrection) return { tier: 'heavy', reason: 'user_correction' };
  if (input.isEvalFailureAnalysis) return { tier: 'heavy', reason: 'eval_failure_analysis' };
  if (input.isHarnessModification) return { tier: 'heavy', reason: 'harness_modification' };
  if (input.hasRejectedAssumptionRisk) return { tier: 'heavy', reason: 'rejected_assumption_risk' };
  if (input.isRecoveryMode) return { tier: 'heavy', reason: 'recovery_mode' };
  if (input.recentErrorCount >= 3) return { tier: 'heavy', reason: 'recent_error_count_gte_3' };
  if ((input.recentToolThrashingCount ?? 0) >= 2) return { tier: 'heavy', reason: 'recent_tool_thrashing_count_gte_2' };

  if (
    input.isSimpleConfirmation
    && input.hasActiveTask
    && !input.hasPendingToolResult
    && !input.hasRecentError
    && !input.hasOpenQuestion
    && !input.nextActionIsWrite
  ) {
    return { tier: 'minimal', reason: 'simple_confirmation_with_pinned_context' };
  }

  return { tier: 'standard', reason: 'default_standard' };
}
