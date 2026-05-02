import { simpleGit, SimpleGit } from "simple-git";

export class SnapshotManager {
  private readonly git: SimpleGit;

  constructor(private readonly repoPath: string) {
    this.git = simpleGit(repoPath);
  }

  /**
   * Creates a non-destructive snapshot of the current working tree using `git stash create`.
   * Returns the stash SHA, or an empty string if the working tree is clean (nothing to snapshot).
   * Pass the returned value directly to `restore()` — an empty string is a safe no-op.
   */
  async create(): Promise<string> {
    try {
      const result = await this.git.raw(["stash", "create"]);
      return result.trim();
    } catch (err) {
      throw new Error(`SnapshotManager.create() failed in ${this.repoPath}`, { cause: err });
    }
  }

  async restore(sha: string): Promise<void> {
    if (sha === "") {
      return;
    }
    try {
      await this.git.raw(["checkout", sha, "--", "."]);
    } catch (err) {
      throw new Error(
        `SnapshotManager.restore(): checkout failed for sha ${sha} in ${this.repoPath}`,
        { cause: err },
      );
    }
    try {
      await this.git.raw(["clean", "-fd"]);
    } catch (err) {
      throw new Error(
        `SnapshotManager.restore(): clean -fd failed after checkout of sha ${sha} in ${this.repoPath}`,
        { cause: err },
      );
    }
    // Note: `git clean -fd` removes untracked files but does not reset the index for
    // staged-but-never-committed new files. This is a known git limitation for this restore strategy.
  }
}
