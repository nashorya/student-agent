import { describe, expect, it } from 'vitest';
import { buildChronicleModel, extractEntityIds, firstIsoDate } from '../chronicle-model.js';
import type { ArchiveProject } from '../types.js';

function project(values: Partial<ArchiveProject> = {}): ArchiveProject {
  return {
    root: '/project', title: 'Student Agent',
    indexPath: 'docs/INDEX.md', buglogPath: 'docs/buglog.md',
    adrDir: 'docs/adr', dashboardPath: 'docs/dashboard.html',
    timeline: [], adrs: [], bugs: [], evidence: [], sourceHashes: {},
    ...values,
  };
}

describe('chronicle model', () => {
  it('sorts by the first ISO date while preserving the visible range label', () => {
    const model = buildChronicleModel(project({ timeline: [
      { id: 'INDEX-2', date: '2026-07-14', title: 'Archive', summary: '', kind: 'change' },
      { id: 'INDEX-1', date: '2026-06-04 ~ 06', title: 'TUI', summary: '', kind: 'change' },
    ] }));
    expect(model.datedItems.map((item) => item.entityId)).toEqual(['INDEX-1', 'INDEX-2']);
    expect(model.datedItems[0]).toMatchObject({ dateLabel: '2026-06-04 ~ 06', sortDate: '2026-06-04' });
  });

  it('attaches a referenced ADR without creating a duplicate standalone item', () => {
    const model = buildChronicleModel(project({
      timeline: [{ id: 'INDEX-1', date: '2026-07-13', title: 'Ranking', summary: 'Implements ADR-005', kind: 'change' }],
      adrs: [{ id: 'ADR-005', title: 'Ranking protocol', date: '2026-07-13', decisionStatus: 'accepted', implementationStatus: 'verified', body: 'Body', sourcePath: 'docs/adr/ADR-005.md', history: [] }],
    }));
    expect(model.items.filter((item) => item.entityId === 'ADR-005')).toHaveLength(0);
    expect(model.items[0].relatedEntityIds).toContain('ADR-005');
    expect(model.entityRoutes['ADR-005']).toBe('#adr/ADR-005');
  });

  it('places a bug on the earliest exact BUG-ID reference', () => {
    const model = buildChronicleModel(project({
      timeline: [
        { id: 'INDEX-2', date: '2026-06-12', title: 'Closed BUG-007', summary: '', kind: 'change' },
        { id: 'INDEX-1', date: '2026-06-10', title: 'Found BUG-007', summary: '', kind: 'change' },
      ],
      bugs: [{ id: 'BUG-007', title: 'Probe credentials', status: 'CLOSED', symptom: 'Secret in history', evidence: [], history: [], sourcePath: 'docs/buglog.md' }],
    }));
    expect(model.datedItems[0].relatedEntityIds).toContain('BUG-007');
    expect(model.entityRoutes['BUG-007']).toBe('#bug/BUG-007');
  });

  it('places an unreferenced undated bug in the Undated group', () => {
    const model = buildChronicleModel(project({ bugs: [
      { id: 'BUG-011', title: 'Unknown date', status: 'OPEN', symptom: 'Symptom', evidence: [], history: [], sourcePath: 'docs/buglog.md' },
    ] }));
    expect(model.undatedItems).toHaveLength(1);
    expect(model.undatedItems[0]).toMatchObject({ entityId: 'BUG-011', dateLabel: 'Undated', route: '#bug/BUG-011' });
  });

  it('rejects partial identifier matches', () => {
    expect(extractEntityIds('ADR-005 ADR-0050 BUG-7 BUG-007')).toEqual(['ADR-005', 'BUG-007']);
  });

  it('extracts only a valid calendar date', () => {
    expect(firstIsoDate('2026-02-29 invalid')).toBeUndefined();
    expect(firstIsoDate('range 2026-06-04 ~ 06')).toBe('2026-06-04');
  });
});
