import type { SignalKind, SignalSeverity } from '../signals/types.js';

export type LessonCandidateStatus = 'observed' | 'promoted' | 'archived';

export interface LessonTrigger {
  signalKinds: SignalKind[];
  paths: string[];
  toolNames?: string[];
  ruleNames?: string[];
}

export interface LessonCounterexample {
  id: string;
  severity: SignalSeverity;
  summary: string;
  evidenceRef?: string;
  createdAt: string;
}

export interface LessonCandidate {
  id: string;
  sourceSignalId: string;
  lesson: string;
  trigger: LessonTrigger;
  applicableWhen: string[];
  doNotApplyWhen: string[];
  evidenceRefs: string[];
  severity: SignalSeverity;
  status: LessonCandidateStatus;
  counterexamples?: LessonCounterexample[];
  provenance: {
    taskId: string;
    sessionRef: string;
    signalId: string;
  };
  createdAt: string;
  updatedAt: string;
}
