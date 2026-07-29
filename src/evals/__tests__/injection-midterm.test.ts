import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildInjectionFamilyReadout, buildInjectionReadout } from '../injection-midterm.js';

const FAMILY = 'F-DJ-MIGRATION-REFERENCE';

describe('injection v0.4 readout', () => {
  const roots: string[] = [];
  afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

  it('marks a family unusable when its seed is unresolved and never demands arm runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'injection-readout-'));
    roots.push(root);
    await seed(root, FAMILY, false);

    const report = await buildInjectionFamilyReadout({ resultsDir: root, familyId: FAMILY, write: false });

    expect(report.seedResolved).toBe(false);
    expect(report.usable).toBe(false);
    expect(report.arms).toBeNull();
    expect(report.unusableReason).toBe('seed_unresolved_no_injection_contrast');
  });

  it('reads task 2 as the primary paired comparison and keeps task 3 separate', async () => {
    const root = await fixture({ 'A-L': [true, false], 'A-K': [false, false], B: [false, true] });

    const report = await buildInjectionFamilyReadout({ resultsDir: root, familyId: FAMILY, write: false });

    expect(report.usable).toBe(true);
    const al = report.arms!.find((arm) => arm.arm === 'A-L')!;
    expect(al.task2.resolved).toBe(true);
    expect(al.task3.resolved).toBe(false);
    expect(report.primary).toEqual({ arm: 'A-L', comparator: 'B', outcome: 'arm_only' });
    expect(report.secondary).toEqual({ arm: 'A-K', comparator: 'B', outcome: 'tie_unresolved' });
  });

  it('always reports the composite descriptors alongside the binary outcome', async () => {
    const root = await fixture({ 'A-L': [true, false] });

    const report = await buildInjectionFamilyReadout({ resultsDir: root, familyId: FAMILY, write: false });

    const al = report.arms!.find((arm) => arm.arm === 'A-L')!;
    expect(al.task2.totalTokens).toBe(100);
    expect(al.task2.escalationTriggers).toBe(1);
    expect(al.task2.usedRecall).toBe(true);
    expect(al.task3.totalTokens).toBe(200);
  });

  it('aggregates sign counts over usable families only', async () => {
    const root = await fixture({ 'A-L': [true, false], B: [false, false] });
    await seed(root, 'F-SY-UNIT-EQUIVALENCE', false);
    await seed(root, 'F-DJ-SELECT-MASK', false);

    const report = await buildInjectionReadout({
      resultsDir: root,
      familyIds: [FAMILY, 'F-SY-UNIT-EQUIVALENCE', 'F-DJ-SELECT-MASK'],
      write: false,
    });

    expect(report.usableFamilies).toBe(1);
    expect(report.unusableFamilies).toBe(2);
    expect(report.primarySignCount).toEqual({ armOnly: 1, comparatorOnly: 0, tieResolved: 0, tieUnresolved: 0 });
    expect(report.statisticalClaim).toBe('none');
  });

  it('fails closed when a usable family has an incomplete arm', async () => {
    const root = await fixture({});
    await writeFile(join(root, 'B', FAMILY, 'batch.json'), JSON.stringify({ runDirs: [] }));

    await expect(buildInjectionFamilyReadout({ resultsDir: root, familyId: FAMILY, write: false }))
      .rejects.toThrow('two completed arm runs');
  });

  async function seed(root: string, familyId: string, resolved: boolean): Promise<void> {
    const seedDir = join(root, 'seed', familyId);
    await mkdir(seedDir, { recursive: true });
    await writeFile(join(seedDir, 'batch.json'), JSON.stringify({ phase: 'seed', familyId, resolved }));
  }

  async function fixture(overrides: Partial<Record<string, boolean[]>>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'injection-readout-'));
    roots.push(root);
    await seed(root, FAMILY, true);
    for (const arm of ['A-L', 'A-K', 'B']) {
      const batchDir = join(root, arm, FAMILY);
      // Task 2 and task 3 only — the seed task is shared and lives outside the arm batch.
      const runDirs = [2, 3].map((task) => join(batchDir, String(task)));
      for (const [index, runDir] of runDirs.entries()) {
        await mkdir(runDir, { recursive: true });
        await writeFile(join(runDir, 'admission.json'), JSON.stringify({
          admission: { resolved: overrides[arm]?.[index] ?? false },
        }));
        await writeFile(join(runDir, 'trace.json'), JSON.stringify({
          tokenUsage: { totalTokens: (index + 1) * 100 },
          failureEscalationEvents: index === 0 ? [{}] : [],
          recallAudit: { used_recall_ids: arm.startsWith('A-') && index === 0 ? ['memory_1'] : [] },
        }));
      }
      await writeFile(join(batchDir, 'batch.json'), JSON.stringify({ runDirs }));
    }
    return root;
  }
});
