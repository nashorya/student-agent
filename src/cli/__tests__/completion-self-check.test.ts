import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@mariozechner/pi-agent-core';
import {
  CompletionSelfCheck,
  SELF_CHECK_PROMPT,
} from '../completion-self-check.js';

describe('CompletionSelfCheck', () => {
  it('requires exhaustive scripted verification when constraints are mechanically checkable', () => {
    expect(SELF_CHECK_PROMPT).toContain('EVERY change in the full diff');
    expect(SELF_CHECK_PROMPT).toContain('Spot-checking a few examples is itself a verification failure');
    expect(SELF_CHECK_PROMPT).toContain('write and run a small script to verify it exhaustively');
    expect(SELF_CHECK_PROMPT).toContain(
      'Inspection-based verification is only acceptable when scripting is impossible',
    );
  });

  it('sends one evidence-based follow-up when hard constraints are present', async () => {
    const events: AgentEvent[] = [
      toolStart('read'),
      toolStart('apply_patch'),
    ];
    const prompt = vi.fn(async () => undefined);
    const waitForIdle = vi.fn(async () => undefined);
    const selfCheck = new CompletionSelfCheck({
      session: { prompt },
      agent: fakeAgent(events, waitForIdle),
    });

    const result = await selfCheck.run('Do not modify protected files.');

    expect(prompt).toHaveBeenCalledOnce();
    expect(prompt).toHaveBeenCalledWith(SELF_CHECK_PROMPT);
    expect(waitForIdle).toHaveBeenCalledOnce();
    expect(result).toEqual({
      ran: true,
      toolCalls: 2,
      editsMade: true,
    });
  });

  it('does not send a follow-up without hard constraints', async () => {
    const prompt = vi.fn(async () => undefined);
    const waitForIdle = vi.fn(async () => undefined);
    const selfCheck = new CompletionSelfCheck({
      session: { prompt },
      agent: fakeAgent([], waitForIdle),
    });

    const result = await selfCheck.run('   ');

    expect(prompt).not.toHaveBeenCalled();
    expect(waitForIdle).not.toHaveBeenCalled();
    expect(result).toEqual({
      ran: false,
      toolCalls: 0,
      editsMade: false,
    });
  });

  it('runs at most once even when invoked again', async () => {
    const prompt = vi.fn(async () => undefined);
    const waitForIdle = vi.fn(async () => undefined);
    const selfCheck = new CompletionSelfCheck({
      session: { prompt },
      agent: fakeAgent([toolStart('read')], waitForIdle),
    });

    const first = await selfCheck.run('Keep changes scoped.');
    const second = await selfCheck.run('Keep changes scoped.');

    expect(prompt).toHaveBeenCalledOnce();
    expect(first.ran).toBe(true);
    expect(second).toEqual(first);
  });
});

function fakeAgent(
  events: AgentEvent[],
  waitForIdle: () => Promise<void>,
): {
  subscribe: (listener: (event: AgentEvent) => void) => () => void;
  waitForIdle: () => Promise<void>;
} {
  return {
    subscribe: (listener) => {
      for (const event of events) listener(event);
      return () => undefined;
    },
    waitForIdle,
  };
}

function toolStart(toolName: string): AgentEvent {
  return {
    type: 'tool_execution_start',
    toolCallId: `call-${toolName}`,
    toolName,
    args: {},
  } as AgentEvent;
}
