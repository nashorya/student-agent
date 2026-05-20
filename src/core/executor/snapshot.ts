import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { simpleGit, SimpleGit } from 'simple-git';

interface SnapshotRecord {
  sha: string;
  stagedPatch: string;
  untrackedFiles: Set<string>;
  untrackedFileContents: Map<string, Buffer>;
}

export class SnapshotManager {
  private readonly git: SimpleGit;
  private readonly snapshots = new Map<string, SnapshotRecord>();
  private sequence = 0;

  constructor(private readonly repoPath: string) {
    this.git = simpleGit(repoPath);
  }

  /**
   * Creates a non-destructive snapshot of the current working tree.
   * The returned value is an opaque id; pass it directly to `restore()`.
   */
  async create(): Promise<string> {
    try {
      const [result, stagedPatch, untrackedFiles] = await Promise.all([
        this.git.raw(['stash', 'create']),
        this.git.raw(['diff', '--cached', '--binary']),
        this.listUntrackedFiles(),
      ]);
      const untrackedFileContents = await this.backupUntrackedFiles(untrackedFiles);
      const id = `snapshot_${Date.now()}_${this.sequence++}`;
      this.snapshots.set(id, {
        sha: result.trim() || 'HEAD',
        stagedPatch,
        untrackedFiles,
        untrackedFileContents,
      });
      return id;
    } catch (err) {
      throw new Error(`SnapshotManager.create() failed in ${this.repoPath}`, { cause: err });
    }
  }

  async restore(snapshotId: string): Promise<void> {
    if (snapshotId === '') {
      return;
    }
    const snapshot = this.snapshots.get(snapshotId) ?? {
      sha: snapshotId,
      stagedPatch: '',
      untrackedFiles: await this.listUntrackedFiles(),
      untrackedFileContents: new Map(),
    };

    await this.restoreTrackedFiles(snapshot.sha);
    await this.resetIndexToHead();
    await this.restoreStagedPatch(snapshot.stagedPatch);
    await this.removeUntrackedFilesCreatedAfter(snapshot.untrackedFiles);
    await this.restoreUntrackedFiles(snapshot.untrackedFileContents);
    this.snapshots.delete(snapshotId);
  }

  private async restoreTrackedFiles(sha: string): Promise<void> {
    try {
      await this.git.raw(['checkout', sha, '--', '.']);
    } catch (err) {
      throw new Error(
        `SnapshotManager.restore(): checkout failed for sha ${sha} in ${this.repoPath}`,
        { cause: err },
      );
    }
  }

  private async resetIndexToHead(): Promise<void> {
    try {
      await this.git.raw(['reset', 'HEAD', '--', '.']);
    } catch (err) {
      throw new Error(`SnapshotManager.resetIndexToHead() failed in ${this.repoPath}`, { cause: err });
    }
  }

  private async restoreStagedPatch(stagedPatch: string): Promise<void> {
    if (stagedPatch.trim() === '') return;

    const dir = await mkdtemp(join(tmpdir(), 'student-agent-staged-patch-'));
    const patchPath = join(dir, 'staged.patch');
    try {
      await writeFile(patchPath, stagedPatch, 'utf-8');
      await this.git.raw(['apply', '--cached', '--binary', patchPath]);
    } catch (err) {
      throw new Error('SnapshotManager.restoreStagedPatch() failed', { cause: err });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async removeUntrackedFilesCreatedAfter(before: Set<string>): Promise<void> {
    const current = await this.listUntrackedFiles();
    const createdAfterSnapshot = [...current].filter((file) => !before.has(file));

    for (const file of createdAfterSnapshot) {
      await this.removeRepoFile(file);
    }
  }

  private async backupUntrackedFiles(files: Set<string>): Promise<Map<string, Buffer>> {
    const result = new Map<string, Buffer>();
    for (const file of files) {
      try {
        result.set(file, await readFile(join(this.repoPath, file)));
      } catch (err) {
        throw new Error(`SnapshotManager.backupUntrackedFiles() failed for ${file}`, { cause: err });
      }
    }
    return result;
  }

  private async restoreUntrackedFiles(files: Map<string, Buffer>): Promise<void> {
    for (const [file, content] of files.entries()) {
      const absolutePath = join(this.repoPath, file);
      try {
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, content);
      } catch (err) {
        throw new Error(`SnapshotManager.restoreUntrackedFiles() failed for ${file}`, { cause: err });
      }
    }
  }

  private async listUntrackedFiles(): Promise<Set<string>> {
    try {
      const output = await this.git.raw(['ls-files', '--others', '--exclude-standard', '-z']);
      return new Set(output.split('\0').filter(Boolean));
    } catch (err) {
      throw new Error(`SnapshotManager.listUntrackedFiles() failed in ${this.repoPath}`, { cause: err });
    }
  }

  private async removeRepoFile(relativePath: string): Promise<void> {
    try {
      await rm(join(this.repoPath, relativePath), { force: true, recursive: true });
    } catch (err) {
      throw new Error(`SnapshotManager.removeRepoFile() failed for ${relativePath}`, { cause: err });
    }
  }
}
