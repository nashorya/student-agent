import { createContext, useContext } from 'react';

export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system';
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
  state: 'running' | 'idle' | 'failed';
}

export interface AppState {
  messages: Message[];
  taskStatus: TaskStatus | null;
  inputValue: string;
  inputHistory: string[];
  historyIndex: number;
}

export type AppAction =
  | { type: 'ADD_MESSAGE'; message: Message }
  | { type: 'UPDATE_LAST_MESSAGE'; content: string }
  | { type: 'UPDATE_TASK_STATUS'; status: Partial<TaskStatus> }
  | { type: 'CLEAR_TASK_STATUS' }
  | { type: 'SET_INPUT'; value: string }
  | { type: 'ADD_TO_HISTORY'; value: string }
  | { type: 'NAVIGATE_HISTORY'; direction: 'up' | 'down' };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.message] };
    case 'UPDATE_LAST_MESSAGE': {
      const messages = [...state.messages];
      if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
        messages[messages.length - 1] = {
          ...messages[messages.length - 1],
          content: action.content,
        };
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
    case 'SET_INPUT':
      return { ...state, inputValue: action.value };
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
      return {
        ...state,
        historyIndex: newIndex,
        inputValue: state.inputHistory[newIndex] ?? '',
      };
    }
    default:
      return state;
  }
}

export const initialAppState: AppState = {
  messages: [],
  taskStatus: null,
  inputValue: '',
  inputHistory: [],
  historyIndex: 0,
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
