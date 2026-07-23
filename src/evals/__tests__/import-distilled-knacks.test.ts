import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { importDistilledKnacks } from '../../../scripts/import-distilled-knacks.js';

describe('importDistilledKnacks', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('preserves ranking fields and upserts an existing schema entry without losing runtime counters', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'knack-import-'));
    dirs.push(dir);
    const sourcePath = join(dir, 'candidate-knacks.json');
    const targetPath = join(dir, 'knacks.jsonl');
    await writeFile(sourcePath, JSON.stringify([{
      id: 'knack-astropy-6938',
      dedup_key: 'astropy:6938',
      repo: 'astropy/astropy',
      symptom: 'replace result is discarded',
      fix_summary: 'assign the result back',
      evidence_task: 'astropy__astropy-6938',
      confidence: 'verified',
      reuse_count: 1,
      injected_count: 2,
      last_succeeded_task: 'task_old',
      last_injected_task: 'task_old',
    }]), 'utf8');
    await writeFile(targetPath, `${JSON.stringify({
      id: 'knack-astropy-6938',
      lessonCandidateId: 'old',
      status: 'candidate',
      summary: 'old summary',
      trigger: {},
      recall: { trigger: {}, applicableWhen: [], doNotApplyWhen: [] },
      evidenceRefs: [],
      counterexamples: [],
      allowPromptInjection: true,
      writesHardToolRule: false,
      breakerReport: null,
      reuseCount: 7,
      injectedCount: 9,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    })}\n`, 'utf8');

    const outcome = await importDistilledKnacks({
      sourcePath,
      targetPath,
      now: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(outcome).toEqual({ imported: 0, updated: 1, unchanged: 0 });
    const lines = (await readFile(targetPath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      repo: 'astropy/astropy',
      symptom: 'replace result is discarded',
      fixSummary: 'assign the result back',
      reuseCount: 7,
      injectedCount: 9,
      lastSucceededTask: 'task_old',
      lastInjectedTask: 'task_old',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('imports optional v3 verification/execution_evidence without error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'knack-import-v3-'));
    dirs.push(dir);
    const sourcePath = join(dir, 'candidate-knacks.json');
    const targetPath = join(dir, 'knacks.jsonl');
    await writeFile(sourcePath, JSON.stringify([{
      id: 'knack-sympy-24066',
      dedup_key: 'sympy:24066',
      repo: 'sympy/sympy',
      symptom: 'exponent dimension check',
      fix_summary: 'call is_dimensionless()',
      evidence_task: 'sympy__sympy-24066',
      confidence: 'verified',
      verification: 'verifier reward=1; 70 passed, 1 failed/xfailed',
      execution_evidence: 'edit unitsystem.py is_dimensionless(dim)',
    }, {
      id: 'knack-legacy-empty-v3',
      dedup_key: 'astropy:legacy',
      repo: 'astropy/astropy',
      symptom: 'legacy row',
      fix_summary: 'assign replace back',
      evidence_task: 'astropy__astropy-6938',
      confidence: 'verified',
    }]), 'utf8');

    const outcome = await importDistilledKnacks({
      sourcePath,
      targetPath,
      now: new Date('2026-07-23T00:00:00.000Z'),
    });
    expect(outcome.imported).toBe(2);
    const rows = (await readFile(targetPath, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(rows.find((r) => r.id === 'knack-sympy-24066')).toMatchObject({
      verification: 'verifier reward=1; 70 passed, 1 failed/xfailed',
      executionEvidence: 'edit unitsystem.py is_dimensionless(dim)',
      fixSummary: 'call is_dimensionless()',
    });
    expect(rows.find((r) => r.id === 'knack-legacy-empty-v3')).toMatchObject({
      fixSummary: 'assign replace back',
    });
    expect(rows.find((r) => r.id === 'knack-legacy-empty-v3').verification).toBeUndefined();
  });
});
