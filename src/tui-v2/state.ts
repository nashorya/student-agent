import type {
  TUIV2Action,
  TUIV2PromptKind,
  TUIV2Role,
  TUIV2TaskState,
  TUIV2TaskStatusUpdate,
} from './events.js';

export interface TUIV2Message {
  id: string;
  role: TUIV2Role;
  content: string;
  timestamp: number;
  status: 'streaming' | 'complete';
}

export interface TUIV2TranscriptState {
  messages: TUIV2Message[];
  nextMessageSeq: number;
}

export interface TUIV2StreamingState {
  id: string;
  messageId: string;
}

export interface TUIV2StatusState {
  transient: string;
  currentTool: string | null;
  pendingCount: number;
}

export interface TUIV2TaskPanelState {
  name?: string;
  phaseIndex?: number;
  totalPhases?: number;
  workflowStatus?: string;
  level?: 0 | 1 | 2 | 3 | 4;
  goal?: string;
  acceptanceCriteria?: string[];
  constraints?: string[];
  openQuestions?: string[];
  userPreferences?: string[];
  verificationSummary?: string[];
  requiresUserAcceptance?: boolean;
  requiresVisualReview?: boolean;
  retryCount?: number;
  toolCallCount?: number;
  elapsedMs?: number;
  state?: TUIV2TaskState;
}

export interface TUIV2PromptState {
  kind: TUIV2PromptKind;
  question: string;
}

export interface TUIV2OverlayState {
  message: string | null;
}

export interface TUIV2InputState {
  value: string;
  cursor: number;
  generation: number;
  history: string[];
  historyIndex: number;
  promptQuestion: string | null;
}

export interface TUIV2State {
  transcript: TUIV2TranscriptState;
  streaming: TUIV2StreamingState | null;
  status: TUIV2StatusState;
  taskPanel: TUIV2TaskPanelState | null;
  prompt: TUIV2PromptState | null;
  overlay: TUIV2OverlayState;
  input: TUIV2InputState;
  scrollOffset: number; // 0 = bottom (latest), positive = scrolled up N lines
}

export const initialTUIV2State: TUIV2State = {
  transcript: { messages: [], nextMessageSeq: 1 },
  streaming: null,
  status: { transient: '', currentTool: null, pendingCount: 0 },
  taskPanel: null,
  prompt: null,
  scrollOffset: 0,
  overlay: { message: null },
  input: {
    value: '',
    cursor: 0,
    generation: 0,
    history: [],
    historyIndex: 0,
    promptQuestion: null,
  },
};

export function tuiV2Reducer(state: TUIV2State, action: TUIV2Action): TUIV2State {
  switch (action.type) {
    case 'APPEND_MESSAGE':
      return { ...appendMessage(state, action.role, action.content), scrollOffset: 0 };

    case 'STREAM_START':
      return { ...startStream(state, action.id), scrollOffset: 0 };

    case 'STREAM_UPDATE':
      if (state.streaming?.id !== action.id) return state;
      return { ...updateMessageContent(state, state.streaming.messageId, action.text), scrollOffset: 0 };

    case 'STREAM_DISCARD':
      return state.streaming?.id === action.id
        ? removeMessage({ ...state, streaming: null }, state.streaming.messageId)
        : state;

    case 'STREAM_COMMIT':
      if (state.streaming?.id !== action.id) return state;
      return completeStream(state, state.streaming.messageId);

    case 'SET_STATUS':
      if (state.status.transient === action.text) return state;
      return { ...state, status: { ...state.status, transient: action.text } };

    case 'CLEAR_STATUS':
      return state.status.transient
        ? { ...state, status: { ...state.status, transient: '' } }
        : state;

    case 'UPDATE_TASK_STATUS':
      return updateTaskPanel(state, action.status);

    case 'CLEAR_TASK_STATUS':
      return state.taskPanel ? { ...state, taskPanel: null } : state;

    case 'SET_CURRENT_TOOL':
      if (state.status.currentTool === action.name) return state;
      return { ...state, status: { ...state.status, currentTool: action.name } };

    case 'SET_PENDING_COUNT':
      if (state.status.pendingCount === action.count) return state;
      return { ...state, status: { ...state.status, pendingCount: action.count } };

    case 'SET_INPUT':
      if (state.input.value === action.value && state.input.cursor === action.cursor) return state;
      return {
        ...state,
        input: {
          ...state.input,
          value: action.value,
          cursor: clampCursor(action.value, action.cursor),
        },
      };

    case 'CLEAR_INPUT':
      return {
        ...state,
        input: {
          ...state.input,
          value: '',
          cursor: 0,
          generation: state.input.generation + 1,
        },
      };

    case 'MOVE_CURSOR': {
      const nextCursor = action.direction === 'left'
        ? Math.max(0, state.input.cursor - 1)
        : Math.min(codepointLength(state.input.value), state.input.cursor + 1);
      return { ...state, input: { ...state.input, cursor: nextCursor } };
    }

    case 'ADD_TO_HISTORY': {
      if (!action.value.trim()) return state;
      const history = [...state.input.history, action.value];
      return {
        ...state,
        input: {
          ...state.input,
          history,
          historyIndex: history.length,
        },
      };
    }

    case 'NAVIGATE_HISTORY': {
      if (state.input.history.length === 0) return state;
      const historyIndex = action.direction === 'up'
        ? Math.max(0, state.input.historyIndex - 1)
        : Math.min(state.input.history.length, state.input.historyIndex + 1);
      const value = state.input.history[historyIndex] ?? '';
      return {
        ...state,
        input: {
          ...state.input,
          value,
          cursor: codepointLength(value),
          historyIndex,
        },
      };
    }

    case 'BEGIN_PROMPT':
      return {
        ...state,
        prompt: {
          kind: action.kind ?? 'settings',
          question: action.question,
        },
        input: {
          ...state.input,
          value: '',
          cursor: 0,
          generation: state.input.generation + 1,
          promptQuestion: action.question,
        },
      };

    case 'END_PROMPT':
      return {
        ...state,
        prompt: null,
        input: {
          ...state.input,
          value: '',
          cursor: 0,
          generation: state.input.generation + 1,
          promptQuestion: null,
        },
      };

    case 'SCROLL': {
      const next = Math.max(0, state.scrollOffset + action.delta);
      if (next === state.scrollOffset) return state;
      return { ...state, scrollOffset: next };
    }

    case 'CLEAR_SCREEN':
      return {
        transcript: { messages: [], nextMessageSeq: state.transcript.nextMessageSeq },
        streaming: null,
        scrollOffset: 0,
        status: { transient: '', currentTool: null, pendingCount: 0 },
        taskPanel: null,
        prompt: null,
        overlay: { message: null },
        input: {
          ...state.input,
          value: '',
          cursor: 0,
          generation: state.input.generation + 1,
          promptQuestion: null,
        },
      };
  }
}

function updateTaskPanel(state: TUIV2State, status: TUIV2TaskStatusUpdate): TUIV2State {
  const existing = state.taskPanel ?? {};
  const next = { ...existing, ...status };

  if (isBareIdleTaskUpdate(next)) {
    return {
      ...state,
      taskPanel: null,
      status: { ...state.status, transient: '' },
    };
  }

  return {
    ...state,
    taskPanel: next,
  };
}

function isBareIdleTaskUpdate(status: TUIV2TaskPanelState): boolean {
  return status.state === 'idle' && !status.name;
}

function appendMessage(
  state: TUIV2State,
  role: TUIV2Role,
  content: string,
): TUIV2State {
  const id = `msg_${state.transcript.nextMessageSeq}`;
  const message = { id, role, content, timestamp: Date.now(), status: 'complete' as const };
  return {
    ...state,
    transcript: {
      nextMessageSeq: state.transcript.nextMessageSeq + 1,
      messages: [...state.transcript.messages, message],
    },
  };
}

function startStream(state: TUIV2State, streamId: string): TUIV2State {
  const cleanedState = state.streaming
    ? removeMessage({ ...state, streaming: null }, state.streaming.messageId)
    : state;
  const messageId = `msg_${cleanedState.transcript.nextMessageSeq}`;
  const message: TUIV2Message = {
    id: messageId,
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    status: 'streaming',
  };
  return {
    ...cleanedState,
    streaming: { id: streamId, messageId },
    transcript: {
      nextMessageSeq: cleanedState.transcript.nextMessageSeq + 1,
      messages: [...cleanedState.transcript.messages, message],
    },
  };
}

function updateMessageContent(state: TUIV2State, messageId: string, content: string): TUIV2State {
  const index = state.transcript.messages.findIndex((message) => message.id === messageId);
  if (index === -1) return state;
  const message = state.transcript.messages[index];
  if (message.content === content) return state;
  return {
    ...state,
    transcript: {
      ...state.transcript,
      messages: [
        ...state.transcript.messages.slice(0, index),
        { ...message, content },
        ...state.transcript.messages.slice(index + 1),
      ],
    },
  };
}

function completeStream(state: TUIV2State, messageId: string): TUIV2State {
  const index = state.transcript.messages.findIndex((message) => message.id === messageId);
  if (index === -1) return { ...state, streaming: null };
  const message = state.transcript.messages[index];
  if (!message.content.trim()) return removeMessage({ ...state, streaming: null }, messageId);
  return {
    ...state,
    streaming: null,
    transcript: {
      ...state.transcript,
      messages: [
        ...state.transcript.messages.slice(0, index),
        { ...message, status: 'complete' },
        ...state.transcript.messages.slice(index + 1),
      ],
    },
  };
}

function removeMessage(state: TUIV2State, messageId: string): TUIV2State {
  const messages = state.transcript.messages.filter((message) => message.id !== messageId);
  if (messages.length === state.transcript.messages.length) return state;
  return {
    ...state,
    transcript: { ...state.transcript, messages },
  };
}

function clampCursor(value: string, cursor: number): number {
  return Math.max(0, Math.min(codepointLength(value), cursor));
}

function codepointLength(value: string): number {
  return Array.from(value).length;
}
