import type { RecallQuery, RecallRouterInput } from '../../../memory/recall/types.js';
import { taskLedger } from './task-ledger.js';

export const recallQuery: RecallQuery = {
  text: 'Recover Hashline stale edit with fresh read and validation',
  trigger: {
    signalKinds: ['hashline_rejection'],
    paths: ['src/hashline.ts'],
    toolNames: ['hashline_edit'],
  },
  metadata: {
    kinds: ['knack'],
    statuses: ['candidate'],
    tags: ['hashline'],
  },
};

export function recallRouterInput(overrides: Partial<RecallRouterInput> = {}): RecallRouterInput {
  return {
    taskId: 'task_context_eval',
    currentTaskId: 'task_context_eval',
    currentRunId: 'run_context_eval',
    excludeTaskIds: ['task_context_eval'],
    excludeRunIds: ['run_context_eval'],
    tier: 'standard',
    phase: 'executing',
    goal: 'Recover Hashline stale edit with fresh read',
    currentStep: 'Rank recall candidates',
    currentFile: 'src/hashline.ts',
    nextTool: 'hashline_edit',
    recentErrors: [],
    recentSignals: [{ kind: 'hashline_rejection', summary: 'Stale edit rejected' }],
    taskLedger: taskLedger(),
    recentRawTurns: [],
    ...overrides,
  };
}
