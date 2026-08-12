import { describe, expect, it } from 'vitest';
import { TranscriptView } from '../components.js';
import { initialShellState, shellReducer, type ShellState } from '../state.js';

describe('TranscriptView activity timeline', () => {
  it('renders kind labels for timeline entries', () => {
    let state = initialShellState();
    state = shellReducer(state, { type: 'ADD_MESSAGE', kind: 'user', content: 'hi' });
    state = shellReducer(state, { type: 'ADD_MESSAGE', kind: 'reasoning', content: 'plan next step' });
    state = shellReducer(state, {
      type: 'ADD_MESSAGE',
      kind: 'tool',
      content: 'bash · ls',
      meta: { toolStatus: 'done' },
    });
    state = shellReducer(state, { type: 'ADD_MESSAGE', kind: 'assistant', content: 'done' });
    state = shellReducer(state, { type: 'ADD_MESSAGE', kind: 'error', content: 'boom' });
    state = shellReducer(state, { type: 'ADD_MESSAGE', kind: 'recovery', content: 'retry' });
    state = shellReducer(state, { type: 'ADD_MESSAGE', kind: 'verification', content: 'vitest' });

    const view = new TranscriptView(() => state);
    const text = view.render(80).join('\n');
    expect(text).toContain('You');
    expect(text).toContain('Thinking');
    expect(text).toContain('Tool');
    expect(text).toContain('Assistant');
    expect(text).toContain('Error');
    expect(text).toContain('Recovery');
    expect(text).toContain('Verify');
  });

  it('renders empty placeholder', () => {
    const state: ShellState = initialShellState();
    const view = new TranscriptView(() => state);
    expect(view.render(40).join('\n')).toContain('Transcript empty');
  });
});
