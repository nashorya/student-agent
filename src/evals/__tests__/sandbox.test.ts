import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEvalTasks } from '../task-loader.js';
import {
  createEvalSandbox,
  diffSnapshots,
  parseVerifierChecks,
  readChangedFileContents,
  runSolution,
  runVerifier,
  snapshotFiles,
} from '../sandbox.js';

describe('eval sandbox', () => {
  it('parses named verifier checks for structure comparisons', () => {
    expect(parseVerifierChecks([
      'CHECK config=pass',
      'ordinary output',
      'CHECK protected-files=fail',
    ].join('\n'))).toEqual({
      config: true,
      'protected-files': false,
    });
  });

  it('copies a task environment, verifies initial failure, and verifies solution success', async () => {
    const task = (await loadEvalTasks()).find((item) => item.id === 'precise-edit');
    expect(task).toBeTruthy();
    const initial = await createEvalSandbox(task!);
    try {
      const verifier = await runVerifier(task!, initial);
      expect(verifier.correctnessScore).toBe(0);
    } finally {
      await initial.cleanup();
    }

    const solved = await createEvalSandbox(task!);
    try {
      await runSolution(task!, solved);
      const verifier = await runVerifier(task!, solved);
      expect(verifier.correctnessScore).toBe(1);
    } finally {
      await solved.cleanup();
    }
  });

  it('diffs file snapshots', async () => {
    const task = (await loadEvalTasks()).find((item) => item.id === 'precise-edit')!;
    const sandbox = await createEvalSandbox(task);
    try {
      const before = await snapshotFiles(sandbox.path);
      await runSolution(task, sandbox);
      const after = await snapshotFiles(sandbox.path);
      expect(diffSnapshots(before, after)).toEqual(['src/message.txt']);
    } finally {
      await sandbox.cleanup();
    }
  });

  it('ignores .pi runtime files but still detects ordinary changed files', async () => {
    const task = (await loadEvalTasks()).find((item) => item.id === 'precise-edit')!;
    const sandbox = await createEvalSandbox(task);
    try {
      const before = await snapshotFiles(sandbox.path);
      await mkdir(join(sandbox.path, '.pi'), { recursive: true });
      await writeFile(join(sandbox.path, '.pi/auth.json'), '{"token":"runtime"}\n');
      await writeFile(join(sandbox.path, 'src/unexpected.txt'), 'changed\n');
      const after = await snapshotFiles(sandbox.path);

      expect(diffSnapshots(before, after)).toEqual(['src/unexpected.txt']);
    } finally {
      await sandbox.cleanup();
    }
  });

  it('reads final contents for changed files and skips deleted files', async () => {
    const task = (await loadEvalTasks()).find((item) => item.id === 'precise-edit')!;
    const sandbox = await createEvalSandbox(task);
    try {
      await writeFile(join(sandbox.path, 'src/message.txt'), 'final message\n');

      await expect(readChangedFileContents(sandbox.path, [
        'src/message.txt',
        'src/deleted.txt',
      ])).resolves.toEqual({
        'src/message.txt': 'final message\n',
      });
    } finally {
      await sandbox.cleanup();
    }
  });
});
