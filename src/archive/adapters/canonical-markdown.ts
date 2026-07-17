import type { AdrDecisionStatus, AdrImplementationStatus, ArchiveAdr, ArchiveBug, ArchiveEvidence, ArchiveTimelineEntry, BugStatus } from '../types.js';

export interface ParsedFrontmatter {
  values: Record<string, string>;
  body: string;
  spans: Record<string, Array<{ start: number; end: number }>>;
}

export function parseFrontmatter(source: string): ParsedFrontmatter | undefined {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return undefined;
  const values: Record<string, string> = {};
  const spans: ParsedFrontmatter['spans'] = {};
  const blockStart = source.indexOf(match[1]);
  for (const lineMatch of match[1].matchAll(/^([A-Za-z_][\w-]*):\s*(.*?)\s*$/gm)) {
    const key = lineMatch[1];
    values[key] = unquote(lineMatch[2]);
    const start = blockStart + (lineMatch.index ?? 0);
    (spans[key] ??= []).push({ start, end: start + lineMatch[0].length });
  }
  return { values, body: source.slice(match[0].length), spans };
}

export function parseAdrMarkdown(source: string, sourcePath: string): ArchiveAdr {
  const frontmatter = parseFrontmatter(source);
  if (frontmatter) {
    const values = frontmatter.values;
    return {
      id: values.id ?? inferId(sourcePath, 'ADR'),
      title: values.title ?? headingTitle(frontmatter.body),
      date: values.date ?? '',
      decisionStatus: normalizeAdrStatus(values.decision_status ?? values.status),
      implementationStatus: normalizeImplementationStatus(values.implementation_status),
      body: frontmatter.body,
      sourcePath,
      history: [],
      acceptance: parseAcceptance(values),
    };
  }
  return parseBoldAdr(source, sourcePath);
}

export function parseBuglogMarkdown(source: string, sourcePath: string): ArchiveBug[] {
  const matches = [...source.matchAll(/^##\s+(BUG-\d+)(?:\s*[·:-]\s*(.*))?\s*$/gm)];
  return matches.map((match, index) => {
    const sectionStart = (match.index ?? 0) + match[0].length;
    const sectionEnd = matches[index + 1]?.index ?? source.length;
    const body = source.slice(sectionStart, sectionEnd);
    const statuses = metadataValues(body, ['状态', 'status']);
    const evidence = metadataValues(body, ['验证', 'verification']).map(parseEvidence);
    return {
      id: match[1], title: match[2]?.trim() || match[1], status: normalizeBugStatus(statuses.at(-1)),
      symptom: metadataValues(body, ['症状', 'symptom'])[0] ?? '',
      rootCause: metadataValues(body, ['根因', 'root cause'])[0],
      fix: metadataValues(body, ['修复', 'fix'])[0], evidence, history: [], sourcePath,
    };
  });
}

export function parseIndexMarkdown(source: string, sourcePath: string): ArchiveTimelineEntry[] {
  const lines = source.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^\s*\|/.test(line) && /日期|date/i.test(line) && /事件|event/i.test(line));
  if (headerIndex < 0) return [];
  const rows: string[] = [];
  for (let index = headerIndex + 1; index < lines.length; index++) {
    if (!/^\s*\|/.test(lines[index])) break;
    rows.push(lines[index]);
  }
  const result: ArchiveTimelineEntry[] = [];
  for (const row of rows) {
    const columns = row.split('|').slice(1, -1).map((value) => value.trim());
    if (columns.length < 2 || /日期|date/i.test(columns[0]) || /^:?-{3}/.test(columns[0])) continue;
    result.push({ id: `INDEX-${result.length + 1}`, date: columns[0], title: stripMarkdown(columns[1]), summary: columns[2] ?? columns[1], kind: 'change', sourcePath });
  }
  return result;
}

function parseBoldAdr(source: string, sourcePath: string): ArchiveAdr {
  const title = headingTitle(source).replace(/^ADR-[\w-]+\s*[·:-]?\s*/i, '');
  return {
    id: inferId(sourcePath, 'ADR'), title, date: metadataValues(source, ['日期', 'date'])[0] ?? '',
    decisionStatus: normalizeAdrStatus(metadataValues(source, ['状态', 'status'])[0]),
    implementationStatus: normalizeImplementationStatus(metadataValues(source, ['实施状态', 'implementation status'])[0]),
    body: source, sourcePath, history: [], legacyAcceptance: normalizeAdrStatus(metadataValues(source, ['状态', 'status'])[0]) === 'accepted',
  };
}

function metadataValues(source: string, labels: string[]): string[] {
  const escaped = labels.map(escapeRegExp).join('|');
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:-\\s*)?\\*\\*(?:${escaped})\\*\\*\\s*[：:]\\s*([^\\n]+)`, 'gi');
  return [...source.matchAll(pattern)].map((match) => match[1].trim());
}

function parseEvidence(value: string, index: number): ArchiveEvidence {
  return { id: `verification-${index + 1}`, kind: 'verification', status: /^passed\b/i.test(value) ? 'passed' : /^failed\b/i.test(value) ? 'failed' : 'recorded', summary: value };
}

function normalizeAdrStatus(value?: string): AdrDecisionStatus {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'accepted' || normalized === '已采纳' || normalized === '采纳') return 'accepted';
  if (normalized === 'rejected' || normalized === '已拒绝') return 'rejected';
  if (normalized === 'superseded' || normalized === '已取代') return 'superseded';
  return 'proposed';
}

function normalizeImplementationStatus(value?: string): AdrImplementationStatus {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'verified' || normalized === '已验证') return 'verified';
  if (normalized === 'in_progress' || normalized === 'in progress' || normalized === '进行中') return 'in_progress';
  if (normalized === 'not_applicable' || normalized === 'not applicable' || normalized === '不适用') return 'not_applicable';
  return 'planned';
}

function normalizeBugStatus(value?: string): BugStatus {
  const token = value?.trim().toUpperCase().match(/OPEN|INVESTIGATING|FIXED|CLOSED|WONTFIX|DUPLICATE|CANNOT_REPRODUCE|REOPENED/)?.[0];
  return (token as BugStatus | undefined) ?? 'OPEN';
}

function parseAcceptance(values: Record<string, string>): ArchiveAdr['acceptance'] {
  if (!values.accepted_at || !values.acceptance_evidence) return undefined;
  return { acceptedAt: values.accepted_at, acceptedBy: 'user', evidenceRef: values.acceptance_evidence };
}

function inferId(path: string, prefix: string): string {
  return path.match(new RegExp(`${prefix}-\\d+`, 'i'))?.[0].toUpperCase() ?? `${prefix}-UNKNOWN`;
}

function headingTitle(source: string): string {
  return source.match(/^#\s+(.+)$/m)?.[1].trim() ?? '';
}

function stripMarkdown(value: string): string {
  return value.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').trim();
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function unquote(value: string): string { return value.replace(/^(['"])(.*)\1$/, '$2'); }
