import { describe, expect, it } from 'vitest';
import { rankKnackResults } from '../knack-ranking.js';
import {
  cosineSimilarity,
  EmbeddingRecallSimilarityProvider,
  FallbackRecallSimilarityProvider,
} from '../../embedding/provider.js';
import type { MemoryRecallResult, RecallableMemoryItem } from '../types.js';

describe('rankKnackResults', () => {
  it('prefers an old verified reused relevant knack over a new unrelated candidate', async () => {
    const ranked = await rankKnackResults([
      result('relevant', {
        repo: 'astropy/astropy',
        symptom: 'replace does not reassign output_field',
        fixSummary: 'assign replace result back to output_field',
        reuseCount: 2,
        status: 'validated',
      }),
      result('unrelated', {
        repo: 'django/django',
        symptom: 'migration graph has a missing dependency',
        fixSummary: 'repair the migration dependency',
        reuseCount: 20,
        status: 'candidate',
      }),
    ], {
      repository: 'astropy/astropy',
      queryText: 'output_field replace result was discarded',
      currentTaskId: 'astropy__astropy-6938',
    });

    expect(ranked.map((entry) => entry.item.id)).toEqual(['relevant']);
    expect(ranked[0].ranking).toMatchObject({
      repoMatch: true,
      similaritySource: 'lexical',
      reuseCount: 2,
      confidence: 1,
      eligible: true,
    });
  });

  it('demotes a knack already injected into the current task when other signals tie', async () => {
    const ranked = await rankKnackResults([
      result('repeat', {
        repo: 'astropy/astropy',
        symptom: 'nested compound model separability matrix is wrong',
        fixSummary: 'copy the actual matrix values',
        lastInjectedTask: 'astropy__astropy-12907',
      }),
      result('fresh', {
        repo: 'astropy/astropy',
        symptom: 'nested compound model separability matrix is wrong',
        fixSummary: 'copy the actual matrix values',
      }),
    ], {
      repository: 'astropy/astropy',
      queryText: 'nested compound model separability matrix is wrong',
      currentTaskId: 'astropy__astropy-12907',
    });

    expect(ranked.map((entry) => entry.item.id)).toEqual(['fresh', 'repeat']);
    expect(ranked[1].ranking?.antiRepeat).toBe(0);
  });

  it('uses a supplied semantic provider deterministically', async () => {
    const ranked = await rankKnackResults([
      result('semantic', {
        repo: 'other/repo',
        symptom: 'opaque failure text',
        fixSummary: 'apply semantic fix',
      }),
    ], {
      repository: 'astropy/astropy',
      queryText: 'unrelated lexical query',
      currentTaskId: 'task_1',
      similarityProvider: {
        score: async () => new Map([['semantic', 0.82]]),
      },
    });

    expect(ranked).toHaveLength(1);
    expect(ranked[0].ranking).toMatchObject({
      similarity: 0.82,
      similaritySource: 'embedding',
      eligible: true,
    });
  });

  it('normalizes cosine similarity to [0, 1]', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(0);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0.5);
  });

  it('falls back to lexical similarity when embedding fails', async () => {
    const provider = new FallbackRecallSimilarityProvider(
      new EmbeddingRecallSimilarityProvider({
        dimensions: 2,
        embed: async () => { throw new Error('offline'); },
      }),
    );
    const ranked = await rankKnackResults([
      result('fallback', {
        repo: 'other/repo',
        symptom: 'replace result is discarded',
        fixSummary: 'assign result back',
      }),
    ], {
      repository: 'astropy/astropy',
      queryText: 'replace result is discarded',
      currentTaskId: 'task_1',
      similarityProvider: provider,
    });

    expect(ranked[0].ranking?.similaritySource).toBe('lexical');
  });

  it('ranks legacy knacks with absent v3 fields without error', async () => {
    const ranked = await rankKnackResults([
      result('legacy', {
        repo: 'astropy/astropy',
        symptom: 'replace result is discarded',
        fixSummary: 'assign the result back',
      }),
    ], {
      repository: 'astropy/astropy',
      queryText: 'replace discarded',
      currentTaskId: 'task_legacy',
    });
    expect(ranked).toHaveLength(1);
    const payload = ranked[0].item.payload as Record<string, unknown>;
    expect(payload.verification).toBeUndefined();
    expect(payload.executionEvidence).toBeUndefined();
    expect(ranked[0].item.summary).toContain('Fix: assign the result back');
  });
});

function result(id: string, knack: {
  repo: string;
  symptom: string;
  fixSummary: string;
  reuseCount?: number;
  status?: 'candidate' | 'validated';
  lastInjectedTask?: string | null;
}): MemoryRecallResult {
  const item: RecallableMemoryItem = {
    id,
    kind: 'knack',
    summary: `${knack.symptom} Fix: ${knack.fixSummary}`,
    recall: { trigger: {}, applicableWhen: [knack.symptom], doNotApplyWhen: [] },
    metadata: { status: knack.status ?? 'validated' },
    payload: {
      id,
      ...knack,
      status: knack.status ?? 'validated',
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
