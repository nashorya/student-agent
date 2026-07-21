import { describe, expect, it } from 'vitest';
import { rankKnackResults } from '../knack-ranking.js';
import { resolveRepositoryIdentity } from '../repository-identity.js';
import type { MemoryRecallResult, RecallableMemoryItem } from '../types.js';

describe('instrument eligibility · repository gate (BUG-012)', () => {
  it('same-repo schema-v1 knack is eligible', async () => {
    const ranked = await rankKnackResults([
      result('same-repo', {
        repo: 'astropy/astropy',
        symptom: 'NDDataRef mask propagation fails',
        fixSummary: 'return deepcopy(self.mask) when operand.mask is None',
      }),
    ], {
      repository: 'astropy/astropy',
      queryText: 'unrelated lexical filler with no symptom overlap',
      currentTaskId: 'astropy__astropy-14995',
    });

    expect(ranked).toHaveLength(1);
    expect(ranked[0].ranking).toMatchObject({
      repoMatch: true,
      eligible: true,
    });
  });

  it('cross-repo schema-v1 knack is ineligible without similarity rescue', async () => {
    const ranked = await rankKnackResults([
      result('cross-repo', {
        repo: 'django/django',
        symptom: 'migration serializer emits short __name__',
        fixSummary: 'prefer __qualname__ for nested classes',
      }),
    ], {
      repository: 'astropy/astropy',
      queryText: 'completely orthogonal nddata mask arithmetic failure',
      currentTaskId: 'astropy__astropy-14995',
    });

    expect(ranked).toEqual([]);
  });

  it('internal task_* id recovers SWE identity from hints and does not false-drop same-repo knacks', async () => {
    const repository = resolveRepositoryIdentity({
      taskId: 'task_1784388855001',
      hints: [
        'Eval task: SWE-bench astropy__astropy-14995',
        'Instance: astropy__astropy-14995\n\nNDDataRef mask propagation fails',
      ],
      cwd: '/Users/dev/student-agent-injection-instrument',
    });
    expect(repository).toBe('astropy/astropy');

    const ranked = await rankKnackResults([
      result('knack-astropy-astropy-cd70659d7b27', {
        repo: 'astropy/astropy',
        symptom: 'NDDataRef mask propagation fails when one operand has no mask',
        fixSummary: 'In _arithmetic_mask add elif operand.mask is None: return deepcopy(self.mask)',
      }),
    ], {
      repository,
      queryText: [
        'Eval task: SWE-bench astropy__astropy-14995',
        'Instance: astropy__astropy-14995',
        'NDDataRef mask propagation fails when one of the operand does not have a mask',
      ].join('\n'),
      currentTaskId: 'task_1784388855001',
    });

    expect(ranked.map((entry) => entry.item.id)).toEqual(['knack-astropy-astropy-cd70659d7b27']);
    expect(ranked[0].ranking).toMatchObject({
      repoMatch: true,
      eligible: true,
    });
  });
});

function result(id: string, knack: {
  repo: string;
  symptom: string;
  fixSummary: string;
}): MemoryRecallResult {
  const item: RecallableMemoryItem = {
    id,
    kind: 'knack',
    summary: `${knack.symptom} Fix: ${knack.fixSummary}`,
    recall: { trigger: {}, applicableWhen: [knack.symptom], doNotApplyWhen: [] },
    metadata: { status: 'validated' },
    payload: {
      id,
      ...knack,
      status: 'validated',
    },
  };
  return {
    item,
    score: {
      dimensions: { trigger: 0, keyword: 0, recency: 0, relevance: 0.5, metadata: 0.5, evidence: 0 },
      trigger: 0,
      keyword: 0,
      metadata: 0.5,
      vector: 0,
      total: 0.5,
    },
  };
}
