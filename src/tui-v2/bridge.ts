import type { AppAction, TaskStatus } from '../tui/state.js';
import type { TUIBridge } from '../tui/bridge.js';
import type { TUIV2Action } from './events.js';
import { initialTUIV2State, tuiV2Reducer, type TUIV2State } from './state.js';

export type TUIV2DispatchAction = TUIV2Action | AppAction;

export interface TUIV2Bridge extends Omit<TUIBridge, 'dispatch'> {
  dispatch: (action: TUIV2DispatchAction) => void;
  clear: () => void;
  forceRedraw: () => void;
}

export function createTUIV2Bridge(options: {
  dispatch: (action: TUIV2Action) => void;
  getStreamId: () => string;
  prompt?: (question: string) => Promise<string>;
}): TUIV2Bridge {
  let activeStreamId: string | null = null;
  let taskStatus: Partial<TaskStatus> | null = null;

  const dispatch = (action: TUIV2DispatchAction) => {
    const mapped = mapExternalAction(action);
    if (mapped) options.dispatch(mapped);
  };

  return {
    dispatch,

    addMessage(role, content) {
      if (role === 'assistant') {
        activeStreamId = options.getStreamId();
        options.dispatch({ type: 'STREAM_START', id: activeStreamId });
        if (content) options.dispatch({ type: 'STREAM_UPDATE', id: activeStreamId, text: content });
        return;
      }
      options.dispatch({ type: 'APPEND_MESSAGE', role, content });
    },

    updateLastMessage(content) {
      if (!activeStreamId) return;
      options.dispatch({ type: 'STREAM_UPDATE', id: activeStreamId, text: content });
    },

    endAssistantMessage() {
      if (!activeStreamId) return;
      options.dispatch({ type: 'STREAM_COMMIT', id: activeStreamId });
      activeStreamId = null;
    },

    discardAssistantMessage() {
      if (!activeStreamId) return;
      options.dispatch({ type: 'STREAM_DISCARD', id: activeStreamId });
      activeStreamId = null;
    },

    updateTaskStatus(status: Partial<TaskStatus>) {
      const next = { ...(taskStatus ?? {}), ...status };
      if (next.state === 'idle' && !next.name) {
        taskStatus = null;
        options.dispatch({ type: 'CLEAR_TASK_STATUS' });
        options.dispatch({ type: 'CLEAR_STATUS' });
        return;
      }
      if (taskStatus && shallowEqualTaskStatus(taskStatus, next)) return;
      taskStatus = next;
      options.dispatch({ type: 'UPDATE_TASK_STATUS', status });
    },

    clearTaskStatus() {
      taskStatus = null;
      options.dispatch({ type: 'CLEAR_TASK_STATUS' });
    },

    setCurrentTool(name) {
      options.dispatch({ type: 'SET_CURRENT_TOOL', name });
    },

    setStatus(text) {
      options.dispatch({ type: 'SET_STATUS', text });
    },

    clearStatus() {
      options.dispatch({ type: 'CLEAR_STATUS' });
    },

    promptSettings(question) {
      if (options.prompt) return options.prompt(question);
      return Promise.resolve('');
    },

    clear() {
      options.dispatch({ type: 'CLEAR_SCREEN' });
    },

    forceRedraw() {
      options.dispatch({ type: 'FORCE_REDRAW' });
    },
  };
}

export function createTUIV2BridgeForTest() {
  let state: TUIV2State = initialTUIV2State;
  let seq = 0;
  const bridge = createTUIV2Bridge({
    dispatch(action) {
      state = tuiV2Reducer(state, action);
    },
    getStreamId() {
      seq += 1;
      return `stream_${seq}`;
    },
  });
  return { bridge, state: () => state };
}

function mapExternalAction(action: TUIV2DispatchAction): TUIV2Action | null {
  switch (action.type) {
    case 'SET_INPUT':
      return {
        type: 'SET_INPUT',
        value: action.value,
        cursor: 'cursor' in action ? action.cursor : action.cursorPos ?? action.value.length,
      };
    case 'APPEND_MESSAGE':
    case 'STREAM_START':
    case 'STREAM_UPDATE':
    case 'STREAM_DISCARD':
    case 'STREAM_COMMIT':
    case 'SET_STATUS':
    case 'CLEAR_STATUS':
    case 'UPDATE_TASK_STATUS':
    case 'CLEAR_TASK_STATUS':
    case 'SET_CURRENT_TOOL':
    case 'SET_PENDING_COUNT':
    case 'CLEAR_INPUT':
    case 'MOVE_CURSOR':
    case 'ADD_TO_HISTORY':
    case 'NAVIGATE_HISTORY':
    case 'BEGIN_PROMPT':
    case 'END_PROMPT':
    case 'SCROLL':
    case 'CLEAR_SCREEN':
    case 'FORCE_REDRAW':
      return action;
    case 'SET_SETTINGS_PROMPT':
      return action.prompt
        ? { type: 'BEGIN_PROMPT', question: action.prompt.question }
        : { type: 'END_PROMPT' };
    case 'SET_PENDING_MESSAGE_COUNT':
      return { type: 'SET_PENDING_COUNT', count: action.count };
    default:
      return null;
  }
}

function shallowEqualTaskStatus(left: Partial<TaskStatus>, right: Partial<TaskStatus>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const typedKey = key as keyof TaskStatus;
    if (left[typedKey] !== right[typedKey]) return false;
  }
  return true;
}
