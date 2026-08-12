/**
 * UI bridge contract used by EventRenderer and Student TUI shell.
 * Full TUI shell is rebuilt under ADR-009.
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

/** Activity timeline roles (ADR-009 Phase 2). */
export type UiMessageRole =
  | 'user'
  | 'assistant'
  | 'reasoning'
  | 'tool'
  | 'diff'
  | 'error'
  | 'recovery'
  | 'verification'
  | 'system';

export type UiMessageMeta = {
  toolName?: string;
  toolStatus?: 'running' | 'done' | 'failed';
};

export interface UiBridge {
  addMessage: (role: UiMessageRole, content: string, meta?: UiMessageMeta) => void;
  updateLastMessage: (content: string) => void;
  /** Update the in-flight reasoning activity (thinking stream). */
  updateReasoningMessage: (content: string) => void;
  endAssistantMessage: () => void;
  discardAssistantMessage: () => void;
  endReasoningMessage: () => void;
  discardReasoningMessage: () => void;
  updateTaskStatus: (status: Partial<UiTaskStatus>) => void;
  clearTaskStatus: () => void;
  setCurrentTool: (name: string | null) => void;
  setStatus: (text: string) => void;
  clearStatus: () => void;
  promptSettings: (question: string) => Promise<string>;
}

/** Temporary alias while callers migrate from TUIBridge. */
export type TUIBridge = UiBridge;
