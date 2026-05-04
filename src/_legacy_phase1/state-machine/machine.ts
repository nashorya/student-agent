import { setup, assign, fromPromise, raise } from 'xstate';
import type { MachineContext, MachineEvent, ToolCall } from './types.js';
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
import { QuestionsManager } from '../../memory/questions/manager.js';
import type { Question } from '../../memory/questions/types.js';
import type { Executor } from '../executor/index.js';
import { resourceManager } from './resource-manager.js';

interface WriteQuestionsInput {
  taskId: string;
  taskDescription: string;
  failureReason: string;
  errorCategory: MachineContext['errorCategory'];
  errorSubtype: string | null;
  attempts: MachineContext['attempts'];
}

interface StudentAgentMachineOptions {
  executor: Pick<Executor, 'executeRound'>;
}

interface ExecuteRoundInput {
  toolCalls: ToolCall[];
  signal?: AbortSignal;
}

interface RestoreSnapshotInput {
  snapshotId: string | null;
}

function errorMessageFromEvent(event: unknown): string {
  if (typeof event === 'object' && event !== null && 'error' in event) {
    const err = (event as { error: unknown }).error;
    return err instanceof Error ? err.message : String(err);
  }
  return 'unknown actor error';
}

function pickStrategy(category: MachineContext['errorCategory'], subtype: string | null): RetryStrategy {
  if (category === 'model') return '上下文复位';
  if (subtype === 'timeout') return '拆分重试';
  if (subtype === 'selector-not-found') return '降级重试';
  return '扩展思考';
}

export function createStudentAgentMachine(
  snapshotManager: SnapshotManager,
  options: StudentAgentMachineOptions,
) {
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
      doExecuteRound: fromPromise<void, ExecuteRoundInput>(
        async ({ input }) => {
          if (input.toolCalls.length === 0) return;
          await options.executor.executeRound(input.toolCalls, input.signal);
        },
      ),
      doRestoreSnapshot: fromPromise<void, RestoreSnapshotInput>(
        async ({ input }) => {
          if (!input.snapshotId) return;
          await snapshotManager.restore(input.snapshotId);
        },
      ),
      writeQuestionsEntry: fromPromise<void, WriteQuestionsInput>(async ({ input }) => {
        const mgr = QuestionsManager.getInstance();
        const q: Question = {
          id: `q_${input.taskId}_${Date.now()}`,
          error_type: input.errorCategory ?? 'tool',
          error_subtype: input.errorSubtype ?? 'unknown',
          context: input.taskDescription.slice(0, 300),
          attempts: input.attempts.map((a) => ({
            strategy: a.strategy,
            result: a.result === 'success' ? '成功' : a.result === 'skipped' ? '跳过' : '失败',
            reason: a.reason,
          })),
          status: 'unverified',
          hit_count: 1,
          last_hit: new Date().toISOString(),
          provenance: {
            source_type: 'machine-inferred',
            task_id: input.taskId,
            session_ref: `session_${Date.now()}`,
            trust_status: 'pending',
          },
        };
        await mgr.append(q);
      }),
    },
    actions: {
      ensureAbortController: ({ context }) => {
        if (!context.taskId) return;
        if (!resourceManager.getAbortController(context.taskId)) {
          resourceManager.createAbortController(context.taskId);
        }
      },
      abortTask: ({ context }) => {
        if (!context.taskId) return;
        resourceManager.abort(context.taskId);
      },
      incrementTimeoutCount: assign({
        timeoutCount: ({ context }) => context.timeoutCount + 1,
      }),
      setRestoreReasonTimeout: assign({
        restoreReason: () => 'timeout' as const,
      }),
      setRestoreReasonBeforeAttempt1: assign({
        restoreReason: () => 'before_attempt_1' as const,
      }),
      clearRestoreReason: assign({
        restoreReason: () => null,
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
      setActorFailureReason: assign({
        failureReason: ({ event }) => truncateRawError(errorMessageFromEvent(event)),
      }),
      classifyActorFailure: assign({
        errorCategory: ({ event }) =>
          classifyError(new Error(errorMessageFromEvent(event))).category,
        errorSubtype: ({ event }) =>
          classifyError(new Error(errorMessageFromEvent(event))).subtype,
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
          taskDescription: context.taskDescription ?? '未知任务',
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
      taskDescription: null,
      currentAttempt: 0,
      snapshotId: null,
      restoreReason: null,
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
              taskDescription: ({ event }) => event.input,
              currentAttempt: 0,
              timeoutCount: 0,
              snapshotId: null,
              restoreReason: null,
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
        entry: 'ensureAbortController',
        after: {
          120000: {
            target: 'restoring',
            actions: ['abortTask', 'incrementTimeoutCount', 'setRestoreReasonTimeout'],
          },
        },
        on: {
          EXECUTION_ROUND_COMPLETE: {
            target: 'executing_tools',
          },
          SNAPSHOT_CREATED: {
            actions: 'setSnapshotId',
          },
          EXECUTION_FAILED: {
            target: 'reflecting',
            actions: ['setFailureReason', 'classifyFailure'],
          },
          USER_INTERRUPT: {
            target: 'restoring_to_cancelled',
            actions: 'abortTask',
          },
        },
      },
      executing_tools: {
        invoke: {
          src: 'doExecuteRound',
          input: ({ context, event }) => ({
            toolCalls: event.type === 'EXECUTION_ROUND_COMPLETE' ? event.toolCalls : [],
            signal: context.taskId ? resourceManager.getAbortSignal(context.taskId) : undefined,
          }),
          onDone: {
            target: 'idle',
            actions: assign({ currentAttempt: ({ context }) => context.currentAttempt + 1 }),
          },
          onError: {
            target: 'reflecting',
            actions: ['setActorFailureReason', 'classifyActorFailure'],
          },
        },
        on: {
          SNAPSHOT_CREATED: {
            actions: 'setSnapshotId',
          },
          USER_INTERRUPT: {
            target: 'restoring_to_cancelled',
            actions: 'abortTask',
          },
        },
      },
      restoring: {
        invoke: {
          src: 'doRestoreSnapshot',
          input: ({ context }) => ({ snapshotId: context.snapshotId }),
          onDone: [
            {
              guard: ({ context }) =>
                context.restoreReason === 'timeout' && context.timeoutCount <= 2,
              target: 'executing',
              actions: 'clearRestoreReason',
            },
            {
              guard: ({ context }) => context.restoreReason === 'before_attempt_1',
              target: '#attempt1',
              actions: 'clearRestoreReason',
            },
            {
              target: 'reflecting',
              actions: 'clearRestoreReason',
            },
          ],
          onError: {
            target: 'failed',
            actions: ['setActorFailureReason', 'classifyActorFailure', 'clearRestoreReason'],
          },
        },
      },
      restoring_to_cancelled: {
        invoke: {
          src: 'doRestoreSnapshot',
          input: ({ context }) => ({ snapshotId: context.snapshotId }),
          onDone: {
            target: 'cancelled',
          },
          onError: {
            target: 'failed',
            actions: ['setActorFailureReason', 'classifyActorFailure'],
          },
        },
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
              {
                target: '#studentAgent.restoring',
                actions: 'setRestoreReasonBeforeAttempt1',
              },
            ],
          },
          attempt_1: {
            id: 'attempt1',
            entry: 'assignStrategy',
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
        invoke: {
          src: 'writeQuestionsEntry',
          input: ({ context }) => ({
            taskId: context.taskId ?? `task_${Date.now()}`,
            taskDescription: context.taskDescription ?? '',
            failureReason: context.failureReason ?? '',
            errorCategory: context.errorCategory,
            errorSubtype: context.errorSubtype,
            attempts: context.attempts,
          }),
          onDone: {},
          onError: {},
        },
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
export const studentAgentMachine = createStudentAgentMachine(new SnapshotManager(process.cwd()), {
  executor: {
    async executeRound() {
      return [];
    },
  },
});
