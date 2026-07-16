import type { AdrDecisionStatus, ArchiveEvidence, ArchiveProject, ArchiveValidationIssue, ArchiveValidationResult, BugStatus } from './types.js';

export function validateArchive(project: ArchiveProject): ArchiveValidationResult {
  const errors: ArchiveValidationIssue[] = [];
  const warnings: ArchiveValidationIssue[] = [];
  validateUniqueIds(project.adrs, 'adr', errors);
  validateUniqueIds(project.bugs, 'bug', errors);

  for (const adr of project.adrs) {
    if (adr.decisionStatus === 'accepted' && (adr.acceptance?.acceptedBy !== 'user' || !adr.acceptance.evidenceRef)) {
      const target = adr.legacyAcceptance ? warnings : errors;
      target.push(issue(adr.legacyAcceptance ? 'legacy_accepted_adr_without_user_evidence' : 'accepted_adr_without_user_evidence', adr.sourcePath, `${adr.id} is accepted without explicit user evidence`));
    }
  }
  for (const bug of project.bugs) {
    if (bug.status === 'FIXED' && !hasPassedVerification(bug.evidence)) {
      errors.push(issue('fixed_bug_without_verification', bug.sourcePath, `${bug.id} is FIXED without passed verification`));
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function validateAdrTransition(from: AdrDecisionStatus, to: AdrDecisionStatus, userEvidenceRef?: string): ArchiveValidationIssue[] {
  if (from === to) return [];
  if (from === 'accepted' && to === 'proposed') {
    return [issue('invalid_adr_transition', undefined, 'An accepted ADR cannot return to proposed')];
  }
  if (to === 'accepted' && !userEvidenceRef) {
    return [issue('accepted_adr_without_user_evidence', undefined, 'Accepting an ADR requires explicit user evidence')];
  }
  const allowed: Record<AdrDecisionStatus, AdrDecisionStatus[]> = {
    proposed: ['accepted', 'rejected', 'superseded'], accepted: ['superseded'], rejected: ['superseded'], superseded: [],
  };
  return allowed[from].includes(to) ? [] : [issue('invalid_adr_transition', undefined, `${from} cannot transition to ${to}`)];
}

export function validateBugTransition(from: BugStatus, to: BugStatus, evidence: ArchiveEvidence[]): ArchiveValidationIssue[] {
  if (from === to) return [];
  if (from === 'OPEN' && to === 'CLOSED') {
    return [issue('invalid_bug_transition', undefined, 'An OPEN bug must be verified FIXED before it can be CLOSED')];
  }
  if (to === 'FIXED' && !hasPassedVerification(evidence)) {
    return [issue('fixed_bug_without_verification', undefined, 'Marking a bug FIXED requires passed verification')];
  }
  const allowed: Partial<Record<BugStatus, BugStatus[]>> = {
    OPEN: ['INVESTIGATING', 'FIXED', 'WONTFIX', 'DUPLICATE', 'CANNOT_REPRODUCE'],
    INVESTIGATING: ['OPEN', 'FIXED', 'WONTFIX', 'DUPLICATE', 'CANNOT_REPRODUCE'],
    FIXED: ['CLOSED', 'REOPENED'], CLOSED: ['REOPENED'], REOPENED: ['INVESTIGATING', 'FIXED'],
  };
  return allowed[from]?.includes(to) ? [] : [issue('invalid_bug_transition', undefined, `${from} cannot transition to ${to}`)];
}

function validateUniqueIds(items: Array<{ id: string; sourcePath: string }>, kind: 'adr' | 'bug', errors: ArchiveValidationIssue[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) errors.push(issue(`duplicate_${kind}_id`, item.sourcePath, `Duplicate ${kind.toUpperCase()} ID: ${item.id}`));
    seen.add(item.id);
  }
}

function hasPassedVerification(evidence: ArchiveEvidence[]): boolean {
  return evidence.some((item) => item.kind === 'verification' && item.status === 'passed');
}

function issue(code: string, path: string | undefined, message: string): ArchiveValidationIssue {
  return { code, path, message };
}
