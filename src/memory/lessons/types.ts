import type { SignalKind, SignalSeverity } from '../signals/types.js';

export type LessonCandidateStatus = 'observed' | 'promoted' | 'archived';
export type LessonQuality = 'high' | 'low';
/** Same enum as knack distillation confidence after causal-pair admission. */
export type LessonConfidence = 'verified' | 'candidate';
export type LessonAuthoredBy = 'model' | 'template';
export type LessonAudit = 'anchored' | 'unanchored';

export interface LessonDocRef {
  library: string;
  topic: string;
}

export interface LessonEvidence {
  errorToolCallId: string;
  fixToolCallIds: string[];
  verificationToolCallId: string;
}

export interface LessonVerification {
  sourceToolCallId: string;
  successfulToolCallId: string;
  toolName: string;
  exitCode: 0;
  completedAt: string;
}

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
  quality: LessonQuality;
  /** Set when causal-pair admission succeeds; absent on quality:low ephemeral notes. */
  confidence?: LessonConfidence;
  /** Set when harness reward=1 promotes a candidate → verified. */
  promotedAt?: string;
  verification?: LessonVerification;
  /**
   * Fidelity fields for paired lessons (shared with knack schema-v1 ranking).
   * Absent on template-text ephemeral notes.
   */
  repo?: string;
  symptom?: string;
  fixSummary?: string;
  executionEvidence?: string;
  /** Root cause at subsystem + defect-class layer; no line numbers. */
  cause?: string;
  /** Fix method pattern. */
  fixPattern?: string;
  /** Error path vs correct path. */
  contrast?: string;
  /** Recall index only; never injected. */
  symptomKeys?: string[];
  docRefs?: LessonDocRef[];
  evidence?: LessonEvidence;
  /** Old jsonl without this field defaults to 'template' on read. */
  authoredBy?: LessonAuthoredBy;
  /** Old jsonl without this field defaults from quality on read. */
  audit?: LessonAudit;
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
