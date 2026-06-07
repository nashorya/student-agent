import { describe, it, expect, vi, beforeEach } from "vitest";
import { createToolGuardHook } from "../tool-guard.js";
import type { PreToolCallContext } from "../../../core/pi-bridge/types.js";

function makeContext(
  toolName: string,
  args: unknown,
  toolCallId = "tool_1",
): PreToolCallContext {
  return {
    toolName,
    toolCallId,
    args,
  };
}

describe("tool guard", () => {
  let guard: ReturnType<typeof createToolGuardHook>;

  beforeEach(() => {
    guard = createToolGuardHook();
  });

  // ── Rule 1: Empty bash ──────────────────────────────

  describe("empty bash", () => {
    it("blocks bash with empty command", async () => {
      const result = await guard.hook(
        makeContext("bash", { command: "" }),
      );
      expect(result).toMatchObject({ block: true });
      expect(result?.reason).toContain("empty_bash");
    });

    it("blocks bash with whitespace-only command", async () => {
      const result = await guard.hook(
        makeContext("bash", { command: "   " }),
      );
      expect(result).toMatchObject({ block: true });
      expect(result?.reason).toContain("empty_bash");
    });

    it("allows normal bash command", async () => {
      const result = await guard.hook(
        makeContext("bash", { command: "ls -la" }),
      );
      expect(result).toBeUndefined();
    });
  });

  // ── Rule 2: Natural language bash ────────────────────

  describe("natural language bash", () => {
    it("blocks natural language command in English", async () => {
      const result = await guard.hook(
        makeContext("bash", { command: "please create a new file called test" }),
      );
      expect(result).toMatchObject({ block: true });
      expect(result?.reason).toContain("nl_bash");
    });

    it("allows normal bash command with flags", async () => {
      const result = await guard.hook(
        makeContext("bash", { command: 'grep -rn "hello" src/' }),
      );
      expect(result).toBeUndefined();
    });
  });

  // ── Rule 3: Broad glob ───────────────────────────────

  describe("broad glob", () => {
    it("blocks overly broad glob pattern", async () => {
      const result = await guard.hook(
        makeContext("glob", { pattern: "**/*.ts" }),
      );
      expect(result).toMatchObject({ block: true });
      expect(result?.reason).toContain("broad_glob");
    });

    it("allows scoped glob pattern", async () => {
      const result = await guard.hook(
        makeContext("glob", { pattern: "src/core/**/*.ts" }),
      );
      expect(result).toBeUndefined();
    });
  });

  // ── Rule 4: Patch retry without re-read ──────────────

  describe("patch retry", () => {
    it("blocks repeated edit on same file without re-read", async () => {
      // First edit — should pass
      const first = await guard.hook(
        makeContext("edit", { path: "a.ts", oldText: "x", newText: "y" }, "t1"),
      );
      expect(first).toBeUndefined();

      // Second edit on same file without re-read — should block
      const second = await guard.hook(
        makeContext("edit", { path: "a.ts", oldText: "z", newText: "w" }, "t2"),
      );
      expect(second).toMatchObject({ block: true });
      expect(second?.reason).toContain("patch_retry");
    });

    it("allows edit after re-read", async () => {
      // First edit
      const first = await guard.hook(
        makeContext("edit", { path: "a.ts" }, "t1"),
      );
      expect(first).toBeUndefined();

      // Re-read the file
      const readResult = await guard.hook(
        makeContext("read", { path: "a.ts" }, "t2"),
      );
      expect(readResult).toBeUndefined();

      // Second edit on same file after re-read — should pass
      const second = await guard.hook(
        makeContext("edit", { path: "a.ts" }, "t3"),
      );
      expect(second).toBeUndefined();
    });

    it("clears state on reset — same pattern is allowed after reset", async () => {
      // First edit
      const first = await guard.hook(
        makeContext("edit", { path: "a.ts" }, "t1"),
      );
      expect(first).toBeUndefined();

      // Second edit on same file without re-read — blocked
      const second = await guard.hook(
        makeContext("edit", { path: "a.ts" }, "t2"),
      );
      expect(second).toMatchObject({ block: true });

      // Reset
      guard.reset();

      // Same pattern again after reset — should not block
      const third = await guard.hook(
        makeContext("edit", { path: "a.ts" }, "t3"),
      );
      expect(third).toBeUndefined();
    });
  });
});