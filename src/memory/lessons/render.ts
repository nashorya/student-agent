import type { LessonCandidate, LessonDocRef } from './types.js';

/**
 * Prompt-facing lesson body. Symptoms stay in the recall index only.
 * per GEP-Gene-2604.15097
 */
export function renderLessonInjection(lesson: LessonCandidate): string {
  const cause = trimText(lesson.cause);
  const fixPattern = trimText(lesson.fixPattern);
  if (!cause && !fixPattern) return '';

  const lines: string[] = [];
  if (cause) lines.push(`Cause: ${cause}`);
  if (fixPattern) lines.push(`Fix: ${fixPattern}`);
  const contrast = trimText(lesson.contrast);
  if (contrast) lines.push(`Contrast: ${contrast}`);
  const boundary = joinDoNotApplyWhen(lesson.doNotApplyWhen);
  if (boundary) lines.push(`Do not apply when: ${boundary}`);
  for (const pointer of renderDocRefPointers(lesson.docRefs)) {
    lines.push(pointer);
  }
  return lines.join('\n');
}

/** Index-only text for keyword scoring. Never used as the injected summary. */
export function lessonRecallIndexText(lesson: LessonCandidate): string {
  return [
    lesson.cause,
    lesson.fixPattern,
    lesson.contrast,
    ...(lesson.symptomKeys ?? []),
    lesson.symptom,
    lesson.fixSummary,
    lesson.lesson,
  ].filter((part): part is string => Boolean(trimText(part))).join(' ');
}

export function isLessonLikePayload(payload: unknown): payload is LessonCandidate {
  if (!payload || typeof payload !== 'object') return false;
  const value = payload as Record<string, unknown>;
  return typeof value.lesson === 'string'
    || typeof value.cause === 'string'
    || typeof value.fixPattern === 'string'
    || Array.isArray(value.symptomKeys);
}

function renderDocRefPointers(docRefs: LessonDocRef[] | undefined): string[] {
  if (!docRefs) return [];
  return docRefs.flatMap((ref) => {
    const library = trimText(ref.library);
    const topic = trimText(ref.topic);
    if (!library || !topic) return [];
    return [`Docs: ${library}#${topic}`];
  });
}

function joinDoNotApplyWhen(values: string[] | undefined): string {
  return (values ?? []).map((value) => trimText(value)).filter(Boolean).join('; ');
}

function trimText(value: string | undefined): string {
  return value?.trim() ?? '';
}
