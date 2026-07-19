import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendSignal } from '../../signals/index.js';
import { LessonsManager } from '../manager.js';

describe('LessonsManager delayed promotion admission (P1 patch)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'lessons-test-'));
  });

  afterEach(async () => {
    LessonsManager.resetInstance();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('streams exit-0 evidence into lessons/ as verified', async () => {
    const mgr = LessonsManager.getInstance(tmpDir);
    const created = await mgr.observeSignals([{
      id: 'sig_stream',
      kind: 'tool_error',
      severity: 'medium',
      summary: 'targeted test failed',
      toolName: 'bash',
      toolCallId: 'call_failed',
      createdAt: '2026-01-01T00:00:00.000Z',
    }], {
      taskId: 'task_1',
      sessionRef: 'run_1',
      verificationEvidence: [{
        toolCallId: 'call_passed',
        toolName: 'bash',
        exitCode: 0,
        completedAt: '2026-01-01T00:01:00.000Z',
      }],
    });

    expect(created[0]).toMatchObject({
      quality: 'high',
      confidence: 'verified',
      verification: {
        sourceToolCallId: 'call_failed',
        successfulToolCallId: 'call_passed',
        exitCode: 0,
      },
    });
    expect(await mgr.getAll()).toHaveLength(1);
    expect(await mgr.getEphemeral()).toHaveLength(0);
  });

  it('admits provisional pairs without stream verify as candidate for non-noise errors', async () => {
    const mgr = LessonsManager.getInstance(tmpDir);
    const created = await mgr.observeSignals([{
      id: 'sig_provisional',
      kind: 'tool_error',
      severity: 'medium',
      summary: 'assertion failed: expected matrix copy',
      toolName: 'bash',
      toolCallId: 'call_err',
      createdAt: '2026-01-01T00:00:00.000Z',
    }], {
      taskId: 'task_1',
      sessionRef: 'run_1',
      // recovery tools only — no exit-0 verification
      operationEvidence: [{
        toolName: 'read',
        completedAt: '2026-01-01T00:00:30.000Z',
      }, {
        toolName: 'edit',
        completedAt: '2026-01-01T00:01:00.000Z',
      }],
    });

    expect(created[0]).toMatchObject({
      quality: 'high',
      confidence: 'candidate',
    });
    expect(await mgr.getAll()).toHaveLength(1);
    expect(await mgr.getEphemeral()).toHaveLength(0);
  });

  it('keeps process-noise tool_errors ephemeral even with recovery ops', async () => {
    const mgr = LessonsManager.getInstance(tmpDir);
    const created = await mgr.observeSignals([{
      id: 'sig_hashline_noise',
      kind: 'tool_error',
      severity: 'medium',
      summary: 'Hashline: file has changed since last read',
      toolName: 'edit',
      toolCallId: 'call_err',
      createdAt: '2026-01-01T00:00:00.000Z',
    }], {
      taskId: 'task_1',
      sessionRef: 'run_1',
      operationEvidence: [{ toolName: 'read', completedAt: '2026-01-01T00:01:00.000Z' }],
    });
    expect(created[0].quality).toBe('low');
    expect(await mgr.getAll()).toHaveLength(0);
    expect(await mgr.getEphemeral()).toHaveLength(1);
  });

  it('promotes candidate lessons to verified when harness reward=1', async () => {
    const mgr = LessonsManager.getInstance(tmpDir);
    await mgr.observeSignals([{
      id: 'sig_promo',
      kind: 'tool_error',
      severity: 'medium',
      summary: 'matrix shape mismatch on compound model',
      toolName: 'bash',
      toolCallId: 'call_err',
      createdAt: '2026-01-01T00:00:00.000Z',
    }], {
      taskId: 'task_1',
      sessionRef: 'run_promo',
      operationEvidence: [{ toolName: 'bash', completedAt: '2026-01-01T00:01:00.000Z' }],
    });
    expect((await mgr.getAll())[0].confidence).toBe('candidate');

    const result = await mgr.promoteCandidatesForRun({ sessionRef: 'run_promo', reward: 1 });
    expect(result.promoted).toBe(1);
    const lessons = await mgr.getAll();
    expect(lessons[0]).toMatchObject({
      confidence: 'verified',
    });
    expect(lessons[0].promotedAt).toBeTruthy();
  });

  it('does not promote candidates when harness reward≠1', async () => {
    const mgr = LessonsManager.getInstance(tmpDir);
    await mgr.observeSignals([{
      id: 'sig_keep',
      kind: 'tool_error',
      severity: 'medium',
      summary: 'separability matrix filled with ones',
      toolName: 'bash',
      toolCallId: 'call_err',
      createdAt: '2026-01-01T00:00:00.000Z',
    }], {
      taskId: 'task_1',
      sessionRef: 'run_fail',
      operationEvidence: [{ toolName: 'edit', completedAt: '2026-01-01T00:01:00.000Z' }],
    });

    const result = await mgr.promoteCandidatesForRun({ sessionRef: 'run_fail', reward: 0 });
    expect(result.promoted).toBe(0);
    expect((await mgr.getAll())[0]).toMatchObject({
      confidence: 'candidate',
    });
    expect((await mgr.getAll())[0].promotedAt).toBeUndefined();
  });

  it('routes unpaired process noise to ephemeral', async () => {
    await appendSignal({
      id: 'sig_noise',
      kind: 'tool_error',
      severity: 'medium',
      summary: 'pytest failed before any recovery',
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

    expect(created[0]).toMatchObject({
      quality: 'low',
      status: 'observed',
    });
    expect(created[0].confidence).toBeUndefined();
    expect(await mgr.getAll()).toHaveLength(0);
    expect(await mgr.getEphemeral()).toHaveLength(1);
  });

  it('writes nothing for an empty trajectory', async () => {
    const mgr = LessonsManager.getInstance(tmpDir);
    expect(await mgr.observeSignals([], {
      taskId: 'task_empty',
      sessionRef: 'session_empty',
    })).toEqual([]);
    expect(await mgr.getAll()).toHaveLength(0);
    expect(await mgr.getEphemeral()).toHaveLength(0);
  });
});
