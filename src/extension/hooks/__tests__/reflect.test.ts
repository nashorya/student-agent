import { afterEach, describe, it, expect, vi } from 'vitest';
import { collectTaskDiff, emitReflectSummaryForTesting, markReflectBaseline } from '../reflect.js';
import { setTuiMode } from '../../../tui/logger.js';

afterEach(() => {
  setTuiMode(false);
  vi.restoreAllMocks();
});

describe('reflect diff collection', () => {
  it('collectTaskDiff 包含 base、staged、unstaged 和 untracked 文件', () => {
    const diff = collectTaskDiff('HEAD', {
      cwd: '/repo',
      execGit: (args) => {
        const command = args.join(' ');
        if (command === 'rev-parse --is-inside-work-tree') {
          return 'true\n';
        }
        if (command === 'diff --binary HEAD --') {
          return 'diff --git a/base.txt b/base.txt\n+++ b/base.txt\n+base\n';
        }
        if (command === 'diff --cached --binary --') {
          return 'diff --git a/staged.txt b/staged.txt\n+++ b/staged.txt\n+staged\n';
        }
        if (command === 'diff --binary --') {
          return 'diff --git a/tracked.txt b/tracked.txt\n+++ b/tracked.txt\n+unstaged\n';
        }
        if (command === 'ls-files --others --exclude-standard') {
          return 'untracked.txt\n';
        }
        return '';
      },
      readFile: () => 'untracked\n',
    });

    expect(diff).toContain('+++ b/base.txt');
    expect(diff).toContain('+base');
    expect(diff).toContain('+++ b/tracked.txt');
    expect(diff).toContain('+unstaged');
    expect(diff).toContain('+++ b/staged.txt');
    expect(diff).toContain('+staged');
    expect(diff).toContain('+++ b/untracked.txt');
    expect(diff).toContain('+untracked');
  });

  it('非 Git 目录直接跳过 diff 收集', () => {
    const commands: string[] = [];
    const diff = collectTaskDiff('HEAD', {
      cwd: '/plain-folder',
      execGit: (args) => {
        commands.push(args.join(' '));
        throw new Error('fatal: not a git repository');
      },
    });

    expect(diff).toBe('');
    expect(commands).toEqual(['rev-parse --is-inside-work-tree']);
  });

  it('非 Git 目录标记 baseline 时不执行 stash', () => {
    const commands: string[] = [];

    markReflectBaseline({
      cwd: '/plain-folder',
      execGit: (args) => {
        commands.push(args.join(' '));
        throw new Error('fatal: not a git repository');
      },
    });

    expect(commands).toEqual(['rev-parse --is-inside-work-tree']);
  });

  it('TUI 模式下 Reflect 摘要不直接写 console/stdout', () => {
    setTuiMode(true);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    emitReflectSummaryForTesting({
      patternsExtracted: 1,
      promotedCount: 0,
    });

    expect(consoleLog).not.toHaveBeenCalled();
    expect(stdoutWrite).not.toHaveBeenCalled();
  });
});
