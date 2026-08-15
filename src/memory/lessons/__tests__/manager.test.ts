import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendSignal } from '../../signals/index.js';
import { LessonsManager, isProcessNoiseSignal, type ModelAuthoredLessonDraft } from '../manager.js';

const modelEvents = [
  { toolCallId: 'err_1', kind: 'tool_error', isError: true },
  { toolCallId: 'fix_1', kind: 'tool_call' },
  { toolCallId: 'verify_1', kind: 'tool_call', toolName: 'bash', exitCode: 0 },
];

function modelDraft(overrides: Partial<ModelAuthoredLessonDraft> = {}): ModelAuthoredLessonDraft {
  return {
    whatWentWrong: 'wrong path',
    rootCause: 'root cause of the defect',
    fixMethod: 'apply the correct fix pattern',
    contrast: 'wrong vs right',
    doNotApplyWhen: 'not this case',
    symptomKeys: ['matrix'],
    evidence: {
      errorToolCallId: 'err_1',
      fixToolCallIds: ['fix_1'],
      verificationToolCallId: 'verify_1',
    },
    taskId: 'task_1',
    sessionRef: 'run_1',
    ...overrides,
  };
}

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

    expect(created).toEqual([]);
    expect(await mgr.getAll()).toHaveLength(0);
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

    expect(created).toEqual([]);
    expect(await mgr.getAll()).toHaveLength(0);
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
    expect(created).toEqual([]);
    expect(await mgr.getAll()).toHaveLength(0);
    expect(await mgr.getEphemeral()).toHaveLength(0);
  });

  it('promotes candidate lessons to verified when harness reward=1', async () => {
    const mgr = LessonsManager.getInstance(tmpDir);
    await mgr.recordModelAuthoredLesson(modelDraft({ sessionRef: 'run_promo' }), modelEvents);
    expect((await mgr.getAll())[0].confidence).toBe('candidate');

    const result = await mgr.promoteCandidatesForRun({ sessionRef: 'run_promo', reward: 1 });
    expect(result.promoted).toBe(1);
    const lessons = await mgr.getAll();
    expect(lessons[0]).toMatchObject({
      confidence: 'verified',
    });
    expect(lessons[0].promotedAt).toBeTruthy();
  });

  it('stamps promotedAt on stream-verified lessons so harness-strong can fire', async () => {
    // A lesson born with in-run verification evidence is already `verified`, so
    // the old skip-if-not-candidate rule left promotedAt empty forever — and
    // harness-strong knack promotion needs verified AND promotedAt (BUG-015).
    const mgr = LessonsManager.getInstance(tmpDir);
    const born = await mgr.recordModelAuthoredLesson(
      modelDraft({ sessionRef: 'run_stream' }),
      modelEvents,
    );
    expect(born.confidence).toBe('candidate');
    expect(born.promotedAt).toBeUndefined();

    const result = await mgr.promoteCandidatesForRun({ sessionRef: 'run_stream', reward: 1 });

    expect(result.promoted).toBe(1);
    const lesson = (await mgr.getAll()).find((item) => item.id === born.id)!;
    expect(lesson.confidence).toBe('verified');
    expect(lesson.promotedAt).toBeTruthy();
  });

  it('does not re-stamp promotedAt for a run already promoted', async () => {
    const mgr = LessonsManager.getInstance(tmpDir);
    await mgr.recordModelAuthoredLesson(modelDraft({ sessionRef: 'run_idem' }), modelEvents);
    const first = await mgr.promoteCandidatesForRun({
      sessionRef: 'run_idem', reward: 1, promotedAt: '2026-01-01T00:02:00.000Z',
    });
    expect(first.promoted).toBe(1);

    const second = await mgr.promoteCandidatesForRun({
      sessionRef: 'run_idem', reward: 1, promotedAt: '2026-01-01T09:99:00.000Z',
    });

    expect(second.promoted).toBe(0);
    expect((await mgr.getAll()).find((l) => l.provenance.sessionRef === 'run_idem')!.promotedAt)
      .toBe('2026-01-01T00:02:00.000Z');
  });

  it('does not stamp promotedAt when harness reward≠1', async () => {
    const mgr = LessonsManager.getInstance(tmpDir);
    const born = await mgr.recordModelAuthoredLesson(
      modelDraft({ sessionRef: 'run_unresolved' }),
      modelEvents,
    );

    const result = await mgr.promoteCandidatesForRun({ sessionRef: 'run_unresolved', reward: 0 });

    expect(result.promoted).toBe(0);
    expect((await mgr.getAll()).find((item) => item.id === born.id)!.promotedAt).toBeUndefined();
  });

  it('does not promote candidates when harness reward≠1', async () => {
    const mgr = LessonsManager.getInstance(tmpDir);
    await mgr.recordModelAuthoredLesson(modelDraft({ sessionRef: 'run_fail' }), modelEvents);

    const result = await mgr.promoteCandidatesForRun({ sessionRef: 'run_fail', reward: 0 });
    expect(result.promoted).toBe(0);
    expect((await mgr.getAll())[0]).toMatchObject({
      confidence: 'candidate',
    });
    expect((await mgr.getAll())[0].promotedAt).toBeUndefined();
  });

  it('admits distilled products only when findCausalPair has verification', async () => {
    const mgr = LessonsManager.getInstance(tmpDir);
    const events = [
      { kind: 'tool_error', summary: 'matrix copy wrong', toolName: 'bash', isError: true },
      { kind: 'tool_call', toolName: 'edit', name: 'edit' },
      { kind: 'tool_call', toolName: 'bash', name: 'bash' },
    ];
    const rejected = await mgr.admitDistilled({
      events,
      lesson: 'Symptom: matrix Fix: assign copy',
      sourceSignalId: 'distill:test-no-verify',
      taskId: 'task_d',
      sessionRef: 'run_d',
    });
    expect(rejected).toBeNull();
    expect(await mgr.getAll()).toHaveLength(0);

    const admitted = await mgr.admitDistilled({
      events,
      verification: 'verifier reward=1',
      lesson: 'Symptom: matrix Fix: assign copy',
      sourceSignalId: 'distill:test-harness',
      taskId: 'task_d',
      sessionRef: 'run_d',
    });
    expect(admitted).toBeNull();
    expect(await mgr.getAll()).toHaveLength(0);
    expect(await mgr.getEphemeral()).toHaveLength(0);
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

    expect(created).toEqual([]);
    expect(await mgr.getAll()).toHaveLength(0);
    expect(await mgr.getEphemeral()).toHaveLength(0);
  });

  it('phrases paired lessons as Symptom/Fix from the issue text and patch', async () => {
    const mgr = LessonsManager.getInstance(tmpDir);
    const [lesson] = await mgr.observeSignals([{
      id: 'sig_fidelity',
      kind: 'tool_error',
      severity: 'medium',
      summary: 'AssertionError: separability matrix mismatch',
      toolName: 'bash',
      toolCallId: 'call_err',
      createdAt: '2026-01-01T00:00:00.000Z',
    }], {
      taskId: 'task_1',
      sessionRef: 'run_1',
      repo: 'astropy/astropy',
      taskDescription:
        'Instance: astropy__astropy-12907\nNested CompoundModel separability matrix fills `right` with 1 instead of the real values.',
      finalSummary:
        'The fix is to copy the actual matrix values into `cright` instead of filling with 1.',
      operationEvidence: [{
        toolName: 'edit',
        completedAt: '2026-01-01T00:01:00.000Z',
        summary:
          'astropy/modeling/separable.py copy the actual matrix values into cright instead of filling right with 1 for nested CompoundModel',
      }],
      verificationEvidence: [{
        toolCallId: 'call_pass',
        toolName: 'bash',
        exitCode: 0,
        completedAt: '2026-01-01T00:02:00.000Z',
      }],
    });

    expect(lesson).toBeUndefined();
    expect(await mgr.getAll()).toHaveLength(0);
    expect(await mgr.getEphemeral()).toHaveLength(0);
  });

  it('rejects test-report fix text and leaves fixSummary empty', async () => {
    const mgr = LessonsManager.getInstance(tmpDir);
    const [lesson] = await mgr.observeSignals([{
      id: 'sig_report',
      kind: 'tool_error',
      severity: 'medium',
      summary: 'AssertionError: dimensionless conversion mismatch',
      toolName: 'bash',
      toolCallId: 'call_err',
      createdAt: '2026-01-01T00:00:00.000Z',
    }], {
      taskId: 'task_1',
      sessionRef: 'run_1',
      finalSummary: 'Full sympy/units/tests/ suite: 70 passed, 1 xfailed.',
      operationEvidence: [{
        toolName: 'edit',
        completedAt: '2026-01-01T00:01:00.000Z',
        summary: 'sympy/physics/units/util.py call is_dimensionless before converting orthogonal units',
      }],
      verificationEvidence: [{
        toolCallId: 'call_pass',
        toolName: 'bash',
        exitCode: 0,
        completedAt: '2026-01-01T00:02:00.000Z',
      }],
    });

    expect(lesson).toBeUndefined();
    expect(await mgr.getAll()).toHaveLength(0);
    expect(await mgr.getEphemeral()).toHaveLength(0);
  });

  it('keeps template text for unpaired ephemeral notes', async () => {
    const mgr = LessonsManager.getInstance(tmpDir);
    const [lesson] = await mgr.observeSignals([{
      id: 'sig_unpaired',
      kind: 'hashline_rejection',
      severity: 'medium',
      summary: 'stale hashline anchor',
      toolName: 'edit',
      toolCallId: 'call_err',
      createdAt: '2026-01-01T00:00:00.000Z',
    }], { taskId: 'task_1', sessionRef: 'run_1' });

    expect(lesson).toBeUndefined();
    expect(await mgr.getAll()).toHaveLength(0);
    expect(await mgr.getEphemeral()).toHaveLength(0);
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

describe('isProcessNoiseSignal traceback classification', () => {
  const signal = (summary: string) => ({
    id: 'sig_x',
    kind: 'tool_error' as const,
    severity: 'medium' as const,
    summary,
    toolName: 'bash',
    toolCallId: 'call_x',
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  // A bare Python traceback is the highest-value signal on a Python repo
  // (astropy/sympy/django). Treating every traceback as process noise routed
  // those lessons to ephemeral, which the injection experiment never injects.
  it('does not treat a logic-error traceback as process noise', () => {
    expect(isProcessNoiseSignal(signal(
      'Traceback (most recent call last):\n  File "astropy/modeling/separable.py", line 310\n'
      + 'ValueError: separability matrix mismatch for nested CompoundModel',
    ))).toBe(false);
  });

  it('does not treat an assertion-failure traceback as process noise', () => {
    expect(isProcessNoiseSignal(signal(
      'Traceback (most recent call last):\n  File "test_separable.py", line 12\n'
      + 'AssertionError: expected [[True, False]] but got [[True, True]]',
    ))).toBe(false);
  });

  it('still treats an import-failure traceback as process noise', () => {
    expect(isProcessNoiseSignal(signal(
      'Traceback (most recent call last):\n  File "conftest.py", line 3\n'
      + "ModuleNotFoundError: No module named 'astropy._compiler'",
    ))).toBe(true);
  });

  it('keeps the existing non-traceback noise cases', () => {
    expect(isProcessNoiseSignal(signal('ImportError: cannot import name X'))).toBe(true);
    expect(isProcessNoiseSignal(signal('hashline mismatch on edit'))).toBe(true);
    expect(isProcessNoiseSignal(signal('sed: -e expression #1, char 0'))).toBe(true);
  });
});
