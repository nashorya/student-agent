export type TUIV2Role = 'user' | 'assistant' | 'tool' | 'system' | 'error';

export type TUIV2TaskState = 'running' | 'aborting' | 'idle' | 'failed';

export interface TUIV2PhaseInfo {
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped';
}

export interface TUIV2TaskStatusUpdate {
  name?: string;
  phaseIndex?: number;
  totalPhases?: number;
  phases?: TUIV2PhaseInfo[];
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

export type TUIV2PromptKind = 'settings' | 'planning-recovery' | 'planning-revision';

export type TUIV2Action =
  | { type: 'APPEND_MESSAGE'; role: TUIV2Role; content: string }
  | { type: 'STREAM_START'; id: string }
  | { type: 'STREAM_UPDATE'; id: string; text: string }
  | { type: 'STREAM_DISCARD'; id: string }
  | { type: 'STREAM_COMMIT'; id: string }
  | { type: 'SET_STATUS'; text: string }
  | { type: 'CLEAR_STATUS' }
  | { type: 'UPDATE_TASK_STATUS'; status: TUIV2TaskStatusUpdate }
  | { type: 'CLEAR_TASK_STATUS' }
  | { type: 'SET_CURRENT_TOOL'; name: string | null }
  | { type: 'SET_PENDING_COUNT'; count: number }
  | { type: 'SET_INPUT'; value: string; cursor: number }
  | { type: 'CLEAR_INPUT' }
  | { type: 'MOVE_CURSOR'; direction: 'left' | 'right' }
  | { type: 'ADD_TO_HISTORY'; value: string }
  | { type: 'NAVIGATE_HISTORY'; direction: 'up' | 'down' }
  | { type: 'BEGIN_PROMPT'; question: string; kind?: TUIV2PromptKind }
  | { type: 'END_PROMPT' }
  | { type: 'SCROLL'; delta: number }
  | { type: 'CLEAR_SCREEN' }
  | { type: 'COMPLETION_NAVIGATE'; direction: 'up' | 'down' }
  | { type: 'COMPLETION_RESET' }
  | { type: 'FORCE_REDRAW' };
