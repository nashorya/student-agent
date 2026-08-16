import { describe, expect, it } from 'vitest';
import {
  SCORING_WEIGHTS,
  scoreEvidenceDimension,
  scoreKeywordDimension,
  scoreMetadataDimension,
  scoreRecallItem,
  scoreRecencyDimension,
  scoreRelevanceDimension,
  scoreTriggerDimension,
} from '../scoring.js';
import type { RecallQuery, RecallableMemoryItem } from '../types.js';

const NOW = new Date('2026-01-15T00:00:00.000Z');

describe('Recall Scoring v2', () => {
  it('keeps empty dimensions inside [0, 1]', () => {
    const item = memoryItem();
    const query: RecallQuery = {};

    expect(scoreTriggerDimension(item, query)).toBe(0);
    expect(scoreKeywordDimension(item, query)).toBe(0);
    expect(scoreRelevanceDimension(item, {})).toBe(0);
    expect(scoreMetadataDimension(item, query)).toBe(0);
    expect(scoreEvidenceDimension(item)).toBe(0);
    const result = scoreRecallItem(item, query, { tier: 'standard', now: NOW });
    expect(Object.values(result.dimensions).every((score) => score >= 0 && score <= 1)).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(1);
  });

  it('scores trigger exact and partial structural matches', () => {
    const item = memoryItem({
      recall: {
        trigger: {
          signalKinds: ['tool_error'],
          paths: ['src/App.tsx', 'src/Edit.tsx'],
          toolNames: ['edit'],
          ruleNames: ['hashline'],
        },
        applicableWhen: [],
        doNotApplyWhen: [],
      },
    });

    expect(scoreTriggerDimension(item, {
      trigger: {
        signalKinds: ['tool_error'],
        paths: ['src/App.tsx', 'src/Edit.tsx'],
        toolNames: ['edit'],
        ruleNames: ['hashline'],
      },
    })).toBe(1);

    const partial = scoreTriggerDimension(item, {
      trigger: {
        signalKinds: ['tool_error'],
        paths: ['src/App.tsx', 'src/Other.tsx'],
      },
    });
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1);
    expect(scoreTriggerDimension(memoryItem(), { trigger: {} })).toBe(0);
  });

  it('scores keyword overlap without duplicate token inflation', () => {
    const item = memoryItem({
      summary: 'retry edit after hashline rejection',
      recall: {
        trigger: { keywords: ['retry', 'edit'] },
        applicableWhen: ['retry edit after stale edit failure'],
        doNotApplyWhen: [],
      },
    });

    expect(scoreKeywordDimension(item, { text: '' })).toBe(0);
    expect(scoreKeywordDimension(item, { text: 'retry edit hashline rejection' })).toBe(1);
    const partial = scoreKeywordDimension(item, { text: 'retry retry unknown' });
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1);
  });

  it('scores recency with half-life decay and stable now', () => {
    expect(scoreRecencyDimension(memoryItem({
      metadata: { createdAt: '2026-01-15T00:00:00.000Z' },
    }), { now: NOW })).toBeCloseTo(1, 3);
    expect(scoreRecencyDimension(memoryItem({
      metadata: { createdAt: '2026-01-01T00:00:00.000Z' },
    }), { now: NOW })).toBeCloseTo(0.5, 2);
    expect(scoreRecencyDimension(memoryItem({
      metadata: { createdAt: '2025-11-16T00:00:00.000Z' },
    }), { now: NOW })).toBeCloseTo(0.1, 1);
    expect(scoreRecencyDimension(memoryItem(), { now: NOW })).toBe(0.5);
    expect(scoreRecencyDimension(memoryItem({
      metadata: { createdAt: '2026-01-16T00:00:00.000Z' },
    }), { now: NOW })).toBeCloseTo(1, 3);
  });

  it('scores relevance from goal/currentStep against applicableWhen only', () => {
    const item = memoryItem({
      recall: {
        trigger: {},
        applicableWhen: ['retry stale edit after hashline rejection'],
        doNotApplyWhen: [],
      },
    });

    expect(scoreRelevanceDimension(item, {
      goal: 'retry stale edit',
      currentStep: 'handle hashline rejection',
    })).toBeGreaterThan(0.7);
    expect(scoreRelevanceDimension(item, {})).toBe(0);
    expect(scoreRelevanceDimension(memoryItem({
      recall: { trigger: {}, applicableWhen: [], doNotApplyWhen: [] },
    }), { goal: 'retry stale edit' })).toBe(0);
  });

  it('scores metadata filters using only provided query filters', () => {
    const item = memoryItem({
      kind: 'knack',
      metadata: {
        scope: 'tool-preference',
        status: 'candidate',
        tags: ['hashline', 'retry'],
      },
    });

    expect(scoreMetadataDimension(item, {})).toBe(0);
    expect(scoreMetadataDimension(item, {
      metadata: {
        kinds: ['knack'],
        scopes: ['tool-preference'],
        statuses: ['candidate'],
        tags: ['hashline', 'missing'],
      },
    })).toBeCloseTo(0.875, 3);
    const partial = scoreMetadataDimension(item, {
      metadata: {
        kinds: ['preference'],
        scopes: ['tool-preference'],
      },
    });
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1);
  });

  it('scores evidence refs and counterexamples with clamps', () => {
    expect(scoreEvidenceDimension(memoryItem())).toBe(0);
    expect(scoreEvidenceDimension(memoryItem({
      metadata: { evidenceRefs: ['a', 'b', 'c', 'd', 'e', 'f'] },
    }))).toBe(1);
    expect(scoreEvidenceDimension(memoryItem({
      metadata: { evidenceRefs: ['a', 'b', 'c', 'd', 'e'] },
      payload: {
        counterexamples: [{ id: 'counter_1' }],
      },
    }))).toBeCloseTo(1 - (1 / 3), 3);
    expect(scoreEvidenceDimension(memoryItem({
      payload: {
        counterexamples: [{}, {}, {}],
      },
    }))).toBe(0);
  });

  it('combines dimensions with tier weights and preserves compatibility fields', () => {
    const item = memoryItem({
      kind: 'knack',
      summary: 'retry stale edit',
      recall: {
        trigger: { signalKinds: ['tool_error'], keywords: ['retry', 'edit'] },
        applicableWhen: ['retry stale edit after hashline rejection'],
        doNotApplyWhen: [],
      },
      metadata: {
        status: 'candidate',
        evidenceRefs: ['a', 'b'],
        createdAt: '2026-01-15T00:00:00.000Z',
      },
    });
    const query: RecallQuery = {
      text: 'retry edit',
      trigger: { signalKinds: ['tool_error'] },
      metadata: { kinds: ['knack'], statuses: ['candidate'] },
    };

    const standard = scoreRecallItem(item, query, {
      tier: 'standard',
      goal: 'retry stale edit',
      currentStep: 'hashline rejection recovery',
      now: NOW,
    });
    const expected = Object.entries(standard.dimensions).reduce((sum, [key, value]) =>
      sum + value * SCORING_WEIGHTS.standard[key as keyof typeof standard.dimensions], 0);
    expect(standard.total).toBeCloseTo(expected, 6);
    expect(standard.total).toBeGreaterThanOrEqual(0);
    expect(standard.total).toBeLessThanOrEqual(1);
    expect(standard.trigger).toBe(standard.dimensions.trigger);
    expect(standard.keyword).toBe(standard.dimensions.keyword);
    expect(standard.metadata).toBe(standard.dimensions.metadata);
    expect(standard.vector).toBe(0);
  });

  it('matches lesson symptoms from payload even when summary omits them', () => {
    const item = memoryItem({
      kind: 'lesson',
      summary: 'Cause: copies ones into the right block\nFix: assign the child matrix',
      payload: {
        cause: 'copies ones into the right block',
        fixPattern: 'assign the child matrix',
        symptomKeys: ['PLANTED_SYMPTOM_KEY'],
        lesson: 'Treat tool error as a retry pattern: AssertionError: boom',
        symptom: 'AssertionError: boom',
      },
    });

    expect(scoreKeywordDimension(item, { text: 'AssertionError' })).toBe(1);
    expect(scoreKeywordDimension(item, { text: 'PLANTED_SYMPTOM_KEY' })).toBe(1);
    expect(scoreKeywordDimension(memoryItem({
      kind: 'lesson',
      summary: item.summary,
      payload: {},
    }), { text: 'AssertionError' })).toBe(0);
  });

  it('allows heavy tier relevance and evidence weights to change ranking', () => {
    const query: RecallQuery = {
      text: 'retry stale edit',
      trigger: { signalKinds: ['tool_error'] },
    };
    const triggerHeavy = memoryItem({
      id: 'a',
      summary: 'retry stale edit',
      recall: {
        trigger: { signalKinds: ['tool_error'] },
        applicableWhen: ['unrelated deployment note'],
        doNotApplyWhen: [],
      },
      metadata: { evidenceRefs: ['a'], createdAt: '2026-01-15T00:00:00.000Z' },
    });
    const evidenceRelevant = memoryItem({
      id: 'b',
      summary: 'retry stale edit',
      recall: {
        trigger: { signalKinds: ['hashline_rejection'] },
        applicableWhen: ['retry stale edit after hashline rejection recovery'],
        doNotApplyWhen: [],
      },
      metadata: {
        evidenceRefs: ['a', 'b', 'c', 'd', 'e'],
        createdAt: '2026-01-15T00:00:00.000Z',
      },
    });

    const standardA = scoreRecallItem(triggerHeavy, query, {
      tier: 'standard',
      goal: 'retry stale edit',
      currentStep: 'hashline rejection recovery',
      now: NOW,
    }).total;
    const standardB = scoreRecallItem(evidenceRelevant, query, {
      tier: 'standard',
      goal: 'retry stale edit',
      currentStep: 'hashline rejection recovery',
      now: NOW,
    }).total;
    const heavyA = scoreRecallItem(triggerHeavy, query, {
      tier: 'heavy',
      goal: 'retry stale edit',
      currentStep: 'hashline rejection recovery',
      now: NOW,
    }).total;
    const heavyB = scoreRecallItem(evidenceRelevant, query, {
      tier: 'heavy',
      goal: 'retry stale edit',
      currentStep: 'hashline rejection recovery',
      now: NOW,
    }).total;

    expect(standardA).toBeGreaterThan(standardB);
    expect(heavyB).toBeGreaterThan(heavyA);
  });
});

function memoryItem(overrides: Partial<RecallableMemoryItem> = {}): RecallableMemoryItem {
  const { recall, metadata, ...rest } = overrides;
  const base: RecallableMemoryItem = {
    id: rest.id ?? 'item_1',
    kind: rest.kind ?? 'knack',
    subtype: rest.subtype,
    summary: rest.summary ?? '',
    recall: {
      trigger: {
        ...recall?.trigger,
      },
      applicableWhen: recall?.applicableWhen ?? [],
      doNotApplyWhen: recall?.doNotApplyWhen ?? [],
      tags: recall?.tags,
      sourceRefs: recall?.sourceRefs,
      updatedAt: recall?.updatedAt,
    },
    metadata: {
      ...metadata,
    },
    payload: rest.payload ?? {},
  };
  return {
    ...base,
    ...rest,
  };
}
