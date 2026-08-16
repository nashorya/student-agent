import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  buildRetryQueue,
  buildScanResult,
  estimateScanRuns,
  isReusablePatch,
  latestNonVoidedRow,
  loadReusableRun,
  normalizeScanResult,
  officialVerdictIds,
  parseLiteIdsFromBlob,
  parsePredictionRecord,
  parseScreeningTableInstances,
  proposeFamiliesFromFailures,
} from '../b-arm-scan.js';
import { readInjectionSpec } from '../injection-family-runner.js';

describe('B-arm scan pool', () => {
  it('lists screening-table django/sympy instances and estimates one B-arm run each', async () => {
    const markdown = await readFile(
      resolve('docs/proposals/injection-effect-task-families.md'),
      'utf8',
    );
    const pool = parseScreeningTableInstances(markdown);
    const django = pool.filter((item) => item.repo === 'django');
    const sympy = pool.filter((item) => item.repo === 'sympy');
    expect(django.length).toBeGreaterThanOrEqual(9);
    expect(sympy.length).toBeGreaterThanOrEqual(6);
    expect(estimateScanRuns(pool)).toEqual({
      repos: { django: django.length, sympy: sympy.length },
      estimatedRuns: pool.length,
    });
  });

  it('extracts lite ids from a raw blob', () => {
    const pool = parseLiteIdsFromBlob('xx django__django-12125 yy sympy__sympy-20442 django__django-12125');
    expect(pool.map((item) => item.instance_id)).toEqual([
      'django__django-12125',
      'sympy__sympy-20442',
    ]);
  });

  it('extracts the Lite django+sympy pool from the pinned arrow when cached', async () => {
    const arrow = join(
      homedir(),
      '.cache/huggingface/datasets/SWE-bench___swe-bench_lite/default/0.0.0',
      '69611d31007e1c6731db8bd5b5c3f2d33f5bab6e',
      'swe-bench_lite-test.arrow',
    );
    let blob: Buffer;
    try {
      blob = await readFile(arrow);
    } catch {
      return;
    }
    const pool = parseLiteIdsFromBlob(blob);
    expect(pool.filter((item) => item.repo === 'django').length).toBe(114);
    expect(pool.filter((item) => item.repo === 'sympy').length).toBe(77);
  });

  it('proposes families with >=3 instances and >=2 current-stack failures', () => {
    const drafts = proposeFamiliesFromFailures([
      { instance_id: 'a', verdict: 'unresolved', familyHint: 'F-X' },
      { instance_id: 'b', verdict: 'unresolved', familyHint: 'F-X' },
      { instance_id: 'c', verdict: 'resolved', familyHint: 'F-X' },
      { instance_id: 'd', verdict: 'unresolved', familyHint: 'F-Y' },
    ]);
    expect(drafts).toEqual([
      { familyId: 'F-X', instanceIds: ['a', 'b', 'c'], failed: 2 },
    ]);
  });

  it('does not count harness_error as a family failure', () => {
    const drafts = proposeFamiliesFromFailures([
      { instance_id: 'a', verdict: 'unresolved', familyHint: 'F-X' },
      { instance_id: 'b', verdict: 'harness_error', familyHint: 'F-X' },
      { instance_id: 'c', verdict: 'harness_error', familyHint: 'F-X' },
    ]);
    expect(drafts).toEqual([]);
  });
});

describe('v0.5 frozen sampling scrape', () => {
  it('reads glm-5.3 from the v0.5 prereg table', async () => {
    const spec = await readInjectionSpec(resolve('docs/proposals/injection-effect-experiment-prereg-v0.5.md'));
    expect(spec.sampling.model).toBe('glm-5.3');
    expect(spec.sampling.profile).toBe('zhipu-glm-5.3');
  });
});

describe('reusable produced patches', () => {
  it('treats only non-empty model_patch as reusable', () => {
    expect(isReusablePatch('')).toBe(false);
    expect(isReusablePatch('   ')).toBe(false);
    expect(isReusablePatch('diff --git a/x b/x\n')).toBe(true);
    expect(parsePredictionRecord('{"instance_id":"django__django-10914","model_patch":""}')?.model_patch).toBe('');
    expect(parsePredictionRecord('not json')).toBeNull();
  });

  it('loads a real predictions.jsonl and skips empty stubs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'b-arm-reuse-'));
    const realDir = join(root, 'django__django-10914');
    const emptyDir = join(root, 'django__django-11019');
    await mkdir(realDir);
    await mkdir(emptyDir);
    await writeFile(join(realDir, 'predictions.jsonl'), `${JSON.stringify({
      instance_id: 'django__django-10914',
      model_name_or_path: 'glm-5.3',
      model_patch: 'diff --git a/a b/a\n',
    })}\n`);
    await writeFile(join(realDir, 'records.json'), JSON.stringify({
      records: [{ trace: { tokenUsage: { totalTokens: 121183, inputTokens: 6804, outputTokens: 4171, costUsd: { total: 0 } } } }],
    }));
    await writeFile(join(emptyDir, 'predictions.jsonl'), `${JSON.stringify({
      instance_id: 'django__django-11019',
      model_name_or_path: 'glm-5.3',
      model_patch: '',
    })}\n`);
    const reusable = await loadReusableRun(realDir);
    expect(reusable).toMatchObject({
      instance_id: 'django__django-10914',
      tokens: 121183,
      inputTokens: 6804,
      outputTokens: 4171,
    });
    expect(reusable?.model_patch.startsWith('diff --git')).toBe(true);
    expect(await loadReusableRun(emptyDir)).toBeNull();
  });
});

describe('scan verdict semantics', () => {
  it('never emits resolved=false', () => {
    expect(buildScanResult({
      instance_id: 'django__django-11001',
      repo: 'django',
      verdict: 'unresolved',
      tokens: 1,
    })).toEqual({
      instance_id: 'django__django-11001',
      repo: 'django',
      verdict: 'unresolved',
      tokens: 1,
    });
    expect(buildScanResult({
      instance_id: 'django__django-10914',
      repo: 'django',
      verdict: 'harness_error',
      tokens: 1,
      error: 'Official SWE-bench harness exited with code 1',
    }).resolved).toBeUndefined();
    expect(buildScanResult({
      instance_id: 'django__django-10914',
      repo: 'django',
      verdict: 'resolved',
      tokens: 1,
    }).resolved).toBe(true);
  });

  it('voids the four masquerading harness fails and keeps official rescore verdicts', () => {
    const rows = [
      { instance_id: 'django__django-10914', repo: 'django', resolved: false, tokens: 705212, error: 'Official SWE-bench harness exited with code 1', stopped: true },
      { instance_id: 'django__django-10914', repo: 'django', resolved: false, tokens: 121183, error: 'Official SWE-bench harness exited with code 1' },
      { instance_id: 'django__django-10924', repo: 'django', resolved: false, tokens: 560804, error: 'Official SWE-bench harness exited with code 1' },
      { instance_id: 'django__django-11001', repo: 'django', resolved: false, tokens: 467689, error: 'Official SWE-bench harness exited with code 1' },
      { instance_id: 'django__django-10914', repo: 'django', resolved: true, tokens: 121183, source: 'rescore-probe' },
      { instance_id: 'django__django-10924', repo: 'django', resolved: true, tokens: 560804, source: 'rescore-probe' },
      { instance_id: 'django__django-11001', repo: 'django', resolved: false, tokens: 467689, source: 'rescore-probe' },
    ];
    const normalized = rows.map((row) => normalizeScanResult(row));
    expect(normalized.slice(0, 4).every((row) => row.verdict === 'harness_error' && row.voided && row.resolved === undefined)).toBe(true);
    expect(normalized[4]).toMatchObject({ verdict: 'resolved', resolved: true });
    expect(normalized[6]).toMatchObject({ verdict: 'unresolved' });
    expect(normalized[6].resolved).toBeUndefined();
    const latest = latestNonVoidedRow(normalized);
    expect([...officialVerdictIds(normalized)].sort()).toEqual([
      'django__django-10914',
      'django__django-10924',
      'django__django-11001',
    ]);
    expect(latest.get('django__django-11001')?.verdict).toBe('unresolved');
    expect(buildRetryQueue(normalized)).toEqual([]);
  });

  it('puts latest harness_error into the retry queue', () => {
    const rows = [
      buildScanResult({
        instance_id: 'django__django-11019',
        repo: 'django',
        verdict: 'harness_error',
        tokens: 0,
        error: 'Official SWE-bench harness exited with code 1',
      }),
      buildScanResult({
        instance_id: 'django__django-10914',
        repo: 'django',
        verdict: 'resolved',
        tokens: 1,
      }),
    ];
    expect(buildRetryQueue(rows).map((row) => row.instance_id)).toEqual(['django__django-11019']);
  });
});
