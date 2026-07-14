import type { ArchiveAdr } from '../types.js';
import { parseAdrMarkdown, parseFrontmatter } from './canonical-markdown.js';

export interface ConventionalAdrResult {
  entity: ArchiveAdr;
  canWrite: boolean;
  spans: Record<string, Array<{ start: number; end: number }>>;
}

const REQUIRED_FIELDS = ['id', 'title', 'date', 'decision_status', 'implementation_status'];

export function parseConventionalAdr(source: string, sourcePath: string): ConventionalAdrResult {
  const frontmatter = parseFrontmatter(source);
  const spans = frontmatter?.spans ?? {};
  return {
    entity: parseAdrMarkdown(source, sourcePath),
    canWrite: Boolean(frontmatter && REQUIRED_FIELDS.every((field) => spans[field]?.length === 1)),
    spans,
  };
}

export function updateConventionalAdr(source: string, adr: ArchiveAdr): string {
  const parsed = parseConventionalAdr(source, adr.sourcePath);
  if (!parsed.canWrite) throw new Error(`Conventional ADR is not safely writable: ${adr.sourcePath}`);
  const replacements: Record<string, string> = {
    id: adr.id,
    title: adr.title,
    date: adr.date,
    decision_status: adr.decisionStatus,
    implementation_status: adr.implementationStatus,
  };
  const operations = REQUIRED_FIELDS.map((field) => {
    const span = parsed.spans[field][0];
    const line = source.slice(span.start, span.end);
    return { ...span, text: line.replace(/^([A-Za-z_][\w-]*:\s*).*$/, `$1${singleLine(replacements[field])}`) };
  }).sort((a, b) => b.start - a.start);
  let result = source;
  for (const operation of operations) result = result.slice(0, operation.start) + operation.text + result.slice(operation.end);
  return result;
}

function singleLine(value: string): string { return value.replace(/[\r\n]+/g, ' ').trim(); }
