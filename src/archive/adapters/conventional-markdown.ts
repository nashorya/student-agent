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
