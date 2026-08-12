/** Keep in sync with tui-shell ActivityKind — duplicated to avoid memory→tui import. */
export type SessionActivityKind =
  | 'user'
  | 'assistant'
  | 'reasoning'
  | 'tool'
  | 'diff'
  | 'error'
  | 'recovery'
  | 'verification'
  | 'system'
  | 'prompt'
  | 'signal'
  | 'reflect'
  | 'recall';

export const SESSION_FILE_VERSION = 1 as const;

/** Durable transcript entry (mirrors ShellMessage). */
export type SessionMessage = {
  id: string;
  kind: SessionActivityKind;
  content: string;
  timestamp: number;
  meta?: {
    toolName?: string;
    toolStatus?: 'running' | 'done' | 'failed';
  };
};

/**
 * One interactive workspace session on disk.
 * Tasks stay in tasks.json; session only holds a link + UI transcript.
 */
export type StudentSessionFile = {
  version: typeof SESSION_FILE_VERSION;
  id: string;
  /** Human label — defaults to first user message or "untitled". */
  name: string;
  created_at: string;
  updated_at: string;
  cwd: string;
  /** Linked TasksManager task id, if any. */
  task_id: string | null;
  messages: SessionMessage[];
};

export type SessionIndexEntry = {
  id: string;
  name: string;
  updated_at: string;
  created_at: string;
  task_id: string | null;
  message_count: number;
  /** Short preview from the latest user/assistant line. */
  preview: string;
};

export type SessionIndexFile = {
  version: 1;
  current_id: string | null;
  sessions: SessionIndexEntry[];
};
