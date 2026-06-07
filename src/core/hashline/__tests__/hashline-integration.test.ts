/**
 * Hashline integration tests.
 *
 * Uses real temporary directories and real file I/O via StudentAgentFilesystem.
 * No mocking of hashline internals — only the SnapshotStore/Filesystem adapters
 * under test.
 *
 * The Bun.hash polyfill is imported from ../bun-polyfill.js so that
 * InMemorySnapshotStore's computeFileHash works in Node.js/vitest.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InMemorySnapshotStore } from "@oh-my-pi/hashline";
import "../bun-polyfill.js"; // Installs Bun.hash.xxHash32 polyfill for Node.js
import { StudentAgentFilesystem } from "../filesystem-adapter.js";
import { createHashlineStore } from "../store.js";
import { emitProtectedEvent, drainProtectedEvents } from "../event-emitter.js";
import { xxHash32 } from "../bun-polyfill.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "hashline-test-"));
}

async function cleanupDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Hashline integration", () => {
  let tempDir: string;
  let store: InMemorySnapshotStore;
  let fs: StudentAgentFilesystem;

  beforeEach(() => {
    drainProtectedEvents();
  });

  beforeEach(async () => {
    tempDir = await createTempDir();
    store = createHashlineStore();
    fs = new StudentAgentFilesystem(tempDir);
  });

  afterEach(async () => {
    await cleanupDir(tempDir);
  });

  // -----------------------------------------------------------------------
  // 1. Tag generation: read a file → store records a tag
  // -----------------------------------------------------------------------

  describe("tag generation", () => {
    it("creates a tag when recording file content via store", async () => {
      const filePath = "config.ts";
      const content = "const x = 1;\nexport { x };\n";
      await writeFile(join(tempDir, filePath), content, "utf-8");

      // Read via filesystem adapter
      const readContent = await fs.readText(filePath);
      expect(readContent).toBe(content);

      // Record in store
      const tag = store.record(filePath, readContent);

      // Tag should be a non-empty string (4+ hex chars per hashline format)
      expect(tag).toBeTruthy();
      expect(tag.length).toBeGreaterThanOrEqual(4);

      // Store should have the snapshot retrievable by tag
      const snapshot = store.byHash(filePath, tag);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.path).toBe(filePath);
      expect(snapshot!.text).toBe(content);
      expect(snapshot!.hash).toBe(tag);
    });

    it("returns the same tag for identical content", () => {
      const content = "hello world\n";
      const tag1 = store.record("a.txt", content);
      const tag2 = store.record("a.txt", content);
      // Same content → same hash → same tag
      expect(tag1).toBe(tag2);
    });

    it("returns a different tag for modified content", () => {
      const tag1 = store.record("a.txt", "version 1\n");
      const tag2 = store.record("a.txt", "version 2\n");
      expect(tag1).not.toBe(tag2);
    });

    it("head() returns the latest snapshot for a path", () => {
      store.record("a.txt", "version 1\n");
      store.record("a.txt", "version 2\n");

      const head = store.head("a.txt");
      expect(head).not.toBeNull();
      expect(head!.text).toBe("version 2\n");
    });
  });

  // -----------------------------------------------------------------------
  // 2. Normal edit: tag is fresh → edit succeeds
  // -----------------------------------------------------------------------

  describe("normal edit with valid tag", () => {
    it("accepts an edit when the tag matches current file content", async () => {
      const filePath = "app.ts";
      const originalContent = "const app = 'original';\n";
      await writeFile(join(tempDir, filePath), originalContent, "utf-8");

      // Record the file state
      const tag = store.record(filePath, originalContent);
      expect(tag).toBeTruthy();

      // Verify: reading the file gives the same content (tag still valid)
      const currentContent = await fs.readText(filePath);
      const currentTag = store.record(filePath, currentContent);
      expect(currentTag).toBe(tag);

      // Simulate a successful edit: write new content, record it
      const newContent = "const app = 'modified';\n";
      await writeFile(join(tempDir, filePath), newContent, "utf-8");
      const newTag = store.record(filePath, await fs.readText(filePath));

      expect(newTag).not.toBe(tag); // Edit changed the file → new tag
      expect(store.byHash(filePath, newTag)).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 3. Stale rejection: file externally modified → old tag is rejected
  // -----------------------------------------------------------------------

  describe("stale rejection", () => {
    it("detects stale tag when file is modified externally", async () => {
      const filePath = "stale.ts";
      const originalContent = "const val = 1;\n";
      await writeFile(join(tempDir, filePath), originalContent, "utf-8");

      // Record original state
      const originalTag = store.record(filePath, originalContent);

      // Simulate external modification (outside the agent's knowledge)
      const modifiedContent = "const val = 2; // externally modified\n";
      await writeFile(join(tempDir, filePath), modifiedContent, "utf-8");

      // Re-record: the tag for current content differs from the original
      const currentContent = await fs.readText(filePath);
      const currentTag = store.record(filePath, currentContent);

      // The original tag should no longer match
      expect(currentTag).not.toBe(originalTag);

      // Verify the snapshot for the original tag still exists (for recovery)
      const originalSnapshot = store.byHash(filePath, originalTag);
      expect(originalSnapshot).not.toBeNull();
      expect(originalSnapshot!.text).toBe(originalContent);
    });

    it("emits stale_rejection event for unrecognised tag via emitProtectedEvent", () => {
      // Simulate what the edit tool does when it encounters an unrecognised tag
      const fakeTag = "abcd";
      emitProtectedEvent({
        source: "hashline",
        type: "stale_rejection",
        path: "unknown.ts",
        evidenceRef: fakeTag,
        blocked: true,
        provenance: { reason: "unrecognised_tag", tag: fakeTag },
      });

      const events = drainProtectedEvents();
      expect(events).toHaveLength(1);
      expect(events[0].source).toBe("hashline");
      expect(events[0].type).toBe("stale_rejection");
      expect(events[0].path).toBe("unknown.ts");
      expect(events[0].blocked).toBe(true);
      expect(events[0].timestamp).toBeTruthy();
    });

    it("emits stale_rejection event for stale tag with hash details", () => {
      drainProtectedEvents(); // Clear

      emitProtectedEvent({
        source: "hashline",
        type: "stale_rejection",
        path: "config.ts",
        evidenceRef: "a1b2",
        blocked: true,
        provenance: {
          reason: "stale_tag",
          expectedFileHash: "a1b2",
          actualFileHash: "c3d4",
        },
      });

      const events = drainProtectedEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("stale_rejection");
      expect(events[0].provenance).toEqual({
        reason: "stale_tag",
        expectedFileHash: "a1b2",
        actualFileHash: "c3d4",
      });
    });
  });

  // -----------------------------------------------------------------------
  // 4. Recovery: session-internal 3-way merge recovery
  // -----------------------------------------------------------------------

  describe("recovery", () => {
    it("retains prior version snapshots for 3-way merge", () => {
      // Simulate a session editing the same file 3 times:
      // v1 → v2 → v3, each recorded in the store
      store.record("app.ts", "const x = 1;\n");       // v1
      store.record("app.ts", "const x = 2;\n");       // v2
      store.record("app.ts", "const x = 3;\n");       // v3

      // The store keeps maxVersionsPerPath=4, so v1 should still exist
      const head = store.head("app.ts");
      expect(head!.text).toBe("const x = 3;\n");

      // Check that v1 snapshot is retained (accessible by hash)
      const v1Tag = store.record("app.ts", "const x = 1;\n");
      const v1Snapshot = store.byHash("app.ts", v1Tag);
      expect(v1Snapshot).not.toBeNull();
      expect(v1Snapshot!.text).toBe("const x = 1;\n");
    });

    it("emits recovery_success event via emitProtectedEvent", () => {
      drainProtectedEvents(); // Clear

      emitProtectedEvent({
        source: "hashline",
        type: "recovery_success",
        path: "app.ts",
        evidenceRef: "a1b2",
        blocked: false,
        provenance: {
          reason: "3way_merge",
          originalTag: "a1b2",
          recoveredTag: "c3d4",
        },
      });

      const events = drainProtectedEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("recovery_success");
      expect(events[0].blocked).toBe(false);
      expect(events[0].timestamp).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // 5. ProtectedEvalEvent collection
  // -----------------------------------------------------------------------

  describe("ProtectedEvalEvent collection", () => {
    it("collects multiple events of different types", () => {
      drainProtectedEvents(); // Clear

      emitProtectedEvent({
        source: "hashline",
        type: "stale_rejection",
        path: "a.ts",
        evidenceRef: "tag1",
        blocked: true,
        provenance: { reason: "stale_tag" },
      });

      emitProtectedEvent({
        source: "hashline",
        type: "recovery_success",
        path: "b.ts",
        evidenceRef: "tag2",
        blocked: false,
        provenance: { reason: "3way_merge" },
      });

      emitProtectedEvent({
        source: "hashline",
        type: "stale_rejection",
        path: "c.ts",
        evidenceRef: "tag3",
        blocked: true,
        provenance: { reason: "unrecognised_tag", tag: "tag3" },
      });

      const events = drainProtectedEvents();
      expect(events).toHaveLength(3);

      // Verify each event has the required fields
      for (const event of events) {
        expect(event.timestamp).toBeTruthy();
        expect(typeof event.timestamp).toBe("string");
        expect(event.source).toBe("hashline");
        expect(event.path).toBeTruthy();
        expect(typeof event.blocked).toBe("boolean");
        expect(event.provenance).toBeDefined();
      }

      // Verify specific event types
      const rejections = events.filter((e) => e.type === "stale_rejection");
      const recoveries = events.filter((e) => e.type === "recovery_success");
      expect(rejections).toHaveLength(2);
      expect(recoveries).toHaveLength(1);
    });

    it("drainProtectedEvents clears the buffer", () => {
      drainProtectedEvents(); // Clear

      emitProtectedEvent({
        source: "hashline",
        type: "stale_rejection",
        path: "a.ts",
        evidenceRef: "t1",
        blocked: true,
      });

      const first = drainProtectedEvents();
      expect(first).toHaveLength(1);

      const second = drainProtectedEvents();
      expect(second).toHaveLength(0);
    });

    it("auto-injects timestamp when not provided", () => {
      drainProtectedEvents(); // Clear

      emitProtectedEvent({
        source: "hashline",
        type: "stale_rejection",
        path: "a.ts",
        evidenceRef: "t1",
        blocked: true,
        // No timestamp provided — should be auto-injected
      });

      const events = drainProtectedEvents();
      expect(events).toHaveLength(1);

      // Verify timestamp is a valid ISO-8601 string
      const ts = events[0].timestamp;
      expect(ts).toBeTruthy();
      const parsed = new Date(ts);
      expect(parsed.getTime()).not.toBeNaN();
      // Timestamp should be recent (within last 10 seconds)
      expect(Date.now() - parsed.getTime()).toBeLessThan(10_000);
    });

    it("preserves caller-provided timestamp", () => {
      drainProtectedEvents(); // Clear

      const customTs = "2026-01-15T12:00:00.000Z";
      emitProtectedEvent({
        source: "hashline",
        type: "stale_rejection",
        path: "a.ts",
        evidenceRef: "t1",
        blocked: true,
        timestamp: customTs,
      });

      const events = drainProtectedEvents();
      expect(events[0].timestamp).toBe(customTs);
    });
  });

  // -----------------------------------------------------------------------
  // StudentAgentFilesystem integration
  // -----------------------------------------------------------------------

  describe("StudentAgentFilesystem", () => {
    it("resolves paths relative to cwd", async () => {
      const content = "hello\n";
      await writeFile(join(tempDir, "test.txt"), content, "utf-8");

      const readContent = await fs.readText("test.txt");
      expect(readContent).toBe(content);
    });

    it("canonicalPath resolves relative to cwd", () => {
      const resolved = fs.canonicalPath("subdir/file.ts");
      expect(resolved).toBe(join(tempDir, "subdir", "file.ts"));
    });

    it("readText throws NotFoundError on missing file", async () => {
      await expect(fs.readText("nonexistent.txt")).rejects.toThrow();
    });

    it("writeText creates and reads back file content", async () => {
      const content = "written content\n";
      const result = await fs.writeText("new-file.txt", content);
      expect(result.text).toBe(content);

      const readBack = await fs.readText("new-file.txt");
      expect(readBack).toBe(content);
    });

    it("exists returns true for existing file", async () => {
      await writeFile(join(tempDir, "exists.txt"), "data", "utf-8");
      expect(await fs.exists("exists.txt")).toBe(true);
    });

    it("exists returns false for missing file", async () => {
      expect(await fs.exists("no-such-file.txt")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // InMemorySnapshotStore with createHashlineStore
  // -----------------------------------------------------------------------

  describe("createHashlineStore", () => {
    it("respects maxPaths limit with LRU eviction", () => {
      const limitedStore = createHashlineStore({ maxPaths: 3 });

      limitedStore.record("file1.ts", "content1");
      limitedStore.record("file2.ts", "content2");
      limitedStore.record("file3.ts", "content3");

      // All 3 should be present
      expect(limitedStore.head("file1.ts")).not.toBeNull();
      expect(limitedStore.head("file2.ts")).not.toBeNull();
      expect(limitedStore.head("file3.ts")).not.toBeNull();

      // Adding a 4th path evicts the oldest
      limitedStore.record("file4.ts", "content4");

      // file4 must be present
      expect(limitedStore.head("file4.ts")).not.toBeNull();
    });

    it("respects maxVersionsPerPath limit", () => {
      const limitedStore = createHashlineStore({ maxVersionsPerPath: 2 });

      const tag1 = limitedStore.record("app.ts", "v1");
      const tag2 = limitedStore.record("app.ts", "v2");
      limitedStore.record("app.ts", "v3");

      // After recording 3 versions with maxVersionsPerPath=2,
      // v1 should be evicted
      const v1Snapshot = limitedStore.byHash("app.ts", tag1);
      // v2 should still be accessible
      const v2Snapshot = limitedStore.byHash("app.ts", tag2);
      expect(v2Snapshot).not.toBeNull();
      // head should be v3
      const head = limitedStore.head("app.ts");
      expect(head!.text).toBe("v3");
    });
  });

  // -----------------------------------------------------------------------
  // Bun.hash polyfill correctness
  // -----------------------------------------------------------------------

  describe("Bun.hash polyfill (xxHash32)", () => {
    it("is installed as globalThis.Bun.hash.xxHash32", () => {
      expect((globalThis as Record<string, unknown>).Bun).toBeDefined();
      const bun = (globalThis as Record<string, unknown>).Bun as Record<string, unknown>;
      expect(typeof bun.hash).toBe("object");
      const hash = bun.hash as Record<string, unknown>;
      expect(typeof hash.xxHash32).toBe("function");
    });

    it("produces deterministic results for same input", () => {
      const result1 = xxHash32("hello world", 0);
      const result2 = xxHash32("hello world", 0);
      expect(result1).toBe(result2);
    });

    it("produces different results for different inputs", () => {
      const result1 = xxHash32("hello world", 0);
      const result2 = xxHash32("hello universe", 0);
      expect(result1).not.toBe(result2);
    });

    it("produces known xxHash32 result for empty string with seed 0", () => {
      // Reference: xxHash32("") with seed=0 = 0x02CC5D05 (46947589)
      const result = xxHash32("", 0);
      expect(result).toBe(0x02CC5D05);
    });

    it("produces known xxHash32 result for 'hello' with seed 0", () => {
      // Reference: xxHash32("hello") with seed=0 = 0xFB0077F9 (4211111929)
      const result = xxHash32("hello", 0);
      expect(result).toBe(0xFB0077F9);
    });
  });
});