import { describe, expect, it } from 'vitest';
import { appReducer, initialAppState, type Message } from '../state.js';

function message(role: Message['role'], content: string, timestamp: number): Message {
  return { role, content, timestamp };
}

describe('appReducer', () => {
  it('updates the latest assistant message across system and error messages', () => {
    const state = {
      ...initialAppState,
      messages: [
        message('assistant', 'partial', 1),
        message('system', 'status update', 2),
        message('error', 'transient error', 3),
      ],
    };

    const next = appReducer(state, { type: 'UPDATE_LAST_MESSAGE', content: 'complete' });

    expect(next.messages).toEqual([
      message('assistant', 'complete', 1),
      message('system', 'status update', 2),
      message('error', 'transient error', 3),
    ]);
  });

  it.each(['user', 'tool'] as const)('does not update an assistant before a %s message', (role) => {
    const state = {
      ...initialAppState,
      messages: [
        message('assistant', 'complete', 1),
        message('system', 'status update', 2),
        message(role, 'new boundary', 3),
      ],
    };

    const next = appReducer(state, { type: 'UPDATE_LAST_MESSAGE', content: 'stale update' });

    expect(next.messages).toEqual(state.messages);
  });
});
