import type { CandidateBreakerReport } from '../candidates/types.js';
import type {
  LessonCounterexample,
  LessonTrigger,
} from '../lessons/types.js';
import type { RecallMetadata, RecallTrigger } from '../recall/types.js';

export type KnackStatus = 'candidate' | 'validated' | 'deprecated';

export interface KnackRecallMetadata extends RecallMetadata {
  trigger: RecallTrigger & LessonTrigger;
}

export interface Knack {
  id: string;
  lessonCandidateId: string;
  status: KnackStatus;
  summary: string;
  trigger: LessonTrigger;
  recall: KnackRecallMetadata;
  evidenceRefs: string[];
  counterexamples: LessonCounterexample[];
  allowPromptInjection: boolean;
  writesHardToolRule: false;
  breakerReport: CandidateBreakerReport | null;
  repo?: string;
  symptom?: string;
  fixSummary?: string;
  reuseCount?: number;
  injectedCount?: number;
  lastSucceededTask?: string | null;
  lastInjectedTask?: string | null;
  creditedUseKeys?: string[];
  createdAt: string;
  updatedAt: string;
}
