import { describe, expect, it } from 'vitest';
import { initialTUIV2State, tuiV2Reducer } from '../state.js';

describe('tuiV2Reducer', () => {
  it('keeps status updates out of transcript and input', () => {
    const state = tuiV2Reducer(initialTUIV2State, {
      type: 'SET_STATUS',
      text: '正在调用 bash',
    });

    expect(state.status.transient).toBe('正在调用 bash');
    expect(state.transcript.messages).toEqual([]);
    expect(state.input.value).toBe('');
  });

  it('keeps task status in the task panel instead of transcript or transient status', () => {
    const state = tuiV2Reducer(initialTUIV2State, {
      type: 'UPDATE_TASK_STATUS',
      status: {
        name: '重做 TUI',
        phaseIndex: 0,
        totalPhases: 3,
        workflowStatus: 'planning',
        retryCount: 1,
        toolCallCount: 2,
        elapsedMs: 1200,
        state: 'running',
      },
    });

    expect(state.taskPanel).toEqual(expect.objectContaining({
      name: '重做 TUI',
      phaseIndex: 0,
      totalPhases: 3,
      workflowStatus: 'planning',
      retryCount: 1,
      state: 'running',
    }));
    expect(state.status.transient).toBe('');
    expect(state.transcript.messages).toEqual([]);
  });

  it('keeps prompt questions in the prompt layer instead of transcript', () => {
    const state = tuiV2Reducer(initialTUIV2State, {
      type: 'BEGIN_PROMPT',
      question: '规划没成：规划格式不完整。\n选择 [1]: ',
      kind: 'planning-recovery',
    });

    expect(state.prompt).toEqual({
      kind: 'planning-recovery',
      question: '规划没成：规划格式不完整。\n选择 [1]: ',
    });
    expect(state.input.promptQuestion).toBe('规划没成：规划格式不完整。\n选择 [1]: ');
    expect(state.transcript.messages).toEqual([]);
  });

  it('keeps stream updates in a stable provisional transcript slot', () => {
    let state = tuiV2Reducer(initialTUIV2State, { type: 'STREAM_START', id: 's1' });
    state = tuiV2Reducer(state, { type: 'STREAM_UPDATE', id: 's1', text: 'hello' });

    expect(state.streaming?.messageId).toBe(state.transcript.messages[0].id);
    expect(state.transcript.messages).toHaveLength(1);
    expect(state.transcript.messages[0]).toEqual(
      expect.objectContaining({ role: 'assistant', content: 'hello', status: 'streaming' }),
    );
  });

  it('commits the provisional assistant message without adding a duplicate', () => {
    let state = tuiV2Reducer(initialTUIV2State, { type: 'STREAM_START', id: 's1' });
    state = tuiV2Reducer(state, { type: 'STREAM_UPDATE', id: 's1', text: 'hello' });
    const messageId = state.transcript.messages[0].id;
    state = tuiV2Reducer(state, { type: 'STREAM_COMMIT', id: 's1' });

    expect(state.streaming).toBeNull();
    expect(state.transcript.messages).toEqual([
      expect.objectContaining({ id: messageId, role: 'assistant', content: 'hello', status: 'complete' }),
    ]);
  });

  it('commits active streaming output before inputs queued during that stream', () => {
    let state = tuiV2Reducer(initialTUIV2State, { type: 'STREAM_START', id: 's1' });
    state = tuiV2Reducer(state, { type: 'STREAM_UPDATE', id: 's1', text: 'hello' });
    state = tuiV2Reducer(state, { type: 'APPEND_MESSAGE', role: 'user', content: '/quit' });
    state = tuiV2Reducer(state, { type: 'STREAM_COMMIT', id: 's1' });

    expect(state.transcript.messages.map((message) => message.role)).toEqual(['assistant', 'user']);
    expect(state.transcript.messages.map((message) => message.content)).toEqual(['hello', '/quit']);
  });

  it('ignores stale stream updates for a non-active stream id', () => {
    let state = tuiV2Reducer(initialTUIV2State, { type: 'STREAM_START', id: 's1' });
    state = tuiV2Reducer(state, { type: 'STREAM_UPDATE', id: 'stale', text: 'wrong' });

    expect(state.transcript.messages[0]).toEqual(
      expect.objectContaining({ content: '', status: 'streaming' }),
    );
  });

  it('discard removes the provisional assistant message', () => {
    let state = tuiV2Reducer(initialTUIV2State, { type: 'STREAM_START', id: 's1' });
    state = tuiV2Reducer(state, { type: 'STREAM_UPDATE', id: 's1', text: 'preview' });
    state = tuiV2Reducer(state, { type: 'STREAM_DISCARD', id: 's1' });

    expect(state.streaming).toBeNull();
    expect(state.transcript.messages).toEqual([]);
  });

  it('clear resets transcript, streaming, status, and input together', () => {
    let state = tuiV2Reducer(initialTUIV2State, {
      type: 'APPEND_MESSAGE',
      role: 'user',
      content: 'hi',
    });
    state = tuiV2Reducer(state, { type: 'STREAM_START', id: 's1' });
    state = tuiV2Reducer(state, { type: 'STREAM_UPDATE', id: 's1', text: 'partial' });
    state = tuiV2Reducer(state, { type: 'SET_INPUT', value: 'draft', cursor: 5 });
    state = tuiV2Reducer(state, { type: 'SET_STATUS', text: 'busy' });
    state = tuiV2Reducer(state, { type: 'CLEAR_SCREEN' });

    expect(state.transcript.messages).toEqual([]);
    expect(state.streaming).toBeNull();
    expect(state.status.transient).toBe('');
    expect(state.input.value).toBe('');
    expect(state.input.cursor).toBe(0);
    expect(state.taskPanel).toBeNull();
    expect(state.prompt).toBeNull();
  });
});
