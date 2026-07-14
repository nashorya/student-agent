import { describe, expect, it } from 'vitest';
import { validateArchive, validateAdrTransition, validateBugTransition } from '../validate.js';
import type { ArchiveAdr, ArchiveBug, ArchiveProject } from '../types.js';

const adr = (values: Partial<ArchiveAdr> = {}): ArchiveAdr => ({
  id: 'ADR-001', title: 'Choice', decisionStatus: 'proposed', implementationStatus: 'planned',
  date: '2026-07-14', body: 'Body', sourcePath: 'docs/adr/ADR-001.md', history: [], ...values,
});
const bug = (values: Partial<ArchiveBug> = {}): ArchiveBug => ({
  id: 'BUG-001', title: 'Issue', status: 'OPEN', symptom: 'Broken', evidence: [], history: [], sourcePath: 'docs/buglog.md', ...values,
});
const project = (values: Partial<ArchiveProject> = {}): ArchiveProject => ({
  root: '/project', indexPath: 'docs/INDEX.md', buglogPath: 'docs/buglog.md', adrDir: 'docs/adr',
  dashboardPath: 'docs/dashboard.html', timeline: [], adrs: [], bugs: [], evidence: [], sourceHashes: {}, ...values,
});

describe('archive validation', () => {
  it('rejects accepted ADRs without user acceptance evidence', () => {
    const result = validateArchive(project({ adrs: [adr({ decisionStatus: 'accepted' })] }));
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'accepted_adr_without_user_evidence' }));
  });

  it('rejects FIXED bugs without passed verification evidence', () => {
    const result = validateArchive(project({ bugs: [bug({ status: 'FIXED' })] }));
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'fixed_bug_without_verification' }));
  });

  it('rejects duplicate IDs across archive entities', () => {
    const result = validateArchive(project({ adrs: [adr(), adr({ title: 'Duplicate' })] }));
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'duplicate_adr_id' }));
  });

  it('enforces ADR decision transitions and user evidence', () => {
    expect(validateAdrTransition('accepted', 'proposed')).toContainEqual(expect.objectContaining({ code: 'invalid_adr_transition' }));
    expect(validateAdrTransition('proposed', 'accepted')).toContainEqual(expect.objectContaining({ code: 'accepted_adr_without_user_evidence' }));
    expect(validateAdrTransition('proposed', 'accepted', 'review:user:1')).toEqual([]);
  });

  it('rejects OPEN to CLOSED and allows verification-backed FIXED', () => {
    expect(validateBugTransition('OPEN', 'CLOSED', [])).toContainEqual(expect.objectContaining({ code: 'invalid_bug_transition' }));
    expect(validateBugTransition('OPEN', 'FIXED', [{ id: 'test', kind: 'verification', status: 'passed', summary: 'tests' }])).toEqual([]);
  });
});
