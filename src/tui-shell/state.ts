import type { UiTaskStatus } from '../runtime/ui-bridge.js';

export type ShellMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system' | 'error';
  content: string;
  timestamp: number;
};

export type ShellPlanStep = {
  id: string;
  title: string;
  status: 'done' | 'active' | 'todo';
};

export type ShellAgentRow = {
  id: string;
  name: string;
  status: 'running' | 'done' | 'failed';
  summary?: string;
  elapsedMs?: number;
};

export type ShellState = {
  messages: ShellMessage[];
  streamingAssistantId: string | null;
  statusText: string;
  currentTool: string | null;
  taskStatus: Partial<UiTaskStatus> | null;
  pendingCount: number;
  /** Phase 1 placeholders for layout (full Plan wiring is Phase 3). */
  planSteps: ShellPlanStep[];
  agents: ShellAgentRow[];
};

export type ShellAction =
  | { type: 'ADD_MESSAGE'; role: ShellMessage['role']; content: string; id?: string }
  | { type: 'UPDATE_LAST_MESSAGE'; content: string }
  | { type: 'END_ASSISTANT_MESSAGE' }
  | { type: 'DISCARD_ASSISTANT_MESSAGE' }
  | { type: 'UPDATE_TASK_STATUS'; status: Partial<UiTaskStatus> }
  | { type: 'CLEAR_TASK_STATUS' }
  | { type: 'SET_CURRENT_TOOL'; name: string | null }
  | { type: 'SET_STATUS'; text: string }
  | { type: 'CLEAR_STATUS' }
  | { type: 'SET_PENDING_COUNT'; count: number }
  | { type: 'SET_PLAN_STEPS'; steps: ShellPlanStep[] }
  | { type: 'SET_AGENTS'; agents: ShellAgentRow[] }
  | { type: 'CLEAR_TRANSCRIPT' };

let nextId = 0;

function allocId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

export function initialShellState(): ShellState {
  return {
    messages: [],
    streamingAssistantId: null,
    statusText: '',
    currentTool: null,
    taskStatus: null,
    pendingCount: 0,
    planSteps: [],
    agents: [],
  };
}

export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case 'ADD_MESSAGE': {
      const id = action.id ?? allocId(action.role);
      const message: ShellMessage = {
        id,
        role: action.role,
        content: action.content,
        timestamp: Date.now(),
      };
      const streamingAssistantId =
        action.role === 'assistant' ? id : state.streamingAssistantId;
      return {
        ...state,
        messages: [...state.messages, message],
        streamingAssistantId,
      };
    }

    case 'UPDATE_LAST_MESSAGE': {
      if (state.messages.length === 0) return state;
      const targetId = state.streamingAssistantId ?? state.messages[state.messages.length - 1]!.id;
      return {
        ...state,
        messages: state.messages.map((msg) =>
          msg.id === targetId ? { ...msg, content: action.content } : msg,
        ),
      };
    }

    case 'END_ASSISTANT_MESSAGE':
      return { ...state, streamingAssistantId: null };

    case 'DISCARD_ASSISTANT_MESSAGE': {
      if (!state.streamingAssistantId) return state;
      return {
        ...state,
        messages: state.messages.filter((msg) => msg.id !== state.streamingAssistantId),
        streamingAssistantId: null,
      };
    }

    case 'UPDATE_TASK_STATUS':
      return {
        ...state,
        taskStatus: { ...(state.taskStatus ?? {}), ...action.status },
      };

    case 'CLEAR_TASK_STATUS':
      return { ...state, taskStatus: null };

    case 'SET_CURRENT_TOOL':
      return { ...state, currentTool: action.name };

    case 'SET_STATUS':
      return { ...state, statusText: action.text };

    case 'CLEAR_STATUS':
      return { ...state, statusText: '' };

    case 'SET_PENDING_COUNT':
      return { ...state, pendingCount: Math.max(0, action.count) };

    case 'SET_PLAN_STEPS':
      return { ...state, planSteps: action.steps };

    case 'SET_AGENTS':
      return { ...state, agents: action.agents };

    case 'CLEAR_TRANSCRIPT':
      return {
        ...state,
        messages: [],
        streamingAssistantId: null,
      };

    default:
      return state;
  }
}
