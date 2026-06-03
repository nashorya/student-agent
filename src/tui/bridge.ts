import type { AppAction, TaskStatus, SettingsPrompt } from "./state.js";
import { recordDebugEvent } from "./debug-events.js";

export interface TUIBridge {
  dispatch: (action: AppAction) => void;
  /** 添加持久消息到 transcriptMessages（仅 user/assistant/tool/error） */
  addMessage: (role: "user" | "assistant" | "tool" | "system" | "error", content: string) => void;
  /** 流式更新当前 assistant 消息内容 */
  updateLastMessage: (content: string) => void;
  /** 结束当前 assistant 消息（两步 HIDE + COMMIT） */
  endAssistantMessage: () => void;
  /** 丢弃当前正在流式输出的 assistant 消息 */
  discardAssistantMessage: () => void;
  /** 更新结构化任务状态（状态栏用） */
  updateTaskStatus: (status: Partial<TaskStatus>) => void;
  /** 清除结构化任务状态 */
  clearTaskStatus: () => void;
  /** 设置当前工具名（状态栏用） */
  setCurrentTool: (name: string | null) => void;
  /**
   * 设置底部状态栏瞬态文本（单行截断，不进正文）。
   * 用于瞬态消息："已请求中止"、"OK: 模型切换"、"当前没有运行中的任务"等。
   * 设置后会覆盖 taskStatus 的显示，清除后恢复 taskStatus 显示。
   */
  setStatus: (text: string) => void;
  /** 清除底部状态栏瞬态文本，恢复 taskStatus 显示 */
  clearStatus: () => void;
  /** 弹出设置对话框 */
  promptSettings: (question: string) => Promise<string>;
}

export function createBridge(dispatch: (action: AppAction) => void): TUIBridge {
  let messageSeq = 0;
  let activeAssistantMessageId: string | null = null;
  let activeAssistantContent = "";
  let currentTool: string | null = null;
  let taskStatus: Partial<TaskStatus> | null = null;

  return {
    dispatch,

    addMessage(role, content) {
      const id = `msg_${++messageSeq}`;
      if (role === "assistant") {
        activeAssistantMessageId = id;
        activeAssistantContent = content;
      }
      recordDebugEvent("appendMessage", { id, role, contentLength: content.length });
      dispatch({
        type: "ADD_MESSAGE",
        message: { id, role, content, timestamp: Date.now() },
      });
    },

    updateLastMessage(content) {
      if (!activeAssistantMessageId || content === activeAssistantContent) return;
      activeAssistantContent = content;
      dispatch({
        type: "UPDATE_ASSISTANT_MESSAGE",
        messageId: activeAssistantMessageId,
        content,
      });
    },

    endAssistantMessage() {
      if (!activeAssistantMessageId) return;
      const id = activeAssistantMessageId;
      activeAssistantMessageId = null;
      activeAssistantContent = "";
      // 两步过渡修复"消息显示两次 + 输入框边框鬼影"：
      // ink <Static> append + 动态区 shrink 不能放到同一帧，否则 ink 计算
      // "上一帧动态区高度"时会错位，导致流式 MessageBlock 残留 + InputLine 重影。
      dispatch({ type: "HIDE_ACTIVE_ASSISTANT", messageId: id });
      // 下一帧再把消息 commit 到 Static。setImmediate 保证 ink 完成本帧的
      // 动态区清除后再 append，新一帧不再触碰已稳定的动态区。
      setImmediate(() => {
        dispatch({ type: "COMMIT_ASSISTANT_TO_STATIC", messageId: id });
      });
    },

    discardAssistantMessage() {
      if (!activeAssistantMessageId) return;
      const id = activeAssistantMessageId;
      activeAssistantMessageId = null;
      activeAssistantContent = "";
      dispatch({ type: "DISCARD_ACTIVE_ASSISTANT", messageId: id });
    },

    updateTaskStatus(status) {
      const next = { ...(taskStatus ?? {}), ...status };
      if (taskStatus && shallowEqual(taskStatus, next)) return;
      taskStatus = next;
      recordDebugEvent("setStatus", { source: "taskStatus", state: status.state, name: status.name });
      dispatch({ type: "UPDATE_TASK_STATUS", status });
    },

    clearTaskStatus() {
      taskStatus = null;
      dispatch({ type: "CLEAR_TASK_STATUS" });
    },

    setCurrentTool(name) {
      if (name === currentTool) return;
      currentTool = name;
      dispatch({ type: "SET_CURRENT_TOOL", name });
    },

    setStatus(text) {
      recordDebugEvent("setStatus", { source: "explicit", text });
      dispatch({ type: "SET_STATUS", text });
    },

    clearStatus() {
      recordDebugEvent("clearStatus", {});
      dispatch({ type: "CLEAR_STATUS" });
    },

    promptSettings(question) {
      return new Promise<string>((resolve) => {
        const prompt: SettingsPrompt = {
          question,
          resolve: (answer) => {
            dispatch({ type: "SET_SETTINGS_PROMPT", prompt: null });
            resolve(answer);
          },
        };
        dispatch({ type: "SET_SETTINGS_PROMPT", prompt });
      });
    },
  };
}

function shallowEqual(left: Partial<TaskStatus>, right: Partial<TaskStatus>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const typedKey = key as keyof TaskStatus;
    if (left[typedKey] !== right[typedKey]) return false;
  }
  return true;
}
