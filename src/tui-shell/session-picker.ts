import type { SelectItem } from '@earendil-works/pi-tui';

/** Minimal session row for the resume picker (id is internal only). */
export type SessionPickEntry = {
  id: string;
  name: string;
  updated_at: string;
  message_count: number;
  preview: string;
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/**
 * Map session index rows → SelectList items.
 * Labels/descriptions never include the raw session id (Codex-style).
 * `value` keeps the id for apply/load only.
 */
export function sessionEntriesToSelectItems(
  entries: SessionPickEntry[],
  currentId?: string | null,
): SelectItem[] {
  return entries.map((entry) => {
    const name = entry.name.trim() || 'untitled';
    const when = formatWhen(entry.updated_at);
    const current = entry.id === currentId ? ' · current' : '';
    const preview = entry.preview ? ` — ${entry.preview}` : '';
    return {
      value: entry.id,
      label: name,
      description: `${entry.message_count} msgs · ${when}${current}${preview}`,
    };
  });
}
