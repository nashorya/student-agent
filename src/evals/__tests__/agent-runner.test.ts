import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import {
  AssistantTextCollector,
  buildDirectContinuationPrompt,
  buildPhaseContinuationPrompt,
  createEvalTracingHooks,
  shouldContinueDirectRun,
  shouldContinuePhaseRun,
  summarizeEvalModel,
  summarizeEvalThinking,
  summarizePiToolSchema,
  getActiveWorkingMemorySnapshot,
  buildPredeclaredPhasePrompt,
  readFrozenSamplingFromEnv,
  shouldAbortForModelCallBudget,
} from '../agent-runner.js';
import { beginEvalLearningRun } from '../eval-learning-lifecycle.js';
import type { ToolTraceEntry } from '../types.js';
import { TasksManager } from '../../memory/tasks/manager.js';
import { drainProtectedEvents } from '../../core/hashline/index.js';
import { ForcedCompactionController } from '../forced-compaction-controller.js';

describe('AssistantTextCollector', () => {
  it('keeps only the latest cumulative assistant text snapshot', () => {
    const collector = new AssistantTextCollector();

    collector.handleEvent(cumulativeTextEvent('[TASK'));
    collector.handleEvent(cumulativeTextEvent('[TASK_START name="Demo"]\nPhase 1: Read\n'));
    collector.handleEvent(cumulativeTextEvent('[TASK_START name="Demo"]\nPhase 1: Read\nPhase 2: Edit\n[/TASK_START]'));

    expect(collector.text()).toBe('[TASK_START name="Demo"]\nPhase 1: Read\nPhase 2: Edit\n[/TASK_START]');
  });

  it('appends real text deltas', () => {
    const collector = new AssistantTextCollector();

    collector.handleEvent({ type: 'message_start', message: { role: 'assistant' } } as unknown as AgentEvent);
    collector.handleEvent(deltaEvent('hello '));
    collector.handleEvent(deltaEvent('world'));
    collector.handleEvent({ type: 'message_end' } as unknown as AgentEvent);

    expect(collector.text()).toBe('hello world');
    expect(collector.messages()).toEqual(['hello world']);
  });

  it('accumulates assistant usage and cost from message_end events', () => {
    const collector = new AssistantTextCollector();

    collector.handleEvent(assistantEndWithUsage({
      input: 100,
      output: 40,
      cacheRead: 10,
      cacheWrite: 5,
      totalTokens: 155,
      cost: {
        input: 0.001,
        output: 0.002,
        cacheRead: 0.0001,
        cacheWrite: 0.0002,
        total: 0.0033,
      },
    }));
    collector.handleEvent(assistantEndWithUsage({
      input: 50,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 70,
      cost: {
        input: 0.0005,
        output: 0.001,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0.0015,
      },
    }));

    expect(collector.usage()).toEqual({
      inputTokens: 150,
      outputTokens: 60,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      totalTokens: 225,
      costAuthority: 'local_estimate',
      generationId: undefined,
      costUsd: {
        input: 0.0015,
        output: 0.003,
        cacheRead: 0.0001,
        cacheWrite: 0.0002,
        total: 0.0048,
      },
    });
    expect(collector.usageEvents()).toEqual([
      {
        index: 1,
        usage: {
          inputTokens: 100,
          outputTokens: 40,
          cacheReadTokens: 10,
          cacheWriteTokens: 5,
          totalTokens: 155,
          costAuthority: 'local_estimate',
          generationId: undefined,
          costUsd: {
            input: 0.001,
            output: 0.002,
            cacheRead: 0.0001,
            cacheWrite: 0.0002,
            total: 0.0033,
          },
        },
      },
      {
        index: 2,
        usage: {
          inputTokens: 50,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 70,
          costAuthority: 'local_estimate',
          generationId: undefined,
          costUsd: {
            input: 0.0005,
            output: 0.001,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0.0015,
          },
        },
      },
    ]);
  });
});

describe('frozen eval sampling', () => {
  it('requires a complete numeric preregistration payload', () => {
    const sampling = {
      model: 'glm-5.2', thinking: 'enabled', temperature: 0, topP: 0.95, maxTokens: 16384,
    };
    expect(readFrozenSamplingFromEnv(JSON.stringify(sampling))).toEqual(sampling);
    expect(() => readFrozenSamplingFromEnv('{"model":"glm-5.2"}')).toThrow('is invalid');
  });
});

describe('smoke phase controls', () => {
  it('includes the full task instruction before the first predeclared phase prompt', () => {
    const prompt = buildPredeclaredPhasePrompt({
      instruction: 'Delete the one-time ticket after deriving the decision.',
      phasePrompt: 'Execute phase one.',
      phaseIndex: 0,
    });

    expect(prompt).toContain('Delete the one-time ticket');
    expect(prompt).toContain('Execute phase one.');
  });

  it('appends a deterministic context payload to the selected phase prompt', () => {
    const prompt = buildPredeclaredPhasePrompt({
      instruction: 'Full task instruction.',
      phasePrompt: 'Execute phase four.',
      phaseIndex: 3,
      contextPayload: 'CONTROL_MARKER: GAMMA-RECOVERY-VERIFIED',
    });

    expect(prompt).toContain('CONTROLLED_CONTEXT_PAYLOAD phase=4');
    expect(prompt).toContain('GAMMA-RECOVERY-VERIFIED');
    expect(prompt).not.toContain('Full task instruction.');
  });

  it('aborts immediately when an in-flight phase reaches its model-call budget', () => {
    expect(shouldAbortForModelCallBudget(0, 1)).toBe(false);
    expect(shouldAbortForModelCallBudget(1, 1)).toBe(true);
  });
});

describe('ForcedCompactionController', () => {
  it('records boundary observations without requesting compaction', () => {
    const session = {
      agent: { state: { messages: [{}, {}, {}] } },
      sessionManager: { getEntries: () => [{}, {}] },
    };
    const controller = new ForcedCompactionController(session, new Set(), new Set([2]));

    controller.observeBoundary(1);
    controller.observeBoundary(2);
    controller.observeBoundary(2);

    expect(controller.events).toEqual([
      expect.objectContaining({
        kind: 'boundary_observed',
        boundary: 'phase:2',
        state: { messages: 3, entries: 2 },
      }),
    ]);
  });

  it('records Pi manual compaction lifecycle events from the session it invokes', async () => {
    let listener: ((event: unknown) => void) | undefined;
    let capturedBoundary: string | undefined;
    const messages: unknown[] = [{ role: 'user' }, { role: 'assistant' }];
    const entries: unknown[] = [{ type: 'message' }, { type: 'message' }];
    const session = {
      agent: { state: { messages } },
      sessionManager: { getEntries: () => entries },
      subscribe: (next: (event: unknown) => void) => {
        listener = next;
        return () => undefined;
      },
      compact: async () => {
        listener?.({ type: 'compaction_start', reason: 'manual' });
        listener?.({
          type: 'compaction_end',
          reason: 'manual',
          aborted: false,
          willRetry: false,
          result: { summary: 'Pi summary' },
        });
        messages.splice(0, 1);
        entries.push({ type: 'compaction' });
        return { summary: 'Pi summary' };
      },
    };
    const controller = new ForcedCompactionController(
      session,
      new Set([2]),
      new Set([2]),
      (boundary) => { capturedBoundary = boundary; },
    );

    await controller.compactAfterPhase(2);
    expect(capturedBoundary).toBeUndefined();
    controller.noteNextPhaseStarted(3);

    expect(controller.events).toEqual([
      expect.objectContaining({
        boundary: 'phase:2',
        status: 'completed',
        lifecycle: {
          startObserved: true,
          endObserved: true,
          reason: 'manual',
          aborted: false,
          willRetry: false,
        },
        state: {
          messagesBefore: 2,
          messagesAfter: 1,
          entriesBefore: 2,
          entriesAfter: 3,
          promptTokensBefore: null,
          promptTokensAfter: null,
          changed: true,
        },
        nextPhaseStartedAt: expect.any(String),
      }),
    ]);
    expect(controller.summaries).toEqual({ 'phase:2': 'Pi summary' });
    expect(capturedBoundary).toBe('phase:2');
  });
});

describe('Pi schema trace helpers', () => {
  it('estimates active tool schema size without serializing executable handlers', () => {
    const trace = summarizePiToolSchema([
      {
        name: 'read',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
        },
      },
      {
        name: 'edit',
        description: 'Edit a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            oldText: { type: 'string' },
            newText: { type: 'string' },
          },
          required: ['path', 'oldText', 'newText'],
        },
      },
    ]);

    expect(trace.toolCount).toBe(2);
    expect(trace.toolNames).toEqual(['read', 'edit']);
    expect(trace.schemaChars).toBeGreaterThan(0);
    expect(trace.approxSchemaTokens).toBeGreaterThan(0);
    expect(trace.perTool.map((tool) => tool.name)).toEqual(['read', 'edit']);
    expect(trace.llmRequestCount).toBe(0);
    expect(trace.estimatedSchemaInjectionCount).toBe(0);
    expect(trace.estimatedTotalSchemaTokens).toBe(0);
    expect(trace.note).toContain('provider SDK sends tools with each LLM request');
  });
});

describe('eval model metadata', () => {
  it('records the session thinking capability and level changes', () => {
    expect(summarizeEvalThinking({
      thinkingLevel: 'medium',
      supportsThinking: () => true,
      getAvailableThinkingLevels: () => ['low', 'medium', 'high'],
    })).toEqual({
      initialLevel: 'medium',
      supportsThinking: true,
      availableLevels: ['low', 'medium', 'high'],
      changes: [],
    });
  });

  it('records the resolved provider route and per-million token pricing', () => {
    expect(summarizeEvalModel({
      id: 'anthropic/claude-sonnet-4.6',
      name: 'anthropic/claude-sonnet-4.6',
      provider: 'openrouter',
      api: 'openai-completions',
      baseUrl: 'https://openrouter.ai/api/v1',
      cost: {
        input: 3,
        output: 15,
        cacheRead: 0.3,
        cacheWrite: 3.75,
      },
    } as never)).toEqual({
      id: 'anthropic/claude-sonnet-4.6',
      provider: 'openrouter',
      api: 'openai-completions',
      baseUrl: 'https://openrouter.ai/api/v1',
      pricingUsdPerMillionTokens: {
        input: 3,
        output: 15,
        cacheRead: 0.3,
        cacheWrite: 3.75,
      },
    });
  });
});

describe('eval tracing hooks', () => {
  it('records each failure-escalation trigger with level, count, and timestamp', async () => {
    const events: Array<{ level: number; count: number; timestamp: string }> = [];
    const hooks = createEvalTracingHooks([], {
      onFailureEscalationEvent: (event) => events.push(event),
      failureEscalation: {
        taskDescription: 'Fix three consecutive build failures',
        cwd: '/tmp/eval-sandbox',
      },
    });

    for (const count of [1, 2, 3]) {
      await hooks.onAfterToolCall?.({
        toolName: 'bash',
        toolCallId: `compile_${count}`,
        args: { command: 'npm run build' },
        isError: true,
        resultText: 'src/index.ts(1,1): error TS2307: Cannot find module x',
      });
    }

    expect(events.map(({ level, count }) => ({ level, count }))).toEqual([
      { level: 1, count: 1 },
      { level: 2, count: 2 },
      { level: 3, count: 3 },
    ]);
    expect(events.every((event) => !Number.isNaN(Date.parse(event.timestamp)))).toBe(true);
  });

  it('queries Context7 on the second eligible failure when the eval client is present', async () => {
    const query = vi.fn().mockResolvedValue({
      libraryId: '/microsoft/typescript',
      topic: 'TS2307',
      content: 'Check package installation and module resolution settings.',
      source: 'context7',
    });
    const hooks = createEvalTracingHooks([], {
      failureEscalation: {
        context7Client: { query },
        taskDescription: 'Fix the TypeScript build',
        cwd: '/tmp/eval-sandbox',
      },
    });
    const resultText = 'npx tsc --noEmit\nsrc/index.ts(1,1): error TS2307: Cannot find module x';

    for (const toolCallId of ['compile_1', 'compile_2']) {
      await hooks.onBeforeToolCall?.({
        toolName: 'bash',
        toolCallId,
        args: { command: 'npx tsc --noEmit' },
      });
    }
    await hooks.onAfterToolCall?.({
      toolName: 'bash',
      toolCallId: 'compile_1',
      args: { command: 'npx tsc --noEmit' },
      isError: true,
      resultText,
    });
    const decision = await hooks.onAfterToolCall?.({
      toolName: 'bash',
      toolCallId: 'compile_2',
      args: { command: 'npx tsc --noEmit' },
      isError: true,
      resultText,
    });

    expect(query).toHaveBeenCalledOnce();
    expect(decision?.overrideContent).toContain('已触发 Context7 文档检索');
    expect(decision?.overrideContent).toContain('module resolution settings');
  });

  it('enforces verify_retry and emits a protected event in eval runs', async () => {
    drainProtectedEvents();
    const hooks = createEvalTracingHooks([]);

    for (let attempt = 1; attempt <= 3; attempt++) {
      const toolCallId = `verify_${attempt}`;
      expect(await hooks.onBeforeToolCall?.({
        toolName: 'bash',
        toolCallId,
        args: { command: 'pytest tests/unit' },
      })).toBeUndefined();
      await hooks.onAfterToolCall?.({
        toolName: 'bash',
        toolCallId,
        args: { command: 'pytest tests/unit' },
        isError: true,
        resultText: 'failed',
      });
    }

    const blocked = await hooks.onBeforeToolCall?.({
      toolName: 'bash',
      toolCallId: 'verify_4',
      args: { command: 'pytest tests/integration' },
    });

    expect(blocked).toMatchObject({ block: true });
    expect(drainProtectedEvents()).toContainEqual(expect.objectContaining({
      source: 'toolguard',
      ruleName: 'verify_retry',
      blocked: true,
    }));
  });

  it('persists tool errors to the signal store and run archive in learning mode', async () => {
    const memoryDir = await mkdtemp(join(tmpdir(), 'agent-runner-learning-'));
    try {
      TasksManager.resetInstance();
      await TasksManager.getInstance(memoryDir).createTask('Learning task', ['Execute'], {
        workflowStatus: 'executing',
      });
      const run = await beginEvalLearningRun(memoryDir);
      const hooks = createEvalTracingHooks([], { memoryDir, learningRun: run });

      await hooks.onBeforeToolCall?.({
        toolName: 'bash',
        toolCallId: 'call_failed_pytest',
        args: { command: 'pytest -q' },
      });
      await hooks.onAfterToolCall?.({
        toolName: 'bash',
        toolCallId: 'call_failed_pytest',
        args: { command: 'pytest -q' },
        isError: true,
        resultText: 'warnings treated as errors',
      });

      const signals = await readFile(join(memoryDir, 'signals.jsonl'), 'utf-8');
      const events = await readFile(join(memoryDir, 'runs', run.runId, 'events.jsonl'), 'utf-8');
      expect(signals).toContain('warnings treated as errors');
      expect(events).toContain('"kind":"tool_call"');
      expect(events).toContain('"kind":"tool_error"');
    } finally {
      TasksManager.resetInstance();
      await rm(memoryDir, { recursive: true, force: true });
    }
  });
});

describe('working memory trace helpers', () => {
  it('captures tracked files from the active benchmark task', async () => {
    const memoryDir = await mkdtemp(join(tmpdir(), 'agent-runner-memory-'));
    try {
      TasksManager.resetInstance();
      const manager = TasksManager.getInstance(memoryDir);
      const task = await manager.createTask('Benchmark task', ['Execute'], {
        workflowStatus: 'executing',
      });
      await manager.trackFileRead(task.id, 'src/input.ts');
      await manager.trackFileWrite(task.id, 'src/output.ts');

      const snapshot = await getActiveWorkingMemorySnapshot(memoryDir);

      expect(snapshot?.readFiles.map((file) => file.path)).toContain('src/input.ts');
      expect(snapshot?.writeFiles.map((file) => file.path)).toContain('src/output.ts');
    } finally {
      TasksManager.resetInstance();
      await rm(memoryDir, { recursive: true, force: true });
    }
  });
});

describe('eval continuation policy', () => {
  it('continues direct runs after read-only tool use on edit tasks', () => {
    const calls: ToolTraceEntry[] = [{
      id: 'read_1',
      name: 'read',
      args: { path: 'src/message.txt' },
      startedAt: new Date(0).toISOString(),
      isError: false,
    }];

    expect(shouldContinueDirectRun({
      toolCalls: calls,
      expectedFiles: ['src/message.txt'],
      continuationCount: 0,
    })).toBe(true);
  });

  it('stops direct continuations after a mutating tool call', () => {
    const calls: ToolTraceEntry[] = [
      {
        id: 'read_1',
        name: 'read',
        args: { path: 'src/message.txt' },
        startedAt: new Date(0).toISOString(),
      },
      {
        id: 'edit_1',
        name: 'edit',
        args: { path: 'src/message.txt' },
        startedAt: new Date(0).toISOString(),
      },
    ];

    expect(shouldContinueDirectRun({
      toolCalls: calls,
      expectedFiles: ['src/message.txt'],
      continuationCount: 0,
    })).toBe(false);
  });

  it('continues phase runs when no PHASE_DONE signal was emitted', () => {
    expect(shouldContinuePhaseRun({
      phaseText: 'I will read src/math.ts now.',
      continuationCount: 0,
    })).toBe(true);
  });

  it('stops phase continuations when PHASE_DONE was emitted', () => {
    expect(shouldContinuePhaseRun({
      phaseText: '[PHASE_DONE phase=1]\n已完成：done\n[/PHASE_DONE]',
      continuationCount: 0,
    })).toBe(false);
  });

  it('builds direct and phase continuation prompts that require tools', () => {
    expect(buildDirectContinuationPrompt(['src/message.txt'])).toContain('必须继续调用工具');
    expect(buildDirectContinuationPrompt(['src/message.txt'])).toContain('src/message.txt');
    expect(buildDirectContinuationPrompt(['src/message.txt'])).toContain('下一条回复必须是工具调用');
    expect(buildDirectContinuationPrompt(['src/message.txt'])).toContain('不要输出文字说明');
    expect(buildPhaseContinuationPrompt(1, '读取 src/math.ts')).toContain('继续执行当前 Phase 1');
    expect(buildPhaseContinuationPrompt(1, '读取 src/math.ts')).toContain('不要只解释或描述');
    expect(buildPhaseContinuationPrompt(1, '读取 src/math.ts')).toContain('下一条回复必须优先调用工具');
  });

  it('builds read-only phase continuation prompts for analysis and design phases', () => {
    const prompt = buildPhaseContinuationPrompt(1, '分析 gateway.conf 路由加载流程，并设计动态热重载架构方案');

    expect(prompt).toContain('本 Phase 判定为分析/方案类');
    expect(prompt).toContain('不要调用 edit/write/apply_patch');
    expect(prompt).toContain('如果已经完成分析或方案，请直接输出 PHASE_DONE');
    expect(prompt).not.toContain('下一条回复必须优先调用工具');
  });
});

function cumulativeTextEvent(text: string): AgentEvent {
  return {
    type: 'message_update',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
  } as unknown as AgentEvent;
}

function deltaEvent(delta: string): AgentEvent {
  return {
    type: 'message_update',
    assistantMessageEvent: {
      type: 'text_delta',
      delta,
    },
  } as unknown as AgentEvent;
}

function assistantEndWithUsage(usage: unknown): AgentEvent {
  return {
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [],
      usage,
    },
  } as unknown as AgentEvent;
}
