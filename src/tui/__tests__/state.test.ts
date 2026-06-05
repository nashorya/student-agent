import { describe, expect, it } from "vitest";
import { appReducer, initialAppState, type Message } from "../state.js";

function message(role: Message["role"], content: string, timestamp: number): Message {
  return { id: `msg_${timestamp}`, role, content, timestamp };
}

describe("appReducer", () => {
  it("updates only the active assistant message across system and error messages", () => {
    const state = {
      ...initialAppState,
      activeAssistantMessageId: "msg_1",
      messages: [
        message("assistant", "partial", 1),
        message("system", "status update", 2),
        message("error", "transient error", 3),
      ],
    };

    const next = appReducer(state, {
      type: "UPDATE_ASSISTANT_MESSAGE",
      messageId: "msg_1",
      content: "complete",
    });

    expect(next.messages).toEqual([
      message("assistant", "complete", 1),
      message("system", "status update", 2),
      message("error", "transient error", 3),
    ]);
  });

  it("does not update a closed assistant message after watchdog/control output", () => {
    const state = {
      ...initialAppState,
      activeAssistantMessageId: null,
      messages: [
        message("assistant", "complete", 1),
        message("system", "[QualityWatchdog] [✅ /review ok]", 2),
      ],
    };

    const next = appReducer(state, {
      type: "UPDATE_ASSISTANT_MESSAGE",
      messageId: "msg_1",
      content: "stale update",
    });

    expect(next).toBe(state);
  });

  it.each(["user", "tool", "system", "error"] as const)(
    "keeps the active assistant across interleaved %s messages until explicit end",
    (role) => {
      const state = appReducer({
        ...initialAppState,
        activeAssistantMessageId: "msg_1",
        messages: [message("assistant", "partial", 1)],
      }, {
        type: "ADD_MESSAGE",
        message: message(role, "new boundary", 2),
      });

      expect(state.activeAssistantMessageId).toBe("msg_1");
    },
  );

  describe("completedMessageIds (Static commit order)", () => {
    it("non-assistant message is committed immediately on ADD", () => {
      const next = appReducer(initialAppState, {
        type: "ADD_MESSAGE",
        message: message("user", "你好", 1),
      });
      expect(next.completedMessageIds).toEqual(["msg_1"]);
    });

    it("assistant message is NOT committed on ADD; only on END", () => {
      const afterAdd = appReducer(initialAppState, {
        type: "ADD_MESSAGE",
        message: message("assistant", "正在输出…", 1),
      });
      expect(afterAdd.completedMessageIds).toEqual([]);
      expect(afterAdd.activeAssistantMessageId).toBe("msg_1");

      const afterEnd = appReducer(afterAdd, {
        type: "END_ASSISTANT_MESSAGE",
        messageId: "msg_1",
      });
      expect(afterEnd.completedMessageIds).toEqual(["msg_1"]);
      expect(afterEnd.activeAssistantMessageId).toBeNull();
    });

    it("system message added during streaming is committed BEFORE assistant ends", () => {
      // 这条用例锁住 Static 不变式：完成顺序而非插入顺序。
      // 否则 ink Static 的 slice(index) 会把已提交的 system 消息重复 commit 一次。
      let state = initialAppState;
      state = appReducer(state, { type: "ADD_MESSAGE", message: message("user", "hi", 1) });
      state = appReducer(state, { type: "ADD_MESSAGE", message: message("assistant", "回复中", 2) });
      state = appReducer(state, { type: "ADD_MESSAGE", message: message("system", "[QualityWatchdog]", 3) });
      // assistant 仍在流式 → completed 顺序: user, system；assistant 不在
      expect(state.completedMessageIds).toEqual(["msg_1", "msg_3"]);
      state = appReducer(state, { type: "END_ASSISTANT_MESSAGE", messageId: "msg_2" });
      // assistant 结束 → 追加到末尾，顺序保持 append-only
      expect(state.completedMessageIds).toEqual(["msg_1", "msg_3", "msg_2"]);
    });

    it("END is idempotent — does not double-commit assistant", () => {
      const initial = appReducer(initialAppState, {
        type: "ADD_MESSAGE",
        message: message("assistant", "回复", 1),
      });
      const once = appReducer(initial, { type: "END_ASSISTANT_MESSAGE", messageId: "msg_1" });
      expect(once.completedMessageIds).toEqual(["msg_1"]);
      // 二次 END（活跃 id 已置空）应被忽略
      const twice = appReducer(once, { type: "END_ASSISTANT_MESSAGE", messageId: "msg_1" });
      expect(twice.completedMessageIds).toEqual(["msg_1"]);
    });

    describe("两步过渡：HIDE + COMMIT（修复 ink Static 同帧鬼影 bug）", () => {
      it("HIDE_ACTIVE_ASSISTANT 仅清空 active，不入 Static", () => {
        const initial = appReducer(initialAppState, {
          type: "ADD_MESSAGE",
          message: message("assistant", "回复", 1),
        });
        const hidden = appReducer(initial, { type: "HIDE_ACTIVE_ASSISTANT", messageId: "msg_1" });
        expect(hidden.activeAssistantMessageId).toBeNull();
        expect(hidden.completedMessageIds).toEqual([]); // 关键：此时 Static 仍不变，否则鬼影 bug 复现
      });

      it("COMMIT_ASSISTANT_TO_STATIC 仅 append Static，不动 active", () => {
        const initial = appReducer(initialAppState, {
          type: "ADD_MESSAGE",
          message: message("assistant", "回复", 1),
        });
        const hidden = appReducer(initial, { type: "HIDE_ACTIVE_ASSISTANT", messageId: "msg_1" });
        const committed = appReducer(hidden, { type: "COMMIT_ASSISTANT_TO_STATIC", messageId: "msg_1" });
        expect(committed.activeAssistantMessageId).toBeNull();
        expect(committed.completedMessageIds).toEqual(["msg_1"]);
      });

      it("COMMIT 对未知 id 是 no-op（保持引用相等，避免无意义重渲染）", () => {
        const state = appReducer(initialAppState, {
          type: "ADD_MESSAGE",
          message: message("assistant", "回复", 1),
        });
        const next = appReducer(state, { type: "COMMIT_ASSISTANT_TO_STATIC", messageId: "msg_unknown" });
        expect(next).toBe(state);
      });

      it("COMMIT 不会对同一 id 重复入列", () => {
        const initial = appReducer(initialAppState, {
          type: "ADD_MESSAGE",
          message: message("assistant", "回复", 1),
        });
        const hidden = appReducer(initial, { type: "HIDE_ACTIVE_ASSISTANT", messageId: "msg_1" });
        const once = appReducer(hidden, { type: "COMMIT_ASSISTANT_TO_STATIC", messageId: "msg_1" });
        const twice = appReducer(once, { type: "COMMIT_ASSISTANT_TO_STATIC", messageId: "msg_1" });
        expect(twice).toBe(once);
      });

      it("HIDE 与 COMMIT 不需要按同一 id 才生效（错配时跳过）", () => {
        const initial = appReducer(initialAppState, {
          type: "ADD_MESSAGE",
          message: message("assistant", "回复", 1),
        });
        // active 是 msg_1，但 HIDE 错配 msg_2 → 不变
        const wrong = appReducer(initial, { type: "HIDE_ACTIVE_ASSISTANT", messageId: "msg_2" });
        expect(wrong).toBe(initial);
      });

      it("DISCARD_ACTIVE_ASSISTANT removes an interim assistant message instead of committing it", () => {
        const initial = appReducer(initialAppState, {
          type: "ADD_MESSAGE",
          message: message("assistant", "工具前碎碎念", 1),
        });

        const discarded = appReducer(initial, {
          type: "DISCARD_ACTIVE_ASSISTANT",
          messageId: "msg_1",
        });

        expect(discarded.activeAssistantMessageId).toBeNull();
        expect(discarded.messages).toEqual([]);
        expect(discarded.completedMessageIds).toEqual([]);
      });
    });
  });

  describe("currentStatus（状态栏瞬态文本）", () => {
    it("SET_STATUS 设置状态栏文本", () => {
      const next = appReducer(initialAppState, {
        type: "SET_STATUS",
        text: "已请求中止当前任务",
      });
      expect(next.currentStatus).toBe("已请求中止当前任务");
    });

    it("CLEAR_STATUS 清除状态栏文本", () => {
      const withStatus = appReducer(initialAppState, {
        type: "SET_STATUS",
        text: "OK: 模型已切换",
      });
      const cleared = appReducer(withStatus, { type: "CLEAR_STATUS" });
      expect(cleared.currentStatus).toBe("");
    });

    it("SET_STATUS 不影响 messages", () => {
      const withMessage = appReducer(initialAppState, {
        type: "ADD_MESSAGE",
        message: message("user", "hello", 1),
      });
      const withStatus = appReducer(withMessage, {
        type: "SET_STATUS",
        text: "正在处理",
      });
      expect(withStatus.messages).toHaveLength(1);
      expect(withStatus.messages[0].content).toBe("hello");
    });

    it("initialAppState.currentStatus 为空字符串", () => {
      expect(initialAppState.currentStatus).toBe("");
    });
  });

  describe("inputValue（输入框内容）", () => {
    it("CLEAR_INPUT clears text and advances the input generation", () => {
      const typed = appReducer(initialAppState, {
        type: "SET_INPUT",
        value: "旧的粘贴内容",
      });
      const generationBeforeClear = typed.inputGeneration ?? 0;

      const cleared = appReducer(typed, { type: "CLEAR_INPUT" } as any);

      expect(cleared.inputValue).toBe("");
      expect(cleared.cursorPos).toBe(0);
      expect(cleared.inputGeneration).toBe(generationBeforeClear + 1);
    });

    it("ignores a stale deferred SET_INPUT after the input has been cleared", () => {
      const typed = appReducer(initialAppState, {
        type: "SET_INPUT",
        value: "旧的粘贴内容",
      });
      const scheduledGeneration = typed.inputGeneration ?? 0;
      const cleared = appReducer(typed, { type: "CLEAR_INPUT" } as any);

      const staleFlush = appReducer(cleared, {
        type: "SET_INPUT",
        value: "旧的粘贴内容",
        cursorPos: "旧的粘贴内容".length,
        generation: scheduledGeneration,
      } as any);

      expect(staleFlush.inputValue).toBe("");
      expect(staleFlush.cursorPos).toBe(0);
    });
  });
});
