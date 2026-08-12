import type { UiBridge, UiMessageRole, UiTaskStatus } from '../runtime/ui-bridge.js';
import type { ActivityKind, ShellAction, ShellState } from './state.js';

export interface CreateShellBridgeOptions {
  getState: () => ShellState;
  dispatch: (action: ShellAction) => void;
  requestRender: (force?: boolean) => void;
  promptSettings: (question: string) => Promise<string>;
}

/** UiBridge + optional EventRenderer forceRedraw hook. */
export type ShellUiBridge = UiBridge & {
  forceRedraw: () => void;
};

function asKind(role: UiMessageRole): ActivityKind {
  return role;
}

export function createShellBridge(options: CreateShellBridgeOptions): ShellUiBridge {
  const { dispatch, requestRender, promptSettings } = options;

  const bridge: ShellUiBridge = {
    addMessage(role, content, meta) {
      dispatch({
        type: 'ADD_MESSAGE',
        kind: asKind(role),
        content,
        ...(meta ? { meta } : {}),
      });
      requestRender();
    },
    updateLastMessage(content) {
      dispatch({ type: 'UPDATE_LAST_MESSAGE', content });
      requestRender();
    },
    updateReasoningMessage(content) {
      dispatch({ type: 'UPDATE_STREAM', target: 'reasoning', content });
      requestRender();
    },
    endAssistantMessage() {
      dispatch({ type: 'END_ASSISTANT_MESSAGE' });
      requestRender();
    },
    discardAssistantMessage() {
      dispatch({ type: 'DISCARD_ASSISTANT_MESSAGE' });
      requestRender();
    },
    endReasoningMessage() {
      dispatch({ type: 'END_STREAM', target: 'reasoning' });
      requestRender();
    },
    discardReasoningMessage() {
      dispatch({ type: 'DISCARD_STREAM', target: 'reasoning' });
      requestRender();
    },
    updateTaskStatus(status: Partial<UiTaskStatus>) {
      dispatch({ type: 'UPDATE_TASK_STATUS', status });
      requestRender();
    },
    clearTaskStatus() {
      dispatch({ type: 'CLEAR_TASK_STATUS' });
      requestRender();
    },
    setCurrentTool(name) {
      dispatch({ type: 'SET_CURRENT_TOOL', name });
      requestRender();
    },
    setStatus(text) {
      dispatch({ type: 'SET_STATUS', text });
      requestRender();
    },
    clearStatus() {
      dispatch({ type: 'CLEAR_STATUS' });
      requestRender();
    },
    promptSettings,
    forceRedraw() {
      requestRender(true);
    },
  };

  return bridge;
}
