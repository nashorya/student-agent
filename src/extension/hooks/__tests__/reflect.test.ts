import { describe, it, expect } from 'vitest';
import { collectTaskDiff } from '../reflect.js';

describe('reflect diff collection', () => {
  it('collectTaskDiff 包含 base、staged、unstaged 和 untracked 文件', () => {
    const diff = collectTaskDiff('HEAD', {
      cwd: '/repo',
      execGit: (args) => {
        const command = args.join(' ');
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
});
