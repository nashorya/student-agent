import type { UiTaskStatus } from '../runtime/ui-bridge.js';

/** Activity timeline kinds (ADR-009 Phase 2). */
export type ActivityKind =
  | 'user'
  | 'assistant'
  | 'reasoning'
  | 'tool'
  | 'diff'
  | 'error'
  | 'recovery'
  | 'verification'
  | 'system';

export type ShellMessage = {
  id: string;
  kind: ActivityKind;
  content: string;
  timestamp: number;
  meta?: {
    toolName?: string;
    toolStatus?: 'running' | 'done' | 'failed';
  };
};

/** @deprecated Prefer ActivityKind; kept for bridge role aliases. */
export type ShellMessageRole = ActivityKind;

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
  /** When set, AgentsPanel renders this row indented under the parent. */
  parentId?: string;
};

export type CompactOverlay = 'none' | 'plan' | 'agents';

export type ShellState = {
  messages: ShellMessage[];
  streamingAssistantId: string | null;
  streamingReasoningId: string | null;
  statusText: string;
  currentTool: string | null;
  taskStatus: Partial<UiTaskStatus> | null;
  pendingCount: number;
  /** Phase 3: Plan sidebar consumes TasksManager via setPlanSteps. */
  planSteps: ShellPlanStep[];
  agents: ShellAgentRow[];
  /** Compact-mode Plan/Agents overlay (wide mode uses the right rail). */
  compactOverlay: CompactOverlay;
};

export type StreamTarget = 'assistant' | 'reasoning';

export type ShellAction =
  | {
    type: 'ADD_MESSAGE';
    kind: ActivityKind;
    content: string;
    id?: string;
    meta?: ShellMessage['meta'];
  }
  | { type: 'UPDATE_STREAM'; target: StreamTarget; content: string }
  /** Compat: updates assistant stream (or last message). */
  | { type: 'UPDATE_LAST_MESSAGE'; content: string }
  | { type: 'END_STREAM'; target: StreamTarget }
  | { type: 'DISCARD_STREAM'; target: StreamTarget }
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
  | { type: 'SET_COMPACT_OVERLAY'; overlay: CompactOverlay }
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
    streamingReasoningId: null,
    statusText: '',
    currentTool: null,
    taskStatus: null,
    pendingCount: 0,
    planSteps: [],
    agents: [],
    compactOverlay: 'none',
  };
}

function streamId(state: ShellState, target: StreamTarget): string | null {
  return target === 'assistant' ? state.streamingAssistantId : state.streamingReasoningId;
}

export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case 'ADD_MESSAGE': {
      const id = action.id ?? allocId(action.kind);
      const message: ShellMessage = {
        id,
        kind: action.kind,
        content: action.content,
        timestamp: Date.now(),
        ...(action.meta ? { meta: action.meta } : {}),
      };
      let streamingAssistantId = state.streamingAssistantId;
      let streamingReasoningId = state.streamingReasoningId;
      if (action.kind === 'assistant') streamingAssistantId = id;
      if (action.kind === 'reasoning') streamingReasoningId = id;
      return {
        ...state,
        messages: [...state.messages, message],
        streamingAssistantId,
        streamingReasoningId,
      };
    }

    case 'UPDATE_STREAM': {
      const targetId = streamId(state, action.target);
      if (!targetId) return state;
      return {
        ...state,
        messages: state.messages.map((msg) =>
          msg.id === targetId ? { ...msg, content: action.content } : msg,
        ),
      };
    }

    case 'UPDATE_LAST_MESSAGE': {
      const targetId =
        state.streamingAssistantId
        ?? state.messages[state.messages.length - 1]?.id;
      if (!targetId) return state;
      return {
        ...state,
        messages: state.messages.map((msg) =>
          msg.id === targetId ? { ...msg, content: action.content } : msg,
        ),
      };
    }

    case 'END_STREAM':
      if (action.target === 'assistant') {
        return { ...state, streamingAssistantId: null };
      }
      return { ...state, streamingReasoningId: null };

    case 'DISCARD_STREAM': {
      const targetId = streamId(state, action.target);
      if (!targetId) return state;
      return {
        ...state,
        messages: state.messages.filter((msg) => msg.id !== targetId),
        streamingAssistantId:
          action.target === 'assistant' ? null : state.streamingAssistantId,
        streamingReasoningId:
          action.target === 'reasoning' ? null : state.streamingReasoningId,
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

    case 'SET_COMPACT_OVERLAY':
      return { ...state, compactOverlay: action.overlay };

    case 'CLEAR_TRANSCRIPT':
      return {
        ...state,
        messages: [],
        streamingAssistantId: null,
        streamingReasoningId: null,
      };

    default:
      return state;
  }
}
