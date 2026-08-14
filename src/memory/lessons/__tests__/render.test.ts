import { describe, expect, it } from 'vitest';
import { lessonRecallIndexText, renderLessonInjection } from '../render.js';
import type { LessonCandidate } from '../types.js';

const TRACEBACK = [
  'Traceback (most recent call last):',
  '  File "astropy/modeling/separable.py", line 12, in _cright',
  'AssertionError: boom',
].join('\n');

const PLANTED_SYMPTOM_KEY = 'PLANTED_SYMPTOM_KEY';

function lesson(overrides: Partial<LessonCandidate> = {}): LessonCandidate {
  return {
    id: 'lesson_1',
    sourceSignalId: 'sig_1',
    lesson: '',
    trigger: { signalKinds: ['tool_error'], paths: [] },
    applicableWhen: [],
    doNotApplyWhen: [],
    evidenceRefs: [],
    severity: 'medium',
    quality: 'high',
    status: 'observed',
    provenance: { taskId: 't', sessionRef: 's', signalId: 'sig_1' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function modelAuthoredFixture(): LessonCandidate {
  return lesson({
    id: 'lesson_model',
    lesson: `Treat tool error as a retry pattern: ${TRACEBACK}`,
    cause: 'CompoundModel separability copies ones into the right block instead of the child matrix',
    fixPattern: 'Assign the actual right-hand separability matrix into cright',
    contrast: 'Fill-with-ones drops nested structure; copy preserves the child matrix',
    doNotApplyWhen: ['The right block is already a view that must stay shared'],
    symptomKeys: ['separability', 'CompoundModel', PLANTED_SYMPTOM_KEY],
    symptom: TRACEBACK,
    fixSummary: 'copy the child matrix',
    docRefs: [{ library: 'astropy', topic: 'modeling.separable' }],
  });
}

describe('renderLessonInjection', () => {
  it('renders cause/fix/docs from a model-authored lesson and omits planted symptoms', () => {
    const rendered = renderLessonInjection(modelAuthoredFixture());

    expect(rendered).toContain('Cause: CompoundModel separability copies ones into the right block instead of the child matrix');
    expect(rendered).toContain('Fix: Assign the actual right-hand separability matrix into cright');
    expect(rendered).toContain('Contrast: Fill-with-ones drops nested structure; copy preserves the child matrix');
    expect(rendered).toContain('Do not apply when: The right block is already a view that must stay shared');
    expect(rendered).toContain('Docs: astropy#modeling.separable');
    expect(rendered).not.toContain(TRACEBACK);
    expect(rendered).not.toContain('Treat tool error');
    expect(rendered).not.toContain('AssertionError');
    expect(rendered).not.toContain(PLANTED_SYMPTOM_KEY);
    expect(rendered).not.toContain('symptomKeys');
    expect(rendered).not.toContain('Symptom:');
  });

  it('does not inject a legacy template symptom dump', () => {
    const rendered = renderLessonInjection(lesson({
      id: 'lesson_legacy',
      lesson: 'Treat tool error as a retry pattern: AssertionError: boom',
    }));

    expect(rendered).toBe('');
    expect(rendered).not.toContain('AssertionError');
    expect(rendered).not.toContain('Treat tool error');
    expect(rendered).not.toContain('pattern omitted');
  });

  it('returns empty for legacy rows that only have a template boundary', () => {
    const rendered = renderLessonInjection(lesson({
      id: 'lesson_legacy_bound',
      lesson: 'Treat tool error as a retry pattern: AssertionError: boom',
      doNotApplyWhen: ['The triggering context is absent'],
    }));

    expect(rendered).toBe('');
    expect(rendered).not.toContain('The triggering context is absent');
    expect(rendered).not.toContain('Do not apply when');
  });
});

describe('lessonRecallIndexText', () => {
  it('keeps AssertionError and symptomKeys in the recall index', () => {
    const index = lessonRecallIndexText(lesson({
      lesson: 'Treat tool error as a retry pattern: AssertionError: boom',
      symptomKeys: [PLANTED_SYMPTOM_KEY, 'AssertionError'],
      symptom: 'AssertionError: boom',
    }));

    expect(index).toContain('AssertionError');
    expect(index).toContain(PLANTED_SYMPTOM_KEY);
    expect(index).toContain('Treat tool error as a retry pattern');
  });

  it('indexes cause/fix plus the legacy body of a model-authored lesson', () => {
    const index = lessonRecallIndexText(modelAuthoredFixture());

    expect(index).toContain('CompoundModel');
    expect(index).toContain('Assign the actual right-hand separability matrix');
    expect(index).toContain(PLANTED_SYMPTOM_KEY);
    expect(index).toContain('AssertionError');
    expect(index).toContain(TRACEBACK);
  });
});
