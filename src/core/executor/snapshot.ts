import { simpleGit, SimpleGit } from "simple-git";

export class SnapshotManager {
  private readonly git: SimpleGit;

  constructor(private readonly repoPath: string) {
    this.git = simpleGit(repoPath);
  }

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
      await this.git.raw(["clean", "-fd"]);
    } catch (err) {
      throw new Error(`SnapshotManager.restore() failed for sha ${sha} in ${this.repoPath}`, {
        cause: err,
      });
    }
  }
}
