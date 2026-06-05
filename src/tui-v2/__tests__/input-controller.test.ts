import { describe, expect, it, vi } from 'vitest';
import { createInputController } from '../input-controller.js';
import { initialTUIV2State, tuiV2Reducer, type TUIV2State } from '../state.js';

function createHarness(initialState: TUIV2State = initialTUIV2State) {
  let state = initialState;
  const onSubmit = vi.fn();
  const onAbort = vi.fn();
  const onExit = vi.fn();
  const controller = createInputController({
    getState: () => state,
    dispatch: (action) => {
      state = tuiV2Reducer(state, action);
    },
    onSubmit,
    onAbort,
    onExit,
  });

  return {
    controller,
    state: () => state,
    onSubmit,
    onAbort,
    onExit,
  };
}

describe('createInputController', () => {
  it('clears draft on escape before aborting', () => {
    const harness = createHarness(tuiV2Reducer(initialTUIV2State, {
      type: 'SET_INPUT',
      value: 'draft',
      cursor: 5,
    }));

    harness.controller.handleKey('\x1b');

    expect(harness.state().input.value).toBe('');
    expect(harness.onAbort).not.toHaveBeenCalled();

    harness.controller.handleKey('\x1b');

    expect(harness.onAbort).toHaveBeenCalledTimes(1);
  });

  it('submits, records history, and clears draft on enter', () => {
    const harness = createHarness(tuiV2Reducer(initialTUIV2State, {
      type: 'SET_INPUT',
      value: 'hello',
      cursor: 5,
    }));

    harness.controller.handleKey('\n');

    expect(harness.onSubmit).toHaveBeenCalledWith('hello');
    expect(harness.state().input.value).toBe('');
    expect(harness.state().input.history).toEqual(['hello']);
  });

  it('edits at the cursor with left and right arrow keys', () => {
    const harness = createHarness();

    harness.controller.handleData('abc');
    harness.controller.handleData('\x1b[D');
    harness.controller.handleData('X');
    harness.controller.handleData('\x1b[C');
    harness.controller.handleData('Y');

    expect(harness.state().input.value).toBe('abXcY');
    expect(harness.state().input.cursor).toBe(5);
  });

  it('navigates input history', () => {
    const harness = createHarness();

    harness.controller.handleData('first');
    harness.controller.handleKey('\n');
    harness.controller.handleData('second');
    harness.controller.handleKey('\n');
    harness.controller.handleData('\x1b[A');

    expect(harness.state().input.value).toBe('second');

    harness.controller.handleData('\x1b[A');

    expect(harness.state().input.value).toBe('first');

    harness.controller.handleData('\x1b[B');

    expect(harness.state().input.value).toBe('second');
  });

  it('buffers bracketed paste as one multiline draft', () => {
    const harness = createHarness();

    harness.controller.handleData('\x1b[200~第一行\n第二行\x1b[201~');
    harness.controller.handleKey('\n');

    expect(harness.onSubmit).toHaveBeenCalledWith('第一行\n第二行');
  });

  it('handles Kitty protocol ctrl+c as exit without polluting the draft', () => {
    const harness = createHarness();

    harness.controller.handleData('\x1b[99;5u');

    expect(harness.onExit).toHaveBeenCalledTimes(1);
    expect(harness.onAbort).not.toHaveBeenCalled();
    expect(harness.state().input.value).toBe('');
  });

  it('uses ctrl+c to abort while assistant output is streaming', () => {
    const harness = createHarness({
      ...initialTUIV2State,
      transcript: {
        nextMessageSeq: 2,
        messages: [{ id: 'msg_1', role: 'assistant', content: 'working', timestamp: 1, status: 'streaming' }],
      },
      streaming: { id: 'stream_1', messageId: 'msg_1' },
    });

    harness.controller.handleData('\x1b[99;5u');

    expect(harness.onAbort).toHaveBeenCalledTimes(1);
    expect(harness.onExit).not.toHaveBeenCalled();
    expect(harness.state().input.value).toBe('');
  });

  it('resolves prompt answers without submitting normal input', async () => {
    const harness = createHarness();
    const answer = harness.controller.prompt('选择设置项');

    expect(harness.state().input.promptQuestion).toBe('选择设置项');

    harness.controller.handleData('2');
    harness.controller.handleKey('\n');

    await expect(answer).resolves.toBe('2');
    expect(harness.onSubmit).not.toHaveBeenCalled();
    expect(harness.state().input.promptQuestion).toBeNull();
  });
});
