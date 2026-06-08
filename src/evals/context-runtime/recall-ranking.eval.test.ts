import { describe, expect, it, vi } from 'vitest';
import { scoreRecallItem } from '../../memory/recall/scoring.js';
import { RecallRouter } from '../../memory/recall/recall-router.js';
import { recallItem, memoryResult } from './fixtures/recall-items.js';
import { recallQuery, recallRouterInput } from './fixtures/recall-query.js';

const NOW = new Date('2026-01-15T00:00:00.000Z');

describe('Context Runtime Eval: recall scoring ranking', () => {
  it('keeps all recall totals inside [0, 1]', () => {
    const items = rankingItems();
    const scores = items.map((item) => scoreRecallItem(item, recallQuery, {
      tier: 'standard',
      goal: 'Recover Hashline stale edit with fresh read',
      currentStep: 'Rank recall candidates',
      now: NOW,
    }));

    expect(scores.every((score) => score.total >= 0 && score.total <= 1)).toBe(true);
    expect(scores.every((score) =>
      Object.values(score.dimensions).every((dimension) => dimension >= 0 && dimension <= 1),
    )).toBe(true);
  });

  it('has stable standard ranking and does not let recency-only items reach top1', () => {
    const ranked = rankingItems()
      .map((item) => ({
        id: item.id,
        score: scoreRecallItem(item, recallQuery, {
          tier: 'standard',
          goal: 'Recover Hashline stale edit with fresh read',
          currentStep: 'Rank recall candidates',
          now: NOW,
        }).total,
      }))
      .sort((a, b) => b.score - a.score);

    expect(ranked.map((item) => item.id)).toEqual(['B', 'A', 'C', 'D']);
    expect(ranked[0].id).not.toBe('D');
  });

  it('gives relevance and evidence stronger advantage in heavy tier', () => {
    const [a, b] = rankingItems();
    const standardA = scoreRecallItem(a, recallQuery, {
      tier: 'standard',
      goal: 'Recover Hashline stale edit with fresh read',
      currentStep: 'Rank recall candidates',
      now: NOW,
    }).total;
    const standardB = scoreRecallItem(b, recallQuery, {
      tier: 'standard',
      goal: 'Recover Hashline stale edit with fresh read',
      currentStep: 'Rank recall candidates',
      now: NOW,
    }).total;
    const heavyA = scoreRecallItem(a, recallQuery, {
      tier: 'heavy',
      goal: 'Recover Hashline stale edit with fresh read',
      currentStep: 'Rank recall candidates',
      now: NOW,
    }).total;
    const heavyB = scoreRecallItem(b, recallQuery, {
      tier: 'heavy',
      goal: 'Recover Hashline stale edit with fresh read',
      currentStep: 'Rank recall candidates',
      now: NOW,
    }).total;

    expect(standardB - standardA).toBeLessThan(heavyB - heavyA);
    expect(heavyB).toBeGreaterThan(heavyA);
  });

  it('penalizes recall items that overlap rejected assumptions', async () => {
    const router = new RecallRouter({
      search: vi.fn().mockResolvedValue([
        memoryResult(recallItem({
          id: 'blind_retry',
          summary: 'Blind retry stale edits after rejection',
        }), 1, { keyword: 1 }),
      ]),
    });

    const bundle = await router.recall(recallRouterInput());

    expect(bundle.knacks[0].id).toBe('blind_retry');
    expect(bundle.knacks[0].score.total).toBe(0.3);
    expect(bundle.diagnostics.penalties).toMatchObject([{
      id: 'blind_retry',
      reason: 'overlaps_rejected_assumption',
      severity: 'hard',
    }]);
  });

  it('keeps compatibility fields as mappings from dimensions, not separate ranking inputs', () => {
    const score = scoreRecallItem(rankingItems()[0], recallQuery, {
      tier: 'standard',
      goal: 'Recover Hashline stale edit with fresh read',
      currentStep: 'Rank recall candidates',
      now: NOW,
    });

    expect(score.trigger).toBe(score.dimensions.trigger);
    expect(score.keyword).toBe(score.dimensions.keyword);
    expect(score.metadata).toBe(score.dimensions.metadata);
    expect(score.vector).toBe(0);
  });
});

function rankingItems() {
  return [
    recallItem({
      id: 'A',
      summary: 'Hashline trigger match with weak evidence',
      recall: {
        trigger: { signalKinds: ['hashline_rejection'], paths: ['src/hashline.ts'], toolNames: ['hashline_edit'] },
        applicableWhen: ['unrelated style preference'],
        doNotApplyWhen: [],
        tags: ['hashline'],
      },
      metadata: { status: 'candidate', evidenceRefs: [], createdAt: '2026-01-01T00:00:00.000Z' },
    }),
    recallItem({
      id: 'B',
      summary: 'Fresh read before retrying stale Hashline edit',
      recall: {
        trigger: { signalKinds: ['tool_error'], paths: ['src/hashline.ts'] },
        applicableWhen: ['Recover Hashline stale edit with fresh read and validation'],
        doNotApplyWhen: [],
        tags: ['hashline'],
      },
      metadata: { status: 'candidate', evidenceRefs: ['a', 'b', 'c', 'd', 'e'], createdAt: '2026-01-01T00:00:00.000Z' },
    }),
    recallItem({
      id: 'C',
      summary: 'Recover Hashline stale edit with fresh read validation',
      recall: {
        trigger: {},
        applicableWhen: ['Hashline stale edit'],
        doNotApplyWhen: [],
        tags: ['other'],
      },
      metadata: { status: 'deprecated', evidenceRefs: ['a'], createdAt: '2026-01-01T00:00:00.000Z' },
    }),
    recallItem({
      id: 'D',
      summary: 'Brand new but unrelated deployment note',
      recall: {
        trigger: {},
        applicableWhen: ['Deploy marketing page'],
        doNotApplyWhen: [],
        tags: ['deploy'],
      },
      metadata: { status: 'candidate', evidenceRefs: [], createdAt: '2026-01-15T00:00:00.000Z' },
    }),
  ];
}
