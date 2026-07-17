import type { ArchiveAdr, ArchiveBug, ArchiveProject, ArchiveTimelineEntry } from './types.js';

export type ChronicleItemKind = 'timeline' | 'adr' | 'bug' | 'verification';

export interface ArchiveChronicleItem {
  key: string;
  kind: ChronicleItemKind;
  entityId: string;
  dateLabel: string;
  sortDate?: string;
  title: string;
  summary: string;
  route: string;
  statuses: string[];
  relatedEntityIds: string[];
  sourcePath?: string;
  position: number;
}

export interface ArchiveChronicleModel {
  items: ArchiveChronicleItem[];
  datedItems: ArchiveChronicleItem[];
  undatedItems: ArchiveChronicleItem[];
  startDate?: string;
  endDate?: string;
  entityRoutes: Record<string, string>;
}

const ENTITY_PATTERN = /(?<![A-Z0-9-])(?:ADR-\d{3}|BUG-\d{3})(?![A-Z0-9-])/gi;
const KIND_ORDER: Record<ChronicleItemKind, number> = {
  timeline: 0,
  adr: 1,
  bug: 2,
  verification: 3,
};
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function extractEntityIds(value: string): string[] {
  return [...new Set([...value.matchAll(ENTITY_PATTERN)].map((match) => match[0].toUpperCase()))];
}

export function firstIsoDate(value: string): string | undefined {
  for (const match of value.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const candidate = match[0];
    const date = new Date(`${candidate}T00:00:00Z`);
    if (!Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === candidate) return candidate;
  }
  return undefined;
}

function entityRoute(id: string): string {
  return id.startsWith('ADR-') ? `#adr/${id}` : id.startsWith('BUG-') ? `#bug/${id}` : `#timeline/${id}`;
}

function timelineItem(entry: ArchiveTimelineEntry): ArchiveChronicleItem {
  return {
    key: `timeline:${entry.id}`,
    kind: 'timeline',
    entityId: entry.id,
    dateLabel: entry.date || 'Undated',
    sortDate: firstIsoDate(entry.date),
    title: entry.title,
    summary: entry.summary,
    route: entityRoute(entry.id),
    statuses: [],
    relatedEntityIds: extractEntityIds(`${entry.title} ${entry.summary}`),
    sourcePath: entry.sourcePath,
    position: 0,
  };
}

function adrItem(adr: ArchiveAdr): ArchiveChronicleItem {
  return {
    key: `adr:${adr.id}`,
    kind: 'adr',
    entityId: adr.id,
    dateLabel: adr.date || 'Undated',
    sortDate: firstIsoDate(adr.date),
    title: adr.title,
    summary: adr.body,
    route: entityRoute(adr.id),
    statuses: [adr.decisionStatus, adr.implementationStatus],
    relatedEntityIds: extractEntityIds(`${adr.title} ${adr.body}`),
    sourcePath: adr.sourcePath,
    position: 0,
  };
}

function bugItem(bug: ArchiveBug, timeline: ArchiveTimelineEntry[]): ArchiveChronicleItem {
  const referencedDate = timeline
    .filter((entry) => extractEntityIds(`${entry.title} ${entry.summary}`).includes(bug.id))
    .map((entry) => firstIsoDate(entry.date))
    .filter((date): date is string => date !== undefined)
    .sort()[0];
  const historyDate = bug.history
    .map((entry) => firstIsoDate(entry.at))
    .filter((date): date is string => date !== undefined)
    .sort()[0];
  const sortDate = referencedDate ?? historyDate;

  return {
    key: `bug:${bug.id}`,
    kind: 'bug',
    entityId: bug.id,
    dateLabel: sortDate ?? 'Undated',
    sortDate,
    title: bug.title,
    summary: bug.symptom,
    route: entityRoute(bug.id),
    statuses: [bug.status],
    relatedEntityIds: extractEntityIds(`${bug.title} ${bug.symptom}`),
    sourcePath: bug.sourcePath,
    position: 0,
  };
}

function compareChronicleItems(left: ArchiveChronicleItem, right: ArchiveChronicleItem): number {
  const dateComparison = compareOptionalStrings(left.sortDate, right.sortDate);
  if (dateComparison !== 0) return dateComparison;

  const kindComparison = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
  if (kindComparison !== 0) return kindComparison;

  return compareStrings(left.entityId, right.entityId);
}

function compareOptionalStrings(left: string | undefined, right: string | undefined): number {
  if (left === right) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return compareStrings(left, right);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assignPositions(
  items: ArchiveChronicleItem[],
  startDate: string | undefined,
  endDate: string | undefined,
): ArchiveChronicleItem[] {
  if (!startDate || !endDate) return items;

  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (start === end) return items.map((item) => ({ ...item, position: 0.5 }));

  const totalDays = (end - start) / MILLISECONDS_PER_DAY;
  return items.map((item) => {
    const itemDate = Date.parse(`${item.sortDate}T00:00:00Z`);
    const dayOffset = (itemDate - start) / MILLISECONDS_PER_DAY;
    return { ...item, position: Math.max(0, Math.min(1, dayOffset / totalDays)) };
  });
}

export function buildChronicleModel(project: ArchiveProject): ArchiveChronicleModel {
  const entityRoutes: Record<string, string> = {};
  for (const entry of project.timeline) entityRoutes[entry.id] = entityRoute(entry.id);
  for (const adr of project.adrs) entityRoutes[adr.id] = entityRoute(adr.id);
  for (const bug of project.bugs) entityRoutes[bug.id] = entityRoute(bug.id);

  const timeline = project.timeline.map(timelineItem);
  const referenced = new Set(timeline.flatMap((item) => item.relatedEntityIds));
  const standalone = [
    ...project.adrs.filter((adr) => !referenced.has(adr.id)).map(adrItem),
    ...project.bugs.filter((bug) => !referenced.has(bug.id)).map((bug) => bugItem(bug, project.timeline)),
  ];
  const items = [...timeline, ...standalone];
  const datedItems = items.filter((item) => item.sortDate).sort(compareChronicleItems);
  const undatedItems = items.filter((item) => !item.sortDate).sort(compareChronicleItems);
  const startDate = datedItems[0]?.sortDate;
  const endDate = datedItems.at(-1)?.sortDate;
  const positioned = assignPositions(datedItems, startDate, endDate);
  const byKey = new Map(positioned.map((item) => [item.key, item]));
  const allItems = items.map((item) => byKey.get(item.key) ?? item);
  return { items: allItems, datedItems: positioned, undatedItems, startDate, endDate, entityRoutes };
}
