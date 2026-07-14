import { describe, expect, it } from 'vitest';
import { parseConventionalAdr } from '../adapters/conventional-markdown.js';

describe('conventional Markdown adapter', () => {
  it('normalizes Chinese bold metadata and preserves the original body', () => {
    const source = '# ADR-003 · Priority\n\n- **日期**：2026-06-13\n- **状态**：已采纳\n\n## 背景\n原文。\n';
    const result = parseConventionalAdr(source, 'docs/adr/ADR-003.md');
    expect(result.entity).toMatchObject({ id: 'ADR-003', title: 'Priority', decisionStatus: 'accepted' });
    expect(result.entity.body).toBe(source);
    expect(result.canWrite).toBe(false);
  });

  it('allows writes only when every canonical metadata span is unique', () => {
    const source = '---\nid: ADR-009\ntitle: Choice\ndate: 2026-07-14\ndecision_status: proposed\nimplementation_status: planned\n---\nBody\n';
    expect(parseConventionalAdr(source, 'ADR-009.md').canWrite).toBe(true);
  });
});
