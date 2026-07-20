import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildInjectionMidtermReport } from '../injection-midterm.js';

describe('injection v0.2 midterm', () => {
  const roots: string[] = [];
  afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

  it('does not replace a family when only one arm resolves task 2 or 3', async () => {
    const root = await fixture({ 'A-L': [false, true, false] });
    const report = await buildInjectionMidtermReport({
      resultsDir: root, familyId: 'F-DJ-MIGRATION-REFERENCE', write: false,
    });
    expect(report.allFourArmsExtinct).toBe(false);
    expect(report.replacementFamily).toBeNull();
    expect(report.arms.find((arm) => arm.arm === 'A-L')?.resolvedTask23).toBe(1);
  });

  it('recommends the frozen backup only when all four arms are extinct', async () => {
    const root = await fixture({});
    const report = await buildInjectionMidtermReport({
      resultsDir: root, familyId: 'F-DJ-MIGRATION-REFERENCE', write: false,
    });
    expect(report.allFourArmsExtinct).toBe(true);
    expect(report.replacementFamily).toBe('F-DJ-SELECT-MASK');
  });

  it('fails closed when any arm is incomplete', async () => {
    const root = await fixture({});
    await writeFile(join(root, 'B', 'F-DJ-MIGRATION-REFERENCE', 'batch.json'), JSON.stringify({ runDirs: [] }));
    await expect(buildInjectionMidtermReport({
      resultsDir: root, familyId: 'F-DJ-MIGRATION-REFERENCE', write: false,
    })).rejects.toThrow('three completed runs');
  });

  async function fixture(overrides: Partial<Record<string, boolean[]>>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'injection-midterm-'));
    roots.push(root);
    for (const arm of ['A-L', 'A-K', 'B', 'C']) {
      const batchDir = join(root, arm, 'F-DJ-MIGRATION-REFERENCE');
      const runDirs = [1, 2, 3].map((index) => join(batchDir, String(index)));
      for (const [index, runDir] of runDirs.entries()) {
        await mkdir(runDir, { recursive: true });
        const resolved = overrides[arm]?.[index] ?? false;
        await writeFile(join(runDir, 'admission.json'), JSON.stringify({ admission: { resolved } }));
        await writeFile(join(runDir, 'trace.json'), JSON.stringify({
          tokenUsage: { totalTokens: index * 10 }, failureEscalationEvents: index === 1 ? [{}] : [],
          recallAudit: { used_recall_ids: arm.startsWith('A-') && index === 1 ? ['memory_1'] : [] },
        }));
      }
      await writeFile(join(batchDir, 'batch.json'), JSON.stringify({ runDirs }));
    }
    return root;
  }
});
