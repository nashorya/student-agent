import { describe, expect, it, vi } from 'vitest';
import { createBridge } from '../bridge.js';
import type { AppAction } from '../state.js';

describe('createBridge', () => {
  it('重复 task status 不重复 dispatch', () => {
    const dispatch = vi.fn<(action: AppAction) => void>();
    const bridge = createBridge(dispatch);

    bridge.updateTaskStatus({ state: 'running' });
    bridge.updateTaskStatus({ state: 'running' });
    bridge.updateTaskStatus({ state: 'idle' });

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0]?.[0]).toEqual({
      type: 'UPDATE_TASK_STATUS',
      status: { state: 'running' },
    });
    expect(dispatch.mock.calls[1]?.[0]).toEqual({
      type: 'UPDATE_TASK_STATUS',
      status: { state: 'idle' },
    });
  });

  it('重复 current tool 不重复 dispatch', () => {
    const dispatch = vi.fn<(action: AppAction) => void>();
    const bridge = createBridge(dispatch);

    bridge.setCurrentTool('bash');
    bridge.setCurrentTool('bash');
    bridge.setCurrentTool(null);
    bridge.setCurrentTool(null);

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0]?.[0]).toEqual({ type: 'SET_CURRENT_TOOL', name: 'bash' });
    expect(dispatch.mock.calls[1]?.[0]).toEqual({ type: 'SET_CURRENT_TOOL', name: null });
  });

  it('重复 last message 不重复 dispatch，新增消息后重置去重状态', () => {
    const dispatch = vi.fn<(action: AppAction) => void>();
    const bridge = createBridge(dispatch);

    bridge.addMessage('assistant', '');
    bridge.updateLastMessage('hello');
    bridge.updateLastMessage('hello');
    bridge.addMessage('assistant', 'hello');
    bridge.updateLastMessage('hello');

    expect(dispatch.mock.calls.map((call) => call[0].type)).toEqual([
      'ADD_MESSAGE',
      'UPDATE_LAST_MESSAGE',
      'ADD_MESSAGE',
    ]);
  });
});
