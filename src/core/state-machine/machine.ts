import { setup, assign, fromPromise, raise } from 'xstate';
import type { MachineContext, MachineEvent } from './types.js';
import { truncateRawError, pushAttempt } from './types.js';
import { SnapshotManager } from '../executor/index.js';
import { classifyError } from './error-classifier.js';
import { writeDiagnosticReport } from './diagnostic-reporter.js';
import {
  extractSearchIntent,
  stubWebSearchMCP,
  retryWithStrategy,
  retryWithSearchContext,
} from './stubs.js';
import type { RetryStrategy } from './stubs.js';

function pickStrategy(category: MachineContext['errorCategory'], subtype: string | null): RetryStrategy {
  if (category === 'model') return '上下文复位';
  if (subtype === 'timeout') return '拆分重试';
  if (subtype === 'selector-not-found') return '降级重试';
  return '扩展思考';
}

export function createStudentAgentMachine(snapshotManager: SnapshotManager) {
  return setup({
    types: {
      context: {} as MachineContext,
      events: {} as MachineEvent,
    },
    actors: {
      doRetryWithStrategy: fromPromise<void, { strategy: RetryStrategy }>(
        ({ input }) => retryWithStrategy(input.strategy),
      ),
      doExtractSearchIntent: fromPromise<string | null, { failureReason: string }>(
        ({ input }) => Promise.resolve(extractSearchIntent(input.failureReason)),
      ),
      doStubWebSearch: fromPromise<boolean, { intent: string }>(async ({ input }) => {
        const results = await stubWebSearchMCP(input.intent);
        return results.length > 0;
      }),
      doRetryWithSearch: fromPromise<void, { intent: string }>(async ({ input }) => {
        const results = await stubWebSearchMCP(input.intent);
        return retryWithSearchContext(results);
      }),
    },
    actions: {
      restoreSnapshotOnTimeout: ({ context }) => {
        if (!context.snapshotId) return;
        void (async () => {
          try {
            await snapshotManager.restore(context.snapshotId!);
          } catch (err) {
            console.error('[state-machine] restoreSnapshotOnTimeout failed:', err);
          }
        })();
      },
      incrementTimeoutCount: assign({
        timeoutCount: ({ context }) => context.timeoutCount + 1,
      }),
      setSnapshotId: assign({
        snapshotId: ({ event }) =>
          event.type === 'SNAPSHOT_CREATED' ? event.sha : null,
      }),
      setFailureReason: assign({
        failureReason: ({ event }) =>
          event.type === 'EXECUTION_FAILED'
            ? truncateRawError(event.error)
            : null,
      }),
      classifyFailure: assign({
        errorCategory: ({ context, event }) => {
          if (event.type !== 'EXECUTION_FAILED' && event.type !== 'ATTEMPT_RETRY_FAILED') return context.errorCategory;
          const rawErr = event.type === 'EXECUTION_FAILED' ? event.error : event.reason;
          const toolName = event.type === 'EXECUTION_FAILED' ? event.toolName : undefined;
          return classifyError(new Error(rawErr), toolName).category;
        },
        errorSubtype: ({ context, event }) => {
          if (event.type !== 'EXECUTION_FAILED' && event.type !== 'ATTEMPT_RETRY_FAILED') return context.errorSubtype;
          const rawErr = event.type === 'EXECUTION_FAILED' ? event.error : event.reason;
          const toolName = event.type === 'EXECUTION_FAILED' ? event.toolName : undefined;
          return classifyError(new Error(rawErr), toolName).subtype;
        },
      }),
      assignStrategy: assign({
        lastStrategy: ({ context }) =>
          pickStrategy(context.errorCategory, context.errorSubtype),
      }),
      pushAttempt1Failed: assign({
        attempts: ({ context, event }) =>
          pushAttempt(context.attempts, {
            index: 1,
            strategy: context.lastStrategy ?? '未知策略',
            result: 'failed',
            reason: event.type === 'ATTEMPT_RETRY_FAILED' ? event.reason : 'actor error',
          }),
      }),
      pushAttempt1FailedOnError: assign({
        attempts: ({ context }) =>
          pushAttempt(context.attempts, {
            index: 1,
            strategy: context.lastStrategy ?? '未知策略',
            result: 'failed',
            reason: 'actor threw unexpectedly',
          }),
      }),
      pushAttempt2Skipped: assign({
        attempts: ({ context }) =>
          pushAttempt(context.attempts, {
            index: 2,
            strategy: 'Web Search 注入',
            result: 'skipped',
            reason: '无法提取有效搜索意图，已跳过外部知识注入',
          }),
        searchIntent: () => null,
      }),
      pushAttempt2Failed: assign({
        attempts: ({ context }) =>
          pushAttempt(context.attempts, {
            index: 2,
            strategy: 'Web Search 注入',
            result: 'failed',
            reason: 'stub 未返回结果',
          }),
      }),
      pushAttempt2FailedOnError: assign({
        attempts: ({ context }) =>
          pushAttempt(context.attempts, {
            index: 2,
            strategy: 'Web Search 注入',
            result: 'failed',
            reason: 'actor threw unexpectedly',
          }),
      }),
      setSearchIntent: assign({
        searchIntent: ({ event }) =>
          event.type === 'SEARCH_INTENT_EXTRACTED' ? event.intent : null,
      }),
      emitDiagnosticReport: ({ context }) => {
        writeDiagnosticReport({
          taskDescription: context.failureReason ?? '未知任务',
          attempts: context.attempts,
          errorCategory: context.errorCategory ?? 'tool',
          errorSubtype: context.errorSubtype ?? 'unknown',
          rawError: context.failureReason ?? '',
        });
      },
    },
  }).createMachine({
    id: 'studentAgent',
    initial: 'idle',
    context: {
      taskId: null,
      currentAttempt: 0,
      snapshotId: null,
      failureReason: null,
      isHighRiskOperation: false,
      timeoutCount: 0,
      errorCategory: null,
      errorSubtype: null,
      attempts: [],
      lastStrategy: null,
      searchIntent: null,
    },
    states: {
      idle: {
        on: {
          START_TASK: {
            target: 'planning',
            actions: assign({
              taskId: () => `task_${Date.now()}`,
              currentAttempt: 0,
              timeoutCount: 0,
              snapshotId: null,
              failureReason: null,
              errorCategory: null,
              errorSubtype: null,
              attempts: [],
              lastStrategy: null,
              searchIntent: null,
            }),
          },
        },
      },
      planning: {
        on: {
          PLAN_READY: 'awaiting_confirmation',
        },
      },
      awaiting_confirmation: {
        on: {
          USER_CONFIRMED: 'executing',
          USER_REJECTED: 'idle',
        },
      },
      executing: {
        after: {
          120000: 'execution_timeout',
        },
        on: {
          EXECUTION_ROUND_COMPLETE: {
            target: 'idle',
            actions: assign({ currentAttempt: ({ context }) => context.currentAttempt + 1 }),
          },
          SNAPSHOT_CREATED: {
            actions: 'setSnapshotId',
          },
          EXECUTION_FAILED: {
            target: 'reflecting',
            actions: ['setFailureReason', 'classifyFailure'],
          },
          USER_INTERRUPT: 'cancelled',
        },
      },
      execution_timeout: {
        entry: ['restoreSnapshotOnTimeout', 'incrementTimeoutCount'],
        always: [
          {
            guard: ({ context }) => context.timeoutCount < 2,
            target: 'executing',
          },
          {
            target: 'reflecting',
          },
        ],
      },
      reflecting: {
        initial: 'routing',
        states: {
          routing: {
            always: [
              { guard: ({ context }) => context.errorCategory === 'environment', target: '#studentAgent.asking_user' },
              { guard: ({ context }) => context.errorCategory === 'user_input', target: '#studentAgent.asking_user' },
              {
                guard: ({ context }) => context.errorCategory === 'state_conflict',
                target: '#studentAgent.planning',
                // TODO (stage 2): inject conflict info into Planner for re-decomposition
              },
              { target: 'attempt_1' },
            ],
          },
          attempt_1: {
            entry: ['assignStrategy', 'restoreSnapshotOnTimeout'],
            invoke: {
              src: 'doRetryWithStrategy',
              input: ({ context }) => ({
                strategy: (context.lastStrategy ?? '降级重试') as RetryStrategy,
              }),
              onDone: {
                target: '#studentAgent.executing',
              },
              onError: {
                target: 'attempt_2',
                actions: 'pushAttempt1FailedOnError',
              },
            },
            on: {
              ATTEMPT_RETRY_SUCCESS: '#studentAgent.executing',
              ATTEMPT_RETRY_FAILED: {
                target: 'attempt_2',
                actions: 'pushAttempt1Failed',
              },
            },
            after: {
              60000: {
                target: 'attempt_2',
                actions: assign({
                  attempts: ({ context }) =>
                    pushAttempt(context.attempts, {
                      index: 1,
                      strategy: context.lastStrategy ?? '未知策略',
                      result: 'failed',
                      reason: 'attempt_1 timed out',
                    }),
                }),
              },
            },
          },
          attempt_2: {
            invoke: {
              src: 'doExtractSearchIntent',
              input: ({ context }) => ({ failureReason: context.failureReason ?? '' }),
              onDone: {
                actions: assign({
                  searchIntent: ({ event }) =>
                    (event.output as string | null),
                }),
                target: 'attempt_2_search',
              },
              onError: {
                target: 'attempt_3',
                actions: 'pushAttempt2Skipped',
              },
            },
          },
          attempt_2_search: {
            always: [
              {
                guard: ({ context }) => context.searchIntent === null,
                target: 'attempt_3',
                actions: 'pushAttempt2Skipped',
              },
            ],
            invoke: {
              src: 'doRetryWithSearch',
              input: ({ context }) => ({ intent: context.searchIntent! }),
              onDone: '#studentAgent.executing',
              onError: {
                target: 'attempt_3',
                actions: 'pushAttempt2FailedOnError',
              },
            },
            on: {
              ATTEMPT_RETRY_SUCCESS: '#studentAgent.executing',
              STUB_SEARCH_RETURNED: [
                {
                  guard: ({ event }) => !event.hadResults,
                  target: 'attempt_3',
                  actions: 'pushAttempt2Failed',
                },
              ],
            },
          },
          attempt_3: {
            entry: ['emitDiagnosticReport', raise({ type: 'DIAGNOSTIC_EMITTED' } as MachineEvent)],
            on: {
              DIAGNOSTIC_EMITTED: '#studentAgent.asking_user',
            },
          },
        },
      },
      asking_user: {
        // Placeholder — stage 1, step 4 (questions.json)
      },
      completed: {
        type: 'final',
      },
      cancelled: {
        type: 'final',
      },
      failed: {
        type: 'final',
      },
    },
  });
}

// Backward-compatible singleton for tests and simple usage
export const studentAgentMachine = createStudentAgentMachine(new SnapshotManager(process.cwd()));
