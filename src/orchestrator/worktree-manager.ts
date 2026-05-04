import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export interface WorktreeLease {
  path: string;
  branch: string;
}

export interface WorktreeManagerOptions {
  rootCwd: string;
  tempRoot?: string;
  execGit?: (args: string[], cwd: string) => string;
}

export class WorktreeManager {
  private readonly rootCwd: string;
  private readonly tempRoot: string;
  private readonly execGit: (args: string[], cwd: string) => string;

  constructor(options: WorktreeManagerOptions) {
    this.rootCwd = options.rootCwd;
    this.tempRoot = options.tempRoot ?? tmpdir();
    this.execGit = options.execGit ?? defaultExecGit;
  }

  async create(taskId: string): Promise<WorktreeLease> {
    const worktreePath = await mkdtemp(join(this.tempRoot, `student-agent-${taskId}-`));
    const branch = `student-agent/${taskId}-${Date.now()}`;
    try {
      this.execGit(['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], this.rootCwd);
      return { path: worktreePath, branch };
    } catch (err) {
      await rm(worktreePath, { recursive: true, force: true });
      throw err;
    }
  }

  async collectPatch(lease: WorktreeLease): Promise<string> {
    return [
      this.safeGit(['diff', '--binary', 'HEAD', '--'], lease.path),
      this.safeGit(['diff', '--cached', '--binary', '--'], lease.path),
      await this.collectUntrackedDiff(lease.path),
    ].filter(Boolean).join('\n');
  }

  async collectWrittenFiles(lease: WorktreeLease): Promise<string[]> {
    const tracked = [
      ...parseLines(this.safeGit(['diff', '--name-only', 'HEAD', '--'], lease.path)),
      ...parseLines(this.safeGit(['diff', '--cached', '--name-only', '--'], lease.path)),
    ];
    const untracked = parseLines(this.safeGit(['ls-files', '--others', '--exclude-standard'], lease.path));
    return Array.from(new Set([...tracked, ...untracked]));
  }

  async cleanup(lease: WorktreeLease): Promise<void> {
    this.safeGit(['worktree', 'remove', '--force', lease.path], this.rootCwd);
    this.safeGit(['branch', '-D', lease.branch], this.rootCwd);
    await rm(lease.path, { recursive: true, force: true });
  }

  private safeGit(args: string[], cwd: string): string {
    try {
      return this.execGit(args, cwd);
    } catch {
      return '';
    }
  }

  private async collectUntrackedDiff(cwd: string): Promise<string> {
    const files = parseLines(this.safeGit(['ls-files', '--others', '--exclude-standard'], cwd));
    const chunks: string[] = [];
    for (const path of files) {
      try {
        const content = await readFile(join(cwd, path), 'utf-8');
        const lines = content.split(/\r?\n/);
        chunks.push([
          `diff --git a/${path} b/${path}`,
          'new file mode 100644',
          'index 0000000..0000000',
          '--- /dev/null',
          `+++ b/${path}`,
          `@@ -0,0 +1,${lines.length} @@`,
          ...lines.map((line) => `+${line}`),
        ].join('\n'));
      } catch {
        // ignore unreadable transient files
      }
    }
    return chunks.join('\n');
  }
}

function defaultExecGit(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    timeout: 10_000,
  });
}

function parseLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
