import { describe, expect, it } from 'vitest';
import { initialShellState, shellReducer } from '../state.js';

describe('shellReducer', () => {
  it('starts empty', () => {
    const state = initialShellState();
    expect(state.messages).toEqual([]);
    expect(state.streamingAssistantId).toBeNull();
    expect(state.streamingReasoningId).toBeNull();
    expect(state.planSteps).toEqual([]);
    expect(state.agents).toEqual([]);
  });

  it('adds messages and tracks streaming assistant', () => {
    let state = initialShellState();
    state = shellReducer(state, { type: 'ADD_MESSAGE', kind: 'user', content: 'hi', id: 'u1' });
    state = shellReducer(state, { type: 'ADD_MESSAGE', kind: 'assistant', content: '', id: 'a1' });
    expect(state.streamingAssistantId).toBe('a1');
    state = shellReducer(state, { type: 'UPDATE_LAST_MESSAGE', content: 'hello' });
    expect(state.messages.find((m) => m.id === 'a1')?.content).toBe('hello');
    state = shellReducer(state, { type: 'END_ASSISTANT_MESSAGE' });
    expect(state.streamingAssistantId).toBeNull();
  });

  it('tracks reasoning stream separately from assistant', () => {
    let state = initialShellState();
    state = shellReducer(state, { type: 'ADD_MESSAGE', kind: 'reasoning', content: '', id: 'r1' });
    state = shellReducer(state, { type: 'ADD_MESSAGE', kind: 'assistant', content: '', id: 'a1' });
    expect(state.streamingReasoningId).toBe('r1');
    expect(state.streamingAssistantId).toBe('a1');
    state = shellReducer(state, { type: 'UPDATE_STREAM', target: 'reasoning', content: 'think' });
    state = shellReducer(state, { type: 'UPDATE_STREAM', target: 'assistant', content: 'say' });
    expect(state.messages.find((m) => m.id === 'r1')?.content).toBe('think');
    expect(state.messages.find((m) => m.id === 'a1')?.content).toBe('say');
    state = shellReducer(state, { type: 'END_STREAM', target: 'reasoning' });
    expect(state.streamingReasoningId).toBeNull();
    expect(state.streamingAssistantId).toBe('a1');
  });

  it('discards streaming assistant message', () => {
    let state = initialShellState();
    state = shellReducer(state, { type: 'ADD_MESSAGE', kind: 'assistant', content: 'tmp', id: 'a1' });
    state = shellReducer(state, { type: 'DISCARD_ASSISTANT_MESSAGE' });
    expect(state.messages).toHaveLength(0);
    expect(state.streamingAssistantId).toBeNull();
  });

  it('updates status, tool, task, pending, plan, agents', () => {
    let state = initialShellState();
    state = shellReducer(state, { type: 'SET_STATUS', text: 'working' });
    state = shellReducer(state, { type: 'SET_CURRENT_TOOL', name: 'bash' });
    state = shellReducer(state, { type: 'UPDATE_TASK_STATUS', status: { state: 'running', name: 't1' } });
    state = shellReducer(state, { type: 'SET_PENDING_COUNT', count: 2 });
    state = shellReducer(state, {
      type: 'SET_PLAN_STEPS',
      steps: [{ id: '1', title: 'a', status: 'todo' }],
    });
    state = shellReducer(state, {
      type: 'SET_AGENTS',
      agents: [{ id: 'm', name: 'main', status: 'running' }],
    });
    expect(state.statusText).toBe('working');
    expect(state.currentTool).toBe('bash');
    expect(state.taskStatus?.state).toBe('running');
    expect(state.pendingCount).toBe(2);
    expect(state.planSteps).toHaveLength(1);
    expect(state.agents).toHaveLength(1);

    state = shellReducer(state, { type: 'CLEAR_STATUS' });
    state = shellReducer(state, { type: 'CLEAR_TASK_STATUS' });
    expect(state.statusText).toBe('');
    expect(state.taskStatus).toBeNull();
  });

  it('clears transcript', () => {
    let state = initialShellState();
    state = shellReducer(state, { type: 'ADD_MESSAGE', kind: 'user', content: 'x' });
    state = shellReducer(state, { type: 'CLEAR_TRANSCRIPT' });
    expect(state.messages).toEqual([]);
    expect(state.streamingAssistantId).toBeNull();
    expect(state.streamingReasoningId).toBeNull();
  });
});
