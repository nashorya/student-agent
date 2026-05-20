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
  it("create() returns an opaque snapshot id when working tree is clean", async () => {
    const { dir, cleanup } = await makeTmpRepo();
    try {
      const manager = new SnapshotManager(dir);
      const result = await manager.create();
      expect(result).toMatch(/^snapshot_\d+_\d+$/);
    } finally {
      await cleanup();
    }
  });

  it("create() returns an opaque snapshot id when there are uncommitted changes", async () => {
    const { dir, cleanup } = await makeTmpRepo();
    try {
      await writeFile(join(dir, "init.txt"), "modified content");
      const manager = new SnapshotManager(dir);
      const result = await manager.create();
      expect(result).toMatch(/^snapshot_\d+_\d+$/);
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
      await writeFile(join(dir, "pre-existing.txt"), "keep me");
      await writeFile(join(dir, "init.txt"), "snapshot state");
      const manager = new SnapshotManager(dir);
      const sha = await manager.create();
      await writeFile(join(dir, "extra.txt"), "extra");
      await manager.restore(sha);
      const content = await readFile(join(dir, "init.txt"), "utf8");
      const preExisting = await readFile(join(dir, "pre-existing.txt"), "utf8");
      expect(content).toBe("snapshot state");
      expect(preExisting).toBe("keep me");
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

  it("restore() restores pre-existing untracked files to snapshot content", async () => {
    const { dir, cleanup } = await makeTmpRepo();
    try {
      await writeFile(join(dir, "draft.txt"), "before");
      const manager = new SnapshotManager(dir);
      const sha = await manager.create();
      await writeFile(join(dir, "draft.txt"), "after");
      await manager.restore(sha);
      const content = await readFile(join(dir, "draft.txt"), "utf8");
      expect(content).toBe("before");
    } finally {
      await cleanup();
    }
  });

  it("restore() restores pre-existing untracked files after deletion", async () => {
    const { dir, cleanup } = await makeTmpRepo();
    try {
      await writeFile(join(dir, "draft.txt"), "before");
      const manager = new SnapshotManager(dir);
      const sha = await manager.create();
      await rm(join(dir, "draft.txt"));
      await manager.restore(sha);
      const content = await readFile(join(dir, "draft.txt"), "utf8");
      expect(content).toBe("before");
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

  it("restore() restores staged changes to snapshot state", async () => {
    const { dir, cleanup } = await makeTmpRepo();
    try {
      await writeFile(join(dir, "init.txt"), "staged content");
      const git = simpleGit(dir);
      await git.add("init.txt");
      const manager = new SnapshotManager(dir);
      const sha = await manager.create();
      await writeFile(join(dir, "init.txt"), "after staged");
      await manager.restore(sha);
      const content = await readFile(join(dir, "init.txt"), "utf8");
      const staged = await git.diff(["--cached", "--name-only"]);
      expect(content).toBe("staged content");
      expect(staged.trim()).toBe("init.txt");
    } finally {
      await cleanup();
    }
  });

  it("restore() removes staged changes created after snapshot", async () => {
    const { dir, cleanup } = await makeTmpRepo();
    try {
      const git = simpleGit(dir);
      const manager = new SnapshotManager(dir);
      const sha = await manager.create();
      await writeFile(join(dir, "init.txt"), "agent staged content");
      await git.add("init.txt");
      await manager.restore(sha);
      const content = await readFile(join(dir, "init.txt"), "utf8");
      const staged = await git.diff(["--cached", "--name-only"]);
      expect(content).toBe("init");
      expect(staged.trim()).toBe("");
    } finally {
      await cleanup();
    }
  });
});
