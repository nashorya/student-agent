import type { AppAction, TaskStatus, SettingsPrompt } from './state.js';

export interface TUIBridge {
  dispatch: (action: AppAction) => void;
  addMessage: (role: 'user' | 'assistant' | 'tool' | 'system' | 'error', content: string) => void;
  updateLastMessage: (content: string) => void;
  updateTaskStatus: (status: Partial<TaskStatus>) => void;
  clearTaskStatus: () => void;
  setCurrentTool: (name: string | null) => void;
  promptSettings: (question: string) => Promise<string>;
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
    setCurrentTool(name) {
      dispatch({ type: 'SET_CURRENT_TOOL', name });
    },
    promptSettings(question) {
      return new Promise<string>((resolve) => {
        const prompt: SettingsPrompt = {
          question,
          resolve: (answer) => {
            dispatch({ type: 'SET_SETTINGS_PROMPT', prompt: null });
            resolve(answer);
          },
        };
        dispatch({ type: 'SET_SETTINGS_PROMPT', prompt });
      });
    },
  };
}
