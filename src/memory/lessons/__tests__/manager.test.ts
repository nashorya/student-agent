import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendSignal } from '../../signals/index.js';
import { LessonsManager } from '../manager.js';

describe('LessonsManager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'lessons-test-'));
  });

  afterEach(async () => {
    LessonsManager.resetInstance();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('turns a signal into a lesson candidate', async () => {
    await appendSignal({
      id: 'sig_1',
      kind: 'hashline_rejection',
      severity: 'high',
      summary: 'Hashline stale rejection: src/App.tsx',
      path: 'src/App.tsx',
      evidenceRef: 'hash123',
      createdAt: '2026-01-01T00:00:00.000Z',
    }, tmpDir);
    const mgr = LessonsManager.getInstance(tmpDir);

    const created = await mgr.observeRecentSignals({
      taskId: 'task_1',
      sessionRef: 'session_1',
      limit: 5,
    });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      sourceSignalId: 'sig_1',
      lesson: 'Avoid repeating stale edits after Hashline stale rejection: src/App.tsx',
      trigger: {
        signalKinds: ['hashline_rejection'],
        paths: ['src/App.tsx'],
      },
      status: 'observed',
      provenance: {
        taskId: 'task_1',
        sessionRef: 'session_1',
      },
    });
    expect(await mgr.getAll()).toHaveLength(1);
  });

  it('deduplicates candidates by source signal', async () => {
    await appendSignal({
      id: 'sig_dupe',
      kind: 'tool_error',
      severity: 'medium',
      summary: 'oldText must match exactly',
      createdAt: '2026-01-01T00:00:00.000Z',
    }, tmpDir);
    const mgr = LessonsManager.getInstance(tmpDir);

    await mgr.observeRecentSignals({ taskId: 'task_1', sessionRef: 's1', limit: 5 });
    await mgr.observeRecentSignals({ taskId: 'task_1', sessionRef: 's1', limit: 5 });

    expect(await mgr.getAll()).toHaveLength(1);
  });
});
