import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@mariozechner/pi-agent-core';
import {
  NonInteractiveUsageCollector,
  createNonInteractiveSummary,
} from '../non-interactive-summary.js';

describe('NonInteractiveUsageCollector', () => {
  it('accumulates assistant usage events for a one-shot summary', () => {
    const collector = new NonInteractiveUsageCollector();

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

    const summary = createNonInteractiveSummary({
      status: 'success',
      exitCode: 0,
      startedAt: '2026-06-10T00:00:00.000Z',
      endedAt: '2026-06-10T00:00:02.000Z',
      durationMs: 2000,
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      usage: collector.usage(),
      usageEvents: collector.usageEvents(),
      contextAssemblyTraces: [{
        pipeline: 'new',
        generatedAt: '2026-06-10T00:00:00.000Z',
        runMode: 'eval',
        piSchemaRenderMode: 'summary',
        tier: 'standard',
        tierReason: 'default_standard',
        truncated: [],
        renderedPromptChars: 35,
        renderedPromptEstimatedTokens: 10,
        sections: [],
        layers: {
          L0: { layer: 'L0', chars: 35, estimatedTokens: 10, sectionCount: 1, sectionIds: ['hardcodedSections'] },
          L1: { layer: 'L1', chars: 0, estimatedTokens: 0, sectionCount: 0, sectionIds: [] },
          L2: { layer: 'L2', chars: 0, estimatedTokens: 0, sectionCount: 0, sectionIds: [] },
          L3: { layer: 'L3', chars: 0, estimatedTokens: 0, sectionCount: 0, sectionIds: [] },
        },
      }],
      contextTokenEffect: {
        observedInputTokens: 150,
        observedTotalTokens: 225,
        llmRequestCount: 2,
        contextPromptEstimatedTokens: 10,
        repeatedContextPromptEstimatedTokens: 20,
        toolSchemaEstimatedTokens: 0,
        instructionEstimatedTokens: 3,
        layers: {
          L0: { layer: 'L0', chars: 70, estimatedTokens: 23, sectionCount: 2, sectionIds: ['hardcodedSections', 'taskInstruction'] },
          L1: { layer: 'L1', chars: 0, estimatedTokens: 0, sectionCount: 0, sectionIds: [] },
          L2: { layer: 'L2', chars: 0, estimatedTokens: 0, sectionCount: 0, sectionIds: [] },
          L3: { layer: 'L3', chars: 0, estimatedTokens: 0, sectionCount: 0, sectionIds: [] },
        },
        classifiedInputTokens: 23,
        unclassifiedInputTokens: 127,
        estimatedClassifiedShareOfObservedInput: 0.153333,
        note: 'estimated',
      },
      protectedEvents: [{
        source: 'toolguard',
        type: 'block',
        ruleName: 'verify_retry',
        blocked: true,
        timestamp: '2026-06-10T00:00:01.000Z',
      }],
      selfCheck: {
        ran: true,
        toolCalls: 2,
        editsMade: true,
      },
      continuationRounds: 1,
    });

    expect(summary.tokenUsage).toEqual({
      inputTokens: 150,
      outputTokens: 60,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      totalTokens: 225,
      costUsd: {
        input: 0.0015,
        output: 0.003,
        cacheRead: 0.0001,
        cacheWrite: 0.0002,
        total: 0.0048,
      },
    });
    expect(summary.usageEvents).toHaveLength(2);
    expect(summary.turnCount).toBe(2);
    expect(summary.guardRuleCounts).toEqual({ verify_retry: 1 });
    expect(summary.protectedEvents).toHaveLength(1);
    expect(summary.contextAssemblyTraces).toHaveLength(1);
    expect(summary.contextTokenEffect?.layers.L0.sectionIds).toContain('taskInstruction');
    expect(summary.selfCheck).toEqual({
      ran: true,
      toolCalls: 2,
      editsMade: true,
    });
    expect(summary.continuationRounds).toBe(1);
  });
});

function assistantEndWithUsage(usage: unknown): AgentEvent {
  return {
    type: 'message_end',
    message: {
      role: 'assistant',
      usage,
    },
  } as unknown as AgentEvent;
}
