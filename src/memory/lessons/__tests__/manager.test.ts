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

  it('routes an unverified process-error lesson to ephemeral storage', async () => {
    await appendSignal({
      id: 'sig_1',
      kind: 'tool_error',
      severity: 'medium',
      summary: 'pytest failed before the fix was verified',
      toolName: 'bash',
      toolCallId: 'call_failed',
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
      quality: 'low',
      status: 'observed',
    });
    expect(await mgr.getAll()).toHaveLength(0);
    expect(await mgr.getEphemeral()).toHaveLength(1);
  });

  it('stores a lesson in the main library when tool evidence is followed by exit 0', async () => {
    const mgr = LessonsManager.getInstance(tmpDir);
    const created = await mgr.observeSignals([{
      id: 'sig_verified',
      kind: 'tool_error',
      severity: 'medium',
      summary: 'targeted test failed',
      toolName: 'bash',
      toolCallId: 'call_failed',
      createdAt: '2026-01-01T00:00:00.000Z',
    }], {
      taskId: 'task_1',
      sessionRef: 'session_1',
      verificationEvidence: [{
        toolCallId: 'call_passed',
        toolName: 'bash',
        exitCode: 0,
        completedAt: '2026-01-01T00:01:00.000Z',
      }],
    });

    expect(created[0]).toMatchObject({
      quality: 'high',
      verification: {
        sourceToolCallId: 'call_failed',
        successfulToolCallId: 'call_passed',
        exitCode: 0,
      },
    });
    expect(await mgr.getAll()).toHaveLength(1);
    expect(await mgr.getEphemeral()).toHaveLength(0);
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

    expect(await mgr.getAll()).toHaveLength(0);
    expect(await mgr.getEphemeral()).toHaveLength(1);
  });
});
