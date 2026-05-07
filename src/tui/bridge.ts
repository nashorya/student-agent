import type { AppAction, TaskStatus } from './state.js';

export interface TUIBridge {
  dispatch: (action: AppAction) => void;
  addMessage: (role: 'user' | 'assistant' | 'tool' | 'system', content: string) => void;
  updateLastMessage: (content: string) => void;
  updateTaskStatus: (status: Partial<TaskStatus>) => void;
  clearTaskStatus: () => void;
}

export function createBridge(dispatch: (action: AppAction) => void): TUIBridge {
  return {
    dispatch,
    addMessage(role, content) {
      dispatch({
        type: 'ADD_MESSAGE',
        message: { role, content, timestamp: Date.now() },
      });
    },
    updateLastMessage(content) {
      dispatch({ type: 'UPDATE_LAST_MESSAGE', content });
    },
    updateTaskStatus(status) {
      dispatch({ type: 'UPDATE_TASK_STATUS', status });
    },
    clearTaskStatus() {
      dispatch({ type: 'CLEAR_TASK_STATUS' });
    },
  };
}
