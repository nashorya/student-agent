import { describe, expect, it, vi } from 'vitest';
import { createShellBridge } from '../bridge.js';
import { initialShellState, shellReducer, type ShellAction, type ShellState } from '../state.js';

describe('createShellBridge', () => {
  it('dispatches UiBridge ops and requests render', async () => {
    let state = initialShellState();
    const actions: ShellAction[] = [];
    const requestRender = vi.fn();
    const promptSettings = vi.fn(async () => 'ok');

    const bridge = createShellBridge({
      getState: () => state,
      dispatch: (action) => {
        actions.push(action);
        state = shellReducer(state, action);
      },
      requestRender,
      promptSettings,
    });

    bridge.addMessage('user', 'hi');
    bridge.addMessage('assistant', '');
    bridge.updateLastMessage('hello');
    bridge.endAssistantMessage();
    bridge.addMessage('reasoning', '');
    bridge.updateReasoningMessage('think');
    bridge.endReasoningMessage();
    bridge.setStatus('busy');
    bridge.setCurrentTool('read');
    bridge.updateTaskStatus({ state: 'running' });
    bridge.clearTaskStatus();
    bridge.clearStatus();
    bridge.setCurrentTool(null);
    bridge.forceRedraw();

    expect(actions.map((a) => a.type)).toEqual([
      'ADD_MESSAGE',
      'ADD_MESSAGE',
      'UPDATE_LAST_MESSAGE',
      'END_ASSISTANT_MESSAGE',
      'ADD_MESSAGE',
      'UPDATE_STREAM',
      'END_STREAM',
      'SET_STATUS',
      'SET_CURRENT_TOOL',
      'UPDATE_TASK_STATUS',
      'CLEAR_TASK_STATUS',
      'CLEAR_STATUS',
      'SET_CURRENT_TOOL',
    ]);
    expect(requestRender).toHaveBeenCalled();
    expect(await bridge.promptSettings('q?')).toBe('ok');
    expect(promptSettings).toHaveBeenCalledWith('q?');

    const discardState: ShellState = shellReducer(initialShellState(), {
      type: 'ADD_MESSAGE',
      kind: 'assistant',
      content: 'tmp',
      id: 'a1',
    });
    state = discardState;
    bridge.discardAssistantMessage();
    expect(state.messages).toHaveLength(0);
  });
});
