import type { TaskLedgerInput } from '../../../memory/tasks/task-ledger.js';
import { FIXED_NOW } from './working-memory.js';

export function taskLedger(overrides: Partial<TaskLedgerInput> = {}): TaskLedgerInput {
  return {
    confirmedFacts: [
      {
        id: 'fact_confirmed',
        content: 'Confirmed fact survives into L1',
        source: 'user',
        confidence: 'confirmed',
        addedAt: FIXED_NOW,
      },
      {
        id: 'fact_tentative',
        content: 'Tentative fact is labeled tentative',
        source: 'inference',
        confidence: 'tentative',
        addedAt: FIXED_NOW,
      },
    ],
    rejectedAssumptions: [
      {
        id: 'rej_hard',
        assumption: 'Blind retry stale edits',
        reason: 'User correction requires fresh read first',
        source: 'user_correction',
        severity: 'hard',
        addedAt: FIXED_NOW,
      },
      {
        id: 'rej_soft',
        assumption: 'Generated docs are authoritative',
        reason: 'Need verification',
        source: 'tool_error',
        severity: 'soft',
        addedAt: FIXED_NOW,
      },
    ],
    openQuestions: [
      {
        id: 'q_open',
        question: 'Should Context Runtime eval inspect payloads?',
        context: 'Payloads should stay out of L1',
        status: 'open',
        addedAt: FIXED_NOW,
      },
    ],
    ...overrides,
  };
}

export const removedRejection = {
  id: 'rej_removed',
  assumption: 'Removed rejection should not affect recall',
  reason: 'User explicitly removed it',
  source: 'explicit' as const,
  severity: 'hard' as const,
  addedAt: FIXED_NOW,
  removedAt: FIXED_NOW,
  removalSource: 'user_explicit' as const,
};

export const resolvedQuestion = {
  id: 'q_resolved',
  question: 'Resolved question should not render',
  context: 'Already answered',
  status: 'resolved' as const,
  resolution: 'No',
  addedAt: FIXED_NOW,
  resolvedAt: FIXED_NOW,
};
