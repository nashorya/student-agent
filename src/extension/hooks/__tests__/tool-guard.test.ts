import { describe, it, expect, beforeEach } from "vitest";
import { drainProtectedEvents } from "../../../core/hashline/index.js";
import { createToolGuardHook } from "../tool-guard.js";
import type {
  PostToolCallContext,
  PreToolCallContext,
} from "../../../core/pi-bridge/types.js";

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

function makeResult(
  command: string,
  isError = true,
  toolCallId = "tool_result",
): PostToolCallContext {
  return {
    toolName: "bash",
    toolCallId,
    args: { command },
    isError,
    resultText: isError ? "validation failed" : "ok",
  };
}

describe("tool guard", () => {
  let guard: ReturnType<typeof createToolGuardHook>;

  beforeEach(() => {
    drainProtectedEvents();
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

  // ── Rule 5: Repeated validation failures ─────────────

  describe("verify retry", () => {
    it("blocks a fourth validation attempt after three consecutive failures", async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const before = await guard.hook(
          makeContext("bash", { command: "pytest tests/unit" }, `before_${attempt}`),
        );
        expect(before).toBeUndefined();
        guard.observeResult(makeResult("pytest tests/unit", true, `after_${attempt}`));
      }

      const blocked = await guard.hook(
        makeContext("bash", { command: "pytest tests/integration" }, "before_4"),
      );

      expect(blocked).toMatchObject({ block: true });
      expect(blocked?.reason).toContain("verify_retry");
      expect(drainProtectedEvents()).toContainEqual(expect.objectContaining({
        source: "toolguard",
        type: "block",
        ruleName: "verify_retry",
        blocked: true,
      }));
    });

    it("resets failed validation counts after a file edit", async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        guard.observeResult(makeResult("npm run build", true, `after_${attempt}`));
      }

      expect(await guard.hook(
        makeContext("apply_patch", { path: "src/a.ts" }, "edit_1"),
      )).toBeUndefined();

      expect(await guard.hook(
        makeContext("bash", { command: "npm run build" }, "before_4"),
      )).toBeUndefined();
    });

    it("tracks validation failures separately by command first token", async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        guard.observeResult(makeResult("pytest tests/unit", true, `pytest_${attempt}`));
      }

      expect(await guard.hook(
        makeContext("bash", { command: "npm run build" }, "npm_1"),
      )).toBeUndefined();
    });

    it("clears the validation failure streak after a successful validation", async () => {
      guard.observeResult(makeResult("pytest tests/unit", true, "failed_1"));
      guard.observeResult(makeResult("pytest tests/unit", true, "failed_2"));
      guard.observeResult(makeResult("pytest tests/unit", false, "success"));
      guard.observeResult(makeResult("pytest tests/unit", true, "failed_3"));

      expect(await guard.hook(
        makeContext("bash", { command: "pytest tests/unit" }, "before_next"),
      )).toBeUndefined();
    });

    it("does not count ordinary shell command failures as validation retries", async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        guard.observeResult(makeResult("git status", true, `git_${attempt}`));
      }

      expect(await guard.hook(
        makeContext("bash", { command: "git status" }, "git_next"),
      )).toBeUndefined();
    });

    it("does not treat package installation as validation", async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        guard.observeResult(makeResult("npm install", true, `install_${attempt}`));
      }

      expect(await guard.hook(
        makeContext("bash", { command: "npm install" }, "install_next"),
      )).toBeUndefined();
    });
  });
});
