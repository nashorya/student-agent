import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRecallCitationAudit } from '../citation.js';

interface ReplayFixture {
  knackId: string;
  messages: string[];
  contexts: Array<{ items: Array<{ id: string; kind: string }> }>;
  before: {
    used_recall_ids: string[];
    invalid_recall_ids: string[];
    cited_recall_ids: string[];
    injected_recall_ids: string[];
    citation_message_index: number;
    context_trace_count: number;
    message_count: number;
  };
}

describe('instrument P3 citation · 14995 probe replay (BUG-012)', () => {
  it('single context trace + late assistant citation becomes used_recall', () => {
    const fixture = JSON.parse(
      readFileSync(
        join(process.cwd(), 'evals/fixtures/knack-birth-14995-citation-replay.json'),
        'utf8',
      ),
    ) as ReplayFixture;

    expect(fixture.before.used_recall_ids).toEqual([]);
    expect(fixture.before.invalid_recall_ids).toEqual([fixture.knackId]);
    expect(fixture.before.context_trace_count).toBe(1);
    expect(fixture.messages).toHaveLength(fixture.before.message_count);
    expect(fixture.messages[fixture.before.citation_message_index]).toContain(
      `[[used_recall:${fixture.knackId}]]`,
    );

    const replayed = buildRecallCitationAudit({
      messages: fixture.messages,
      contexts: fixture.contexts,
    });

    expect(replayed.audit.injected_recall_ids).toEqual([fixture.knackId]);
    expect(replayed.audit.cited_recall_ids).toEqual([fixture.knackId]);
    expect(replayed.audit.used_recall_ids).toEqual([fixture.knackId]);
    expect(replayed.audit.invalid_recall_ids).toEqual([]);
    expect(replayed.audit.citation_events).toContainEqual(expect.objectContaining({
      message_index: fixture.before.citation_message_index,
      context_trace_index: 0,
      used_ids: [fixture.knackId],
      alignment_status: 'matched',
    }));
  });
});
