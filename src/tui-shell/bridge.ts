import type { UiBridge, UiTaskStatus } from '../runtime/ui-bridge.js';
import type { ShellAction, ShellState } from './state.js';

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

export function createShellBridge(options: CreateShellBridgeOptions): ShellUiBridge {
  const { dispatch, requestRender, promptSettings } = options;

  const bridge: ShellUiBridge = {
    addMessage(role, content) {
      dispatch({ type: 'ADD_MESSAGE', role, content });
      requestRender();
    },
    updateLastMessage(content) {
      dispatch({ type: 'UPDATE_LAST_MESSAGE', content });
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
