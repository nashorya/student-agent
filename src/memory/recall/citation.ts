export const USED_RECALL_MARKER_RE = /\[\[used_recall:([A-Za-z0-9._:-]+)\]\]/g;

export interface RecallCitationAudit {
  injected_recall_ids: string[];
  cited_recall_ids: string[];
  used_recall_ids: string[];
  invalid_recall_ids: string[];
  citation_events: RecallCitationEvent[];
  utilization_rate: number;
}

export interface RecallCitationEvent {
  message_index: number;
  context_trace_index: number | null;
  injected_ids: string[];
  cited_ids: string[];
  used_ids: string[];
  invalid_ids: string[];
  alignment_status: 'matched' | 'unmatched';
}

export interface RecallCitationContext {
  items: Array<{ id: string; kind: string }>;
}

export function buildRecallCitationAudit(input: {
  messages: string[];
  contexts: RecallCitationContext[];
}): { cleanedMessages: string[]; audit: RecallCitationAudit } {
  const events: RecallCitationEvent[] = [];
  const cleanedMessages = input.messages.map((message, index) => {
    const citedIds = unique([...message.matchAll(USED_RECALL_MARKER_RE)].map((match) => match[1]));
    const context = input.contexts[index];
    const injectedIds = context
      ? unique(context.items.filter(isCitableRecallItem).map((item) => item.id))
      : [];
    const allowlist = new Set(injectedIds);
    const usedIds = citedIds.filter((id) => allowlist.has(id));
    const invalidIds = citedIds.filter((id) => !allowlist.has(id));
    if (citedIds.length > 0 || !context) {
      events.push({
        message_index: index,
        context_trace_index: context ? index : null,
        injected_ids: injectedIds,
        cited_ids: citedIds,
        used_ids: usedIds,
        invalid_ids: invalidIds,
        alignment_status: context ? 'matched' : 'unmatched',
      });
    }
    return cleanCitationMarkers(message);
  });

  const injected = unique(input.contexts.flatMap((context) =>
    context.items.filter(isCitableRecallItem).map((item) => item.id),
  )).sort();
  const cited = unique(events.flatMap((event) => event.cited_ids)).sort();
  const used = unique(events.flatMap((event) => event.used_ids)).sort();
  const invalid = unique(events.flatMap((event) => event.invalid_ids)).sort();

  return {
    cleanedMessages,
    audit: {
      injected_recall_ids: injected,
      cited_recall_ids: cited,
      used_recall_ids: used,
      invalid_recall_ids: invalid,
      citation_events: events,
      utilization_rate: injected.length === 0 ? 0 : clamp(used.length / injected.length),
    },
  };
}

function isCitableRecallItem(item: { kind: string }): boolean {
  return item.kind === 'lesson' || item.kind === 'knack';
}

export function cleanCitationMarkers(text: string): string {
  return text
    .replace(USED_RECALL_MARKER_RE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}
