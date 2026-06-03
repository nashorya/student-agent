import { describe, expect, it, vi } from "vitest";
import { createBridge } from "../bridge.js";
import { appReducer, initialAppState, type AppAction } from "../state.js";

describe("createBridge", () => {
  it("重复 task status 不重复 dispatch", () => {
    const dispatch = vi.fn<(action: AppAction) => void>();
    const bridge = createBridge(dispatch);

    bridge.updateTaskStatus({ state: "running" });
    bridge.updateTaskStatus({ state: "running" });
    bridge.updateTaskStatus({ state: "idle" });

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0]?.[0]).toEqual({
      type: "UPDATE_TASK_STATUS",
      status: { state: "running" },
    });
    expect(dispatch.mock.calls[1]?.[0]).toEqual({
      type: "UPDATE_TASK_STATUS",
      status: { state: "idle" },
    });
  });

  it("重复 current tool 不重复 dispatch", () => {
    const dispatch = vi.fn<(action: AppAction) => void>();
    const bridge = createBridge(dispatch);

    bridge.setCurrentTool("bash");
    bridge.setCurrentTool("bash");
    bridge.setCurrentTool(null);
    bridge.setCurrentTool(null);

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0]?.[0]).toEqual({ type: "SET_CURRENT_TOOL", name: "bash" });
    expect(dispatch.mock.calls[1]?.[0]).toEqual({ type: "SET_CURRENT_TOOL", name: null });
  });

  it("重复 last message 不重复 dispatch，新增 assistant 后重置去重状态", () => {
    const dispatch = vi.fn<(action: AppAction) => void>();
    const bridge = createBridge(dispatch);

    bridge.addMessage("assistant", "");
    bridge.updateLastMessage("hello");
    bridge.updateLastMessage("hello");
    bridge.addMessage("assistant", "hello");
    bridge.updateLastMessage("hello");

    expect(dispatch.mock.calls.map((call) => call[0].type)).toEqual([
      "ADD_MESSAGE",
      "UPDATE_ASSISTANT_MESSAGE",
      "ADD_MESSAGE",
    ]);
  });

  it.each(["system", "error"] as const)("preserves stream buffer across %s messages", (role) => {
    const dispatch = vi.fn<(action: AppAction) => void>();
    const bridge = createBridge(dispatch);

    bridge.addMessage("assistant", "hello");
    bridge.addMessage(role, "interleaved status");
    bridge.updateLastMessage("hello");
    bridge.updateLastMessage("hello world");

    expect(dispatch.mock.calls.map((call) => call[0].type)).toEqual([
      "ADD_MESSAGE",
      "ADD_MESSAGE",
      "UPDATE_ASSISTANT_MESSAGE",
    ]);
    expect(dispatch.mock.calls[2]?.[0]).toMatchObject({
      type: "UPDATE_ASSISTANT_MESSAGE",
      content: "hello world",
    });
  });

  it.each(["user", "tool"] as const)("preserves the active assistant across interleaved %s messages", (role) => {
    const dispatch = vi.fn<(action: AppAction) => void>();
    const bridge = createBridge(dispatch);

    bridge.addMessage("assistant", "hello");
    bridge.addMessage(role, "new boundary");
    bridge.updateLastMessage("hello world");

    expect(dispatch.mock.calls.map((call) => call[0].type)).toEqual([
      "ADD_MESSAGE",
      "ADD_MESSAGE",
      "UPDATE_ASSISTANT_MESSAGE",
    ]);
  });

  it("message_end 后的旧 buffer 不会回写到已完成 assistant", () => {
    const dispatch = vi.fn<(action: AppAction) => void>();
    const bridge = createBridge(dispatch);

    bridge.addMessage("assistant", "");
    bridge.updateLastMessage("final answer");
    bridge.endAssistantMessage();
    bridge.addMessage("system", "[QualityWatchdog] [✅ /review ok]");
    bridge.updateLastMessage("final answer plus stale text");

    // endAssistantMessage 拆成 HIDE（同步）+ COMMIT（setImmediate）两步，
    // 修复 ink <Static> 同帧 append + dynamic shrink 引起的鬼影 bug。
    // 这里只断言同步阶段的 dispatch 顺序；COMMIT 单独在 setImmediate 测试。
    expect(dispatch.mock.calls.map((call) => call[0].type)).toEqual([
      "ADD_MESSAGE",
      "UPDATE_ASSISTANT_MESSAGE",
      "HIDE_ACTIVE_ASSISTANT",
      "ADD_MESSAGE",
    ]);
  });

  it("endAssistantMessage 异步 COMMIT 后，assistant 最终被加入 Static", async () => {
    const dispatch = vi.fn<(action: AppAction) => void>();
    const bridge = createBridge(dispatch);

    bridge.addMessage("assistant", "");
    bridge.updateLastMessage("final answer");
    bridge.endAssistantMessage();

    // 等 setImmediate 调度的 COMMIT 落地
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(dispatch.mock.calls.map((call) => call[0].type)).toEqual([
      "ADD_MESSAGE",
      "UPDATE_ASSISTANT_MESSAGE",
      "HIDE_ACTIVE_ASSISTANT",
      "COMMIT_ASSISTANT_TO_STATIC",
    ]);
  });

  it("assistant 完成后插入 watchdog，不会让同一段内容被重复写回", async () => {
    let state = initialAppState;
    const bridge = createBridge((action) => {
      state = appReducer(state, action);
    });

    bridge.addMessage("assistant", "");
    bridge.updateLastMessage("1. 工具调用\n\n2. 上下文窗口有限");
    bridge.endAssistantMessage();
    bridge.addMessage("system", "[QualityWatchdog] [✅ /review ok]");
    bridge.updateLastMessage("1. 工具调用\n\n2. 上下文窗口有限");
    // 等异步 COMMIT 完成
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({
      role: "assistant",
      content: "1. 工具调用\n\n2. 上下文窗口有限",
    });
    expect(state.messages[1]).toMatchObject({
      role: "system",
      content: "[QualityWatchdog] [✅ /review ok]",
    });
    // assistant 最终也进入 Static
    expect(state.completedMessageIds).toContain(state.messages[0]?.id);
  });

  describe("setStatus / clearStatus（状态栏瞬态文本）", () => {
    it("setStatus 派发 SET_STATUS action", () => {
      const dispatch = vi.fn<(action: AppAction) => void>();
      const bridge = createBridge(dispatch);

      bridge.setStatus("已请求中止当前任务");

      expect(dispatch).toHaveBeenCalledWith({
        type: "SET_STATUS",
        text: "已请求中止当前任务",
      });
    });

    it("clearStatus 派发 CLEAR_STATUS action", () => {
      const dispatch = vi.fn<(action: AppAction) => void>();
      const bridge = createBridge(dispatch);

      bridge.clearStatus();

      expect(dispatch).toHaveBeenCalledWith({ type: "CLEAR_STATUS" });
    });

    it("setStatus 不进入 messages", () => {
      let state = initialAppState;
      const bridge = createBridge((action) => {
        state = appReducer(state, action);
      });

      bridge.setStatus("正在规划中");
      expect(state.messages).toHaveLength(0);
      expect(state.currentStatus).toBe("正在规划中");
    });

    it("clearStatus 恢复 currentStatus 为空", () => {
      let state = initialAppState;
      const bridge = createBridge((action) => {
        state = appReducer(state, action);
      });

      bridge.setStatus("正在规划中");
      bridge.clearStatus();
      expect(state.currentStatus).toBe("");
    });
  });
});
