export {
  LessonsManager,
  hydrateLesson,
  type LessonOperationEvidence,
  type LessonVerificationEvidence,
  type ModelAuthoredLessonDraft,
  type ObserveRecentSignalsOptions,
} from './manager.js';
export {
  WRITE_LESSON_AEVO_GUIDELINE,
  WRITE_LESSON_HARVEST_PROMPT,
  WRITE_LESSON_INSTRUCTION,
  buildWriteLessonPromptSuffix,
  formatWriteLessonArcReminder,
  formatWriteLessonHarvestPrompt,
  shouldHarvestWriteLessons,
} from './write-lesson-instruction.js';
export {
  isLessonLikePayload,
  lessonRecallIndexText,
  renderLessonInjection,
} from './render.js';
export type {
  LessonAudit,
  LessonAuthoredBy,
  LessonCandidate,
  LessonCandidateStatus,
  LessonConfidence,
  LessonCounterexample,
  LessonDocRef,
  LessonEvidence,
  LessonQuality,
  LessonTrigger,
  LessonVerification,
} from './types.js';
