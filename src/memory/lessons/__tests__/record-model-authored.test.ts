import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LessonsManager, type ModelAuthoredLessonDraft } from '../manager.js';

const TRACEBACK = [
  'Traceback (most recent call last):',
  '  File "astropy/modeling/separable.py", line 12, in _cright',
  'AssertionError: expected copied matrix values, got ones',
].join('\n');

function draft(overrides: Partial<ModelAuthoredLessonDraft> = {}): ModelAuthoredLessonDraft {
  return {
    whatWentWrong: TRACEBACK,
    rootCause: 'CompoundModel separability copies ones into the right block instead of the child matrix',
    fixMethod: 'Assign the actual right-hand separability matrix into cright',
    contrast: 'Fill-with-ones drops nested structure; copy preserves the child matrix',
    doNotApplyWhen: 'The right block is already a view that must stay shared',
    symptomKeys: ['separability', 'CompoundModel', 'cright'],
    evidence: {
      errorToolCallId: 'err_1',
      fixToolCallIds: ['fix_1'],
      verificationToolCallId: 'verify_1',
    },
    docRefs: [{ library: 'astropy', topic: 'modeling.separable' }],
    taskId: 'task_model',
    sessionRef: 'run_model',
    repo: 'astropy/astropy',
    ...overrides,
  };
}

const anchoredEvents = [
  { toolCallId: 'err_1', kind: 'tool_error', isError: true, summary: TRACEBACK },
  { toolCallId: 'fix_1', kind: 'tool_call', name: 'edit' },
  { toolCallId: 'verify_1', kind: 'tool_call', toolName: 'bash', exitCode: 0 },
];

describe('recordModelAuthoredLesson', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'lessons-model-'));
  });

  afterEach(async () => {
    LessonsManager.resetInstance();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes an anchored cited triple to the main library as a model candidate', async () => {
    const mgr = LessonsManager.getInstance(tmpDir);
    const created = await mgr.recordModelAuthoredLesson(draft(), anchoredEvents);

    expect(created).toMatchObject({
      confidence: 'candidate',
      status: 'observed',
      authoredBy: 'model',
      audit: 'anchored',
      quality: 'high',
      severity: 'medium',
      cause: 'CompoundModel separability copies ones into the right block instead of the child matrix',
      fixPattern: 'Assign the actual right-hand separability matrix into cright',
      contrast: 'Fill-with-ones drops nested structure; copy preserves the child matrix',
      symptomKeys: ['separability', 'CompoundModel', 'cright'],
      docRefs: [{ library: 'astropy', topic: 'modeling.separable' }],
      evidence: {
        errorToolCallId: 'err_1',
        fixToolCallIds: ['fix_1'],
        verificationToolCallId: 'verify_1',
      },
      sourceSignalId: 'model:err_1',
      doNotApplyWhen: ['The right block is already a view that must stay shared'],
      applicableWhen: ['CompoundModel separability copies ones into the right block instead of the child matrix'],
      trigger: { signalKinds: ['tool_error'], paths: [] },
      repo: 'astropy/astropy',
    });
    expect(created.lesson).toContain('Cause:');
    expect(created.lesson).toContain('Fix:');
    expect(created.lesson).not.toContain('Traceback');
    expect(created.lesson).not.toContain(TRACEBACK);

    expect(await mgr.getAll()).toHaveLength(1);
    expect(await mgr.getEphemeral()).toHaveLength(0);
    expect((await mgr.getAll())[0].id).toBe(created.id);
  });

  it('isolates a missing cited toolCallId as unanchored ephemeral', async () => {
    const mgr = LessonsManager.getInstance(tmpDir);
    const created = await mgr.recordModelAuthoredLesson(
      draft({
        evidence: {
          errorToolCallId: 'missing_err',
          fixToolCallIds: ['fix_1'],
          verificationToolCallId: 'verify_1',
        },
      }),
      anchoredEvents,
    );

    expect(created).toMatchObject({
      authoredBy: 'model',
      audit: 'unanchored',
      quality: 'low',
      confidence: 'candidate',
      sourceSignalId: 'model:missing_err',
    });
    expect(await mgr.getAll()).toHaveLength(0);
    const ephemeral = await mgr.getEphemeral();
    expect(ephemeral).toHaveLength(1);
    expect(ephemeral[0].id).toBe(created.id);
  });

  it('isolates a non-green verification citation as unanchored ephemeral', async () => {
    const mgr = LessonsManager.getInstance(tmpDir);
    const created = await mgr.recordModelAuthoredLesson(draft(), [
      { toolCallId: 'err_1', kind: 'tool_error', isError: true },
      { toolCallId: 'fix_1', kind: 'tool_call' },
      { toolCallId: 'verify_1', kind: 'tool_call', exitCode: 1 },
    ]);

    expect(created.audit).toBe('unanchored');
    expect(created.quality).toBe('low');
    expect(created.confidence).toBe('candidate');
    expect(await mgr.getAll()).toHaveLength(0);
    expect(await mgr.getEphemeral()).toHaveLength(1);
  });

  it('keeps isolated ephemeral entries out of getAll() (recall candidate pool)', async () => {
    const mgr = LessonsManager.getInstance(tmpDir);
    await mgr.recordModelAuthoredLesson(
      draft({ evidence: { ...draft().evidence, errorToolCallId: 'ghost' } }),
      anchoredEvents,
    );
    await mgr.recordModelAuthoredLesson(
      draft({
        sessionRef: 'run_model_2',
        evidence: { ...draft().evidence, verificationToolCallId: 'not_green' },
      }),
      [
        { toolCallId: 'err_1', kind: 'tool_error', isError: true },
        { toolCallId: 'fix_1', kind: 'tool_call' },
        { toolCallId: 'not_green', exitCode: 1 },
      ],
    );

    expect(await mgr.getAll()).toEqual([]);
    expect(await mgr.getEphemeral()).toHaveLength(2);
  });

  it('defaults authoredBy/audit when reading old template jsonl without new fields', async () => {
    const oldHigh = {
      id: 'lesson_old_high',
      sourceSignalId: 'sig_old_high',
      lesson: 'Treat tool error as a retry pattern: boom',
      trigger: { signalKinds: ['tool_error'], paths: [] },
      applicableWhen: ['Using bash'],
      doNotApplyWhen: ['The triggering context is absent'],
      evidenceRefs: ['sig_old_high'],
      severity: 'medium',
      quality: 'high',
      confidence: 'verified',
      status: 'observed',
      provenance: { taskId: 't', sessionRef: 's', signalId: 'sig_old_high' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const oldLow = {
      ...oldHigh,
      id: 'lesson_old_low',
      sourceSignalId: 'sig_old_low',
      quality: 'low',
      confidence: undefined,
      provenance: { taskId: 't', sessionRef: 's', signalId: 'sig_old_low' },
    };
    delete (oldLow as { confidence?: unknown }).confidence;

    await writeFile(join(tmpDir, 'lessons.jsonl'), `${JSON.stringify(oldHigh)}\n`);
    await mkdir(join(tmpDir, 'ephemeral'), { recursive: true });
    await writeFile(join(tmpDir, 'ephemeral', 'lessons.jsonl'), `${JSON.stringify(oldLow)}\n`);

    const mgr = LessonsManager.getInstance(tmpDir);
    const [main] = await mgr.getAll();
    const [ephemeral] = await mgr.getEphemeral();

    expect(main.authoredBy).toBe('template');
    expect(main.audit).toBe('anchored');
    expect(ephemeral.authoredBy).toBe('template');
    expect(ephemeral.audit).toBe('unanchored');
  });

  it('keeps template observeSignals authoredBy=template and streamVerified→verified', async () => {
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
      authoredBy: 'template',
      audit: 'anchored',
      quality: 'high',
      confidence: 'verified',
    });
    expect(await mgr.getAll()).toHaveLength(1);
    expect(await mgr.getEphemeral()).toHaveLength(0);
  });
});
