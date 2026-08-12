/**
 * UI bridge contract used by EventRenderer and temporary readline REPL.
 * Full TUI shell is rebuilt under ADR-009; this keeps non-UI callers compiling.
 */
export type UiTaskStatus = {
  state?: string;
  name?: string;
  phaseIndex?: number;
  totalPhases?: number;
  retryCount?: number;
  toolCallCount?: number;
  elapsedMs?: number;
  [k: string]: unknown;
};

export interface UiBridge {
  addMessage: (role: 'user' | 'assistant' | 'tool' | 'system' | 'error', content: string) => void;
  updateLastMessage: (content: string) => void;
  endAssistantMessage: () => void;
  discardAssistantMessage: () => void;
  updateTaskStatus: (status: Partial<UiTaskStatus>) => void;
  clearTaskStatus: () => void;
  setCurrentTool: (name: string | null) => void;
  setStatus: (text: string) => void;
  clearStatus: () => void;
  promptSettings: (question: string) => Promise<string>;
}

/** Temporary alias while callers migrate from TUIBridge. */
export type TUIBridge = UiBridge;
