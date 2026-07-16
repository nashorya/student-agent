export type AdrDecisionStatus = 'proposed' | 'accepted' | 'rejected' | 'superseded';
export type AdrImplementationStatus = 'planned' | 'in_progress' | 'verified' | 'not_applicable';
export type BugStatus = 'OPEN' | 'INVESTIGATING' | 'FIXED' | 'CLOSED' | 'WONTFIX' | 'DUPLICATE' | 'CANNOT_REPRODUCE' | 'REOPENED';

export interface ArchiveConfig {
  enabled: boolean;
  format: 'auto' | 'canonical' | 'conventional';
  indexPath?: string;
  buglogPath?: string;
  adrDir?: string;
  dashboardPath?: string;
}

export interface ArchiveHistoryEntry {
  at: string;
  summary: string;
  evidenceRef?: string;
}

export interface ArchiveEvidence {
  id: string;
  kind: 'verification' | 'review' | 'reference';
  status: 'passed' | 'failed' | 'recorded';
  summary: string;
  sourcePath?: string;
}

export interface ArchiveAdr {
  id: string;
  title: string;
  decisionStatus: AdrDecisionStatus;
  implementationStatus: AdrImplementationStatus;
  date: string;
  body: string;
  sourcePath: string;
  acceptance?: { acceptedAt: string; acceptedBy: 'user'; evidenceRef: string };
  history: ArchiveHistoryEntry[];
  legacyAcceptance?: boolean;
}

export interface ArchiveBug {
  id: string;
  title: string;
  status: BugStatus;
  symptom: string;
  rootCause?: string;
  fix?: string;
  evidence: ArchiveEvidence[];
  history: ArchiveHistoryEntry[];
  sourcePath: string;
}

export interface ArchiveTimelineEntry {
  id: string;
  date: string;
  title: string;
  summary: string;
  kind: 'change' | 'adr' | 'bug' | 'verification';
  sourcePath?: string;
}

export interface ArchivePaths {
  indexPath: string;
  buglogPath: string;
  adrDir: string;
  dashboardPath: string;
}

export interface ArchiveProject {
  root: string;
  title?: string;
  indexPath: string;
  buglogPath: string;
  adrDir: string;
  dashboardPath: string;
  timeline: ArchiveTimelineEntry[];
  adrs: ArchiveAdr[];
  bugs: ArchiveBug[];
  evidence: ArchiveEvidence[];
  sourceHashes: Record<string, string>;
}

export interface ArchiveValidationIssue {
  code: string;
  path?: string;
  message: string;
}

export interface ArchiveValidationResult {
  ok: boolean;
  errors: ArchiveValidationIssue[];
  warnings: ArchiveValidationIssue[];
}
