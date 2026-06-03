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
