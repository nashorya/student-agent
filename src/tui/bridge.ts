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
  let lastMessageContent = '';
  let currentTool: string | null = null;
  let taskStatus: Partial<TaskStatus> | null = null;
  return {
    dispatch,
    addMessage(role, content) {
      if (role === 'assistant') {
        lastMessageContent = content;
      } else if (role === 'user' || role === 'tool') {
        lastMessageContent = '';
      }
      dispatch({
        type: 'ADD_MESSAGE',
        message: { role, content, timestamp: Date.now() },
      });
    },
    updateLastMessage(content) {
      if (content === lastMessageContent) return;
      lastMessageContent = content;
      dispatch({ type: 'UPDATE_LAST_MESSAGE', content });
    },
    updateTaskStatus(status) {
      const next = { ...(taskStatus ?? {}), ...status };
      if (taskStatus && shallowEqual(taskStatus, next)) return;
      taskStatus = next;
      dispatch({ type: 'UPDATE_TASK_STATUS', status });
    },
    clearTaskStatus() {
      taskStatus = null;
      dispatch({ type: 'CLEAR_TASK_STATUS' });
    },
    setCurrentTool(name) {
      if (name === currentTool) return;
      currentTool = name;
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

function shallowEqual(left: Partial<TaskStatus>, right: Partial<TaskStatus>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const typedKey = key as keyof TaskStatus;
    if (left[typedKey] !== right[typedKey]) return false;
  }
  return true;
}
