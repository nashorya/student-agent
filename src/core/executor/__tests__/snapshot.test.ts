import { mkdtemp, rm, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { describe, it, expect } from "vitest";
import { SnapshotManager } from "../snapshot.js";

async function makeTmpRepo(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "snapshot-test-"));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig("user.email", "test@test.local");
  await git.addConfig("user.name", "Test");
  await writeFile(join(dir, "init.txt"), "init");
  await git.add(".");
  await git.commit("initial");
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe("SnapshotManager", () => {
  it("create() returns empty string when working tree is clean", async () => {
    const { dir, cleanup } = await makeTmpRepo();
    try {
      const manager = new SnapshotManager(dir);
      const result = await manager.create();
      expect(result).toBe("");
    } finally {
      await cleanup();
    }
  });

  it("create() returns a 40-char SHA when there are uncommitted changes", async () => {
    const { dir, cleanup } = await makeTmpRepo();
    try {
      await writeFile(join(dir, "init.txt"), "modified content");
      const manager = new SnapshotManager(dir);
      const result = await manager.create();
      expect(result).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      await cleanup();
    }
  });

  it("restore() restores a modified tracked file to snapshot state", async () => {
    const { dir, cleanup } = await makeTmpRepo();
    try {
      await writeFile(join(dir, "init.txt"), "before");
      const manager = new SnapshotManager(dir);
      const sha = await manager.create();
      await writeFile(join(dir, "init.txt"), "after");
      await manager.restore(sha);
      const content = await readFile(join(dir, "init.txt"), "utf8");
      expect(content).toBe("before");
    } finally {
      await cleanup();
    }
  });

  it("restore() removes untracked files added after snapshot and restores tracked files", async () => {
    const { dir, cleanup } = await makeTmpRepo();
    try {
      await writeFile(join(dir, "init.txt"), "snapshot state");
      const manager = new SnapshotManager(dir);
      const sha = await manager.create();
      await writeFile(join(dir, "extra.txt"), "extra");
      await manager.restore(sha);
      const content = await readFile(join(dir, "init.txt"), "utf8");
      expect(content).toBe("snapshot state");
      let extraExists = false;
      try {
        await access(join(dir, "extra.txt"));
        extraExists = true;
      } catch {
        extraExists = false;
      }
      expect(extraExists).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("restore() with empty sha returns early without error", async () => {
    const { dir, cleanup } = await makeTmpRepo();
    try {
      await writeFile(join(dir, "init.txt"), "modified");
      const manager = new SnapshotManager(dir);
      await expect(manager.restore("")).resolves.toBeUndefined();
      const content = await readFile(join(dir, "init.txt"), "utf8");
      expect(content).toBe("modified");
    } finally {
      await cleanup();
    }
  });
});
