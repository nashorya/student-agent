export {
  LessonsManager,
  type LessonOperationEvidence,
  type LessonVerificationEvidence,
  type ModelAuthoredLessonDraft,
  type ObserveRecentSignalsOptions,
} from './manager.js';
export {
  WRITE_LESSON_AEVO_GUIDELINE,
  WRITE_LESSON_INSTRUCTION,
  buildWriteLessonPromptSuffix,
} from './write-lesson-instruction.js';
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
