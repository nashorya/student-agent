import { describe, expect, it } from 'vitest';
import { buildRecallCitationAudit } from '../citation.js';

describe('buildRecallCitationAudit', () => {
  it('validates citations against the corresponding message context and strips markers', () => {
    const result = buildRecallCitationAudit({
      messages: [
        'Use the remembered fix. [[used_recall:knack_6938]]',
        'Unknown claim [[used_recall:knack_hallucinated]]',
      ],
      contexts: [
        { items: [{ id: 'knack_6938', kind: 'knack' }] },
        { items: [{ id: 'knack_12907', kind: 'knack' }] },
      ],
    });

    expect(result.cleanedMessages).toEqual([
      'Use the remembered fix.',
      'Unknown claim',
    ]);
    expect(result.audit).toMatchObject({
      injected_recall_ids: ['knack_12907', 'knack_6938'],
      cited_recall_ids: ['knack_6938', 'knack_hallucinated'],
      used_recall_ids: ['knack_6938'],
      invalid_recall_ids: ['knack_hallucinated'],
      utilization_rate: 0.5,
    });
  });

  it('deduplicates run-level ids while preserving message-level evidence', () => {
    const result = buildRecallCitationAudit({
      messages: [
        '[[used_recall:knack_1]] [[used_recall:knack_1]]',
        '[[used_recall:knack_1]]',
      ],
      contexts: [
        { items: [{ id: 'knack_1', kind: 'knack' }] },
        { items: [{ id: 'knack_1', kind: 'knack' }] },
      ],
    });

    expect(result.audit.used_recall_ids).toEqual(['knack_1']);
    expect(result.audit.citation_events).toHaveLength(2);
    expect(result.audit.citation_events[0].cited_ids).toEqual(['knack_1']);
  });

  it('accepts lesson citations while rejecting non-injected memory kinds', () => {
    const result = buildRecallCitationAudit({
      messages: ['Use it [[used_recall:lesson_1]] [[used_recall:preference_1]]'],
      contexts: [{ items: [
        { id: 'lesson_1', kind: 'lesson' },
        { id: 'preference_1', kind: 'preference' },
      ] }],
    });
    expect(result.audit.used_recall_ids).toEqual(['lesson_1']);
    expect(result.audit.invalid_recall_ids).toEqual(['preference_1']);
  });

  it('fails closed when a message has no aligned context trace', () => {
    const result = buildRecallCitationAudit({
      messages: ['[[used_recall:knack_1]]'],
      contexts: [],
    });

    expect(result.audit.used_recall_ids).toEqual([]);
    expect(result.audit.invalid_recall_ids).toEqual(['knack_1']);
    expect(result.audit.citation_events[0].alignment_status).toBe('unmatched');
    expect(result.audit.utilization_rate).toBe(0);
  });
});
