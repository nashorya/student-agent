import { createContext, useContext } from 'react';

export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system' | 'error';
  content: string;
  timestamp: number;
}

export interface TaskStatus {
  name: string;
  phaseIndex: number;
  totalPhases: number;
  retryCount: number;
  toolCallCount: number;
  elapsedMs: number;
  state: 'running' | 'aborting' | 'idle' | 'failed';
}

export interface SettingsPrompt {
  question: string;
  resolve: (answer: string) => void;
}

export interface AppState {
  messages: Message[];
  taskStatus: TaskStatus | null;
  currentTool: string | null;
  inputValue: string;
  cursorPos: number;
  inputHistory: string[];
  historyIndex: number;
  settingsPrompt: SettingsPrompt | null;
}

export type AppAction =
  | { type: 'ADD_MESSAGE'; message: Message }
  | { type: 'UPDATE_LAST_MESSAGE'; content: string }
  | { type: 'UPDATE_TASK_STATUS'; status: Partial<TaskStatus> }
  | { type: 'CLEAR_TASK_STATUS' }
  | { type: 'SET_CURRENT_TOOL'; name: string | null }
  | { type: 'SET_INPUT'; value: string; cursorPos?: number }
  | { type: 'MOVE_CURSOR'; direction: 'left' | 'right' }
  | { type: 'ADD_TO_HISTORY'; value: string }
  | { type: 'NAVIGATE_HISTORY'; direction: 'up' | 'down' }
  | { type: 'SET_SETTINGS_PROMPT'; prompt: SettingsPrompt | null };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.message] };
    case 'UPDATE_LAST_MESSAGE': {
      const messages = [...state.messages];
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (!message) continue;
        if (message.role === 'assistant') {
          messages[i] = {
            ...message,
            content: action.content,
          };
          return { ...state, messages };
        }
        if (message.role === 'user' || message.role === 'tool') {
          break;
        }
      }
      return { ...state, messages };
    }
    case 'UPDATE_TASK_STATUS':
      return {
        ...state,
        taskStatus: state.taskStatus
          ? { ...state.taskStatus, ...action.status }
          : (action.status as TaskStatus),
      };
    case 'CLEAR_TASK_STATUS':
      return { ...state, taskStatus: null };
    case 'SET_CURRENT_TOOL':
      return { ...state, currentTool: action.name };
    case 'SET_INPUT': {
      const cursorPos = action.cursorPos ?? action.value.length;
      return { ...state, inputValue: action.value, cursorPos };
    }
    case 'MOVE_CURSOR': {
      const newPos = action.direction === 'left'
        ? Math.max(0, state.cursorPos - 1)
        : Math.min(state.inputValue.length, state.cursorPos + 1);
      return { ...state, cursorPos: newPos };
    }
    case 'ADD_TO_HISTORY':
      return {
        ...state,
        inputHistory: [...state.inputHistory, action.value],
        historyIndex: state.inputHistory.length + 1,
      };
    case 'NAVIGATE_HISTORY': {
      const newIndex =
        action.direction === 'up'
          ? Math.max(0, state.historyIndex - 1)
          : Math.min(state.inputHistory.length, state.historyIndex + 1);
      const newValue = state.inputHistory[newIndex] ?? '';
      return {
        ...state,
        historyIndex: newIndex,
        inputValue: newValue,
        cursorPos: newValue.length,
      };
    }
    case 'SET_SETTINGS_PROMPT':
      return { ...state, settingsPrompt: action.prompt };
    default:
      return state;
  }
}

export const initialAppState: AppState = {
  messages: [],
  taskStatus: null,
  currentTool: null,
  inputValue: '',
  cursorPos: 0,
  inputHistory: [],
  historyIndex: 0,
  settingsPrompt: null,
};

export const AppStateContext = createContext<{
  state: AppState;
  dispatch: (action: AppAction) => void;
} | null>(null);

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
