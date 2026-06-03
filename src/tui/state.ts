import { createContext, useContext } from "react";

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool" | "system" | "error";
  content: string;
  timestamp: number;
}

export interface TaskStatus {
  name: string;
  phaseIndex: number;
  totalPhases: number;
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
  retryCount: number;
  toolCallCount: number;
  elapsedMs: number;
  state: "running" | "aborting" | "idle" | "failed";
}

export interface SettingsPrompt {
  question: string;
  resolve: (answer: string) => void;
}

/**
 * AppState — UI 状态严格分为四类：
 *
 *   1. transcriptMessages（messages + completedMessageIds + activeAssistantMessageId）
 *      只存 user/assistant/tool/error 的持久消息。
 *      system 消息通过 bridge.setStatus() → currentStatus 显示在底部状态栏。
 *
 *   2. currentStatus（currentStatus）
 *      底部状态栏文本，必须单行截断，不能进入正文。
 *      瞬态消息（"已请求中止"、"OK: 模型切换"等）走这里。
 *
 *   3. inputValue（inputValue + cursorPos + inputHistory + historyIndex）
 *      只显示在输入框，不能进入正文。
 *
 *   4. debugLogs
 *      写入 .student-agent/debug-ui-events.jsonl，不直接输出到 terminal。
 *      由 debug-events.ts 管理，不在 AppState 中保存。
 */
export interface AppState {
  /** transcriptMessages: 持久聊天消息，只含 user/assistant/tool/error */
  messages: Message[];
  activeAssistantMessageId: string | null;
  /**
   * 已"完成"的消息 ID 列表，按完成时间顺序排列（OutputArea 把它喂给 ink <Static>）。
   * 非 assistant 消息在 ADD_MESSAGE 时立即入列；
   * assistant 消息在 END_ASSISTANT_MESSAGE 时入列。
   * 不可被打乱：Static 只递增 commit，乱序会导致重复或丢失。
   */
  completedMessageIds: string[];
  /** 结构化任务状态，用于状态栏渲染 */
  taskStatus: TaskStatus | null;
  /** 当前正在执行的工具名，用于状态栏渲染 */
  currentTool: string | null;
  /** currentStatus: 底部状态栏瞬态文本，单行截断，不进正文 */
  currentStatus: string;
  /** inputValue: 输入框内容 */
  inputValue: string;
  cursorPos: number;
  inputHistory: string[];
  historyIndex: number;
  settingsPrompt: SettingsPrompt | null;
}

export type AppAction =
  | { type: "ADD_MESSAGE"; message: Message }
  | { type: "UPDATE_ASSISTANT_MESSAGE"; messageId: string; content: string }
  | { type: "END_ASSISTANT_MESSAGE"; messageId: string }
  | { type: "HIDE_ACTIVE_ASSISTANT"; messageId: string }
  | { type: "DISCARD_ACTIVE_ASSISTANT"; messageId: string }
  | { type: "COMMIT_ASSISTANT_TO_STATIC"; messageId: string }
  | { type: "UPDATE_TASK_STATUS"; status: Partial<TaskStatus> }
  | { type: "CLEAR_TASK_STATUS" }
  | { type: "SET_CURRENT_TOOL"; name: string | null }
  /** currentStatus: 设置底部状态栏瞬态文本 */
  | { type: "SET_STATUS"; text: string }
  /** currentStatus: 清除底部状态栏瞬态文本 */
  | { type: "CLEAR_STATUS" }
  | { type: "SET_INPUT"; value: string; cursorPos?: number }
  | { type: "MOVE_CURSOR"; direction: "left" | "right" }
  | { type: "ADD_TO_HISTORY"; value: string }
  | { type: "NAVIGATE_HISTORY"; direction: "up" | "down" }
  | { type: "SET_SETTINGS_PROMPT"; prompt: SettingsPrompt | null };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "ADD_MESSAGE": {
      const activeAssistantMessageId =
        action.message.role === "assistant"
          ? action.message.id
          : state.activeAssistantMessageId;
      // 非 assistant 消息在添加时即视为"完成"，进入 Static 提交队列；assistant 要等流式结束。
      const completedMessageIds =
        action.message.role === "assistant"
          ? state.completedMessageIds
          : [...state.completedMessageIds, action.message.id];
      return {
        ...state,
        activeAssistantMessageId,
        messages: [...state.messages, action.message],
        completedMessageIds,
      };
    }
    case "UPDATE_ASSISTANT_MESSAGE": {
      if (state.activeAssistantMessageId !== action.messageId) return state;
      let didChange = false;
      const messages = state.messages.map((message) => {
        if (message.id !== action.messageId || message.role !== "assistant") return message;
        if (message.content === action.content) return message;
        didChange = true;
        return { ...message, content: action.content };
      });
      return didChange ? { ...state, messages } : state;
    }
    case "END_ASSISTANT_MESSAGE": {
      // 兼容旧路径（直接调用，例如测试 / cleanup）：一帧内同时 hide + commit。
      // 注意：bridge.endAssistantMessage() 默认会拆成 HIDE + 下一帧的 COMMIT 两步，
      // 避免 ink <Static> append 与动态区收缩同帧发生时的清除错位（鬼影 bug）。
      if (state.activeAssistantMessageId !== action.messageId) {
        return state;
      }
      const completedMessageIds = state.completedMessageIds.includes(action.messageId)
        ? state.completedMessageIds
        : [...state.completedMessageIds, action.messageId];
      return { ...state, activeAssistantMessageId: null, completedMessageIds };
    }
    case "HIDE_ACTIVE_ASSISTANT": {
      // 第 1 步：把流式消息从动态区移除（active=null），但不入 Static。
      // 这一帧 ink 只看到"动态区缩短"，可以正确清除上一帧占用的行。
      if (state.activeAssistantMessageId !== action.messageId) return state;
      return { ...state, activeAssistantMessageId: null };
    }
    case "DISCARD_ACTIVE_ASSISTANT": {
      if (state.activeAssistantMessageId !== action.messageId) return state;
      return {
        ...state,
        activeAssistantMessageId: null,
        messages: state.messages.filter((message) => message.id !== action.messageId),
        completedMessageIds: state.completedMessageIds.filter((id) => id !== action.messageId),
      };
    }
    case "COMMIT_ASSISTANT_TO_STATIC": {
      // 第 2 步（下一帧）：再把消息 append 到 Static。
      // 此时动态区已稳定在新高度，ink 只 append scrollback，不再触碰动态区，因此不会错位。
      if (state.completedMessageIds.includes(action.messageId)) return state;
      // 必须确认该消息确实存在；否则 reducer 不该改变 state（保持引用相等）。
      if (!state.messages.some((m) => m.id === action.messageId)) return state;
      return {
        ...state,
        completedMessageIds: [...state.completedMessageIds, action.messageId],
      };
    }
    case "UPDATE_TASK_STATUS":
      return {
        ...state,
        taskStatus: state.taskStatus
          ? { ...state.taskStatus, ...action.status }
          : (action.status as TaskStatus),
      };
    case "CLEAR_TASK_STATUS":
      return { ...state, taskStatus: null };
    case "SET_CURRENT_TOOL":
      return { ...state, currentTool: action.name };
    case "SET_STATUS":
      return { ...state, currentStatus: action.text };
    case "CLEAR_STATUS":
      return { ...state, currentStatus: "" };
    case "SET_INPUT": {
      const cursorPos = action.cursorPos ?? action.value.length;
      return { ...state, inputValue: action.value, cursorPos };
    }
    case "MOVE_CURSOR": {
      const newPos = action.direction === "left"
        ? Math.max(0, state.cursorPos - 1)
        : Math.min(state.inputValue.length, state.cursorPos + 1);
      return { ...state, cursorPos: newPos };
    }
    case "ADD_TO_HISTORY":
      return {
        ...state,
        inputHistory: [...state.inputHistory, action.value],
        historyIndex: state.inputHistory.length + 1,
      };
    case "NAVIGATE_HISTORY": {
      const newIndex =
        action.direction === "up"
          ? Math.max(0, state.historyIndex - 1)
          : Math.min(state.inputHistory.length, state.historyIndex + 1);
      const newValue = state.inputHistory[newIndex] ?? "";
      return {
        ...state,
        historyIndex: newIndex,
        inputValue: newValue,
        cursorPos: newValue.length,
      };
    }
    case "SET_SETTINGS_PROMPT":
      return { ...state, settingsPrompt: action.prompt };
    default:
      return state;
  }
}

export const initialAppState: AppState = {
  messages: [],
  activeAssistantMessageId: null,
  completedMessageIds: [],
  taskStatus: null,
  currentTool: null,
  currentStatus: "",
  inputValue: "",
  cursorPos: 0,
  inputHistory: [],
  historyIndex: 0,
  settingsPrompt: null,
};

export const AppStateContext = createContext<{
  state: AppState;
  dispatch: (action: AppAction) => void;
} | null>(null);

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
