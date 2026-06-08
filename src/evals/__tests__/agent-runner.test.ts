import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@mariozechner/pi-agent-core';
import { AssistantTextCollector } from '../agent-runner.js';

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
      costUsd: {
        input: 0.0015,
        output: 0.003,
        cacheRead: 0.0001,
        cacheWrite: 0.0002,
        total: 0.0048,
      },
    });
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
