import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  estimateScanRuns,
  parseLiteIdsFromBlob,
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
      { instance_id: 'a', resolved: false, familyHint: 'F-X' },
      { instance_id: 'b', resolved: false, familyHint: 'F-X' },
      { instance_id: 'c', resolved: true, familyHint: 'F-X' },
      { instance_id: 'd', resolved: false, familyHint: 'F-Y' },
    ]);
    expect(drafts).toEqual([
      { familyId: 'F-X', instanceIds: ['a', 'b', 'c'], failed: 2 },
    ]);
  });
});

describe('v0.5 frozen sampling scrape', () => {
  it('reads glm-5.3 from the v0.5 prereg table', async () => {
    const spec = await readInjectionSpec(resolve('docs/proposals/injection-effect-experiment-prereg-v0.5.md'));
    expect(spec.sampling.model).toBe('glm-5.3');
    expect(spec.sampling.profile).toBe('zhipu-glm-5.3');
  });
});
