import type { AppAction, TaskStatus, SettingsPrompt } from './state.js';

export interface TUIBridge {
  dispatch: (action: AppAction) => void;
  addMessage: (role: 'user' | 'assistant' | 'tool' | 'system' | 'error', content: string) => void;
  updateLastMessage: (content: string) => void;
  endAssistantMessage: () => void;
  discardAssistantMessage: () => void;
  updateTaskStatus: (status: Partial<TaskStatus>) => void;
  clearTaskStatus: () => void;
  setCurrentTool: (name: string | null) => void;
  promptSettings: (question: string) => Promise<string>;
}

export function createBridge(dispatch: (action: AppAction) => void): TUIBridge {
  let messageSeq = 0;
  let activeAssistantMessageId: string | null = null;
  let activeAssistantContent = '';
  let currentTool: string | null = null;
  let taskStatus: Partial<TaskStatus> | null = null;
  return {
    dispatch,
    addMessage(role, content) {
      const id = `msg_${++messageSeq}`;
      if (role === 'assistant') {
        activeAssistantMessageId = id;
        activeAssistantContent = content;
      }
      dispatch({
        type: 'ADD_MESSAGE',
        message: { id, role, content, timestamp: Date.now() },
      });
    },
    updateLastMessage(content) {
      if (!activeAssistantMessageId || content === activeAssistantContent) return;
      activeAssistantContent = content;
      dispatch({
        type: 'UPDATE_ASSISTANT_MESSAGE',
        messageId: activeAssistantMessageId,
        content,
      });
    },
    endAssistantMessage() {
      if (!activeAssistantMessageId) return;
      const id = activeAssistantMessageId;
      activeAssistantMessageId = null;
      activeAssistantContent = '';
      // 两步过渡修复"消息显示两次 + 输入框边框鬼影"：
      // ink <Static> append + 动态区 shrink 不能放到同一帧，否则 ink 计算
      // "上一帧动态区高度"时会错位，导致流式 MessageBlock 残留 + InputLine 重影。
      dispatch({ type: 'HIDE_ACTIVE_ASSISTANT', messageId: id });
      // 下一帧再把消息 commit 到 Static。setImmediate 保证 ink 完成本帧的
      // 动态区清除后再 append，新一帧不再触碰已稳定的动态区。
      setImmediate(() => {
        dispatch({ type: 'COMMIT_ASSISTANT_TO_STATIC', messageId: id });
      });
    },
    discardAssistantMessage() {
      if (!activeAssistantMessageId) return;
      const id = activeAssistantMessageId;
      activeAssistantMessageId = null;
      activeAssistantContent = '';
      dispatch({ type: 'DISCARD_ACTIVE_ASSISTANT', messageId: id });
    },
    updateTaskStatus(status) {
      const next = { ...(taskStatus ?? {}), ...status };
      if (taskStatus && shallowEqual(taskStatus, next)) return;
      taskStatus = next;
      dispatch({ type: 'UPDATE_TASK_STATUS', status });
    },
    clearTaskStatus() {
      taskStatus = null;
      dispatch({ type: 'CLEAR_TASK_STATUS' });
    },
    setCurrentTool(name) {
      if (name === currentTool) return;
      currentTool = name;
      dispatch({ type: 'SET_CURRENT_TOOL', name });
    },
    promptSettings(question) {
      return new Promise<string>((resolve) => {
        const prompt: SettingsPrompt = {
          question,
          resolve: (answer) => {
            dispatch({ type: 'SET_SETTINGS_PROMPT', prompt: null });
            resolve(answer);
          },
        };
        dispatch({ type: 'SET_SETTINGS_PROMPT', prompt });
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
