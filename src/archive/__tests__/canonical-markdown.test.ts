import { describe, expect, it } from 'vitest';
import { parseAdrMarkdown, parseBuglogMarkdown, parseIndexMarkdown } from '../adapters/canonical-markdown.js';

describe('canonical Markdown adapter', () => {
  it('normalizes frontmatter ADR metadata', () => {
    const adr = parseAdrMarkdown('---\nid: ADR-012\ntitle: Adapter architecture\ndate: 2026-07-14\ndecision_status: proposed\nimplementation_status: verified\n---\n\n## Context\nBody.\n', 'docs/adr/ADR-012.md');
    expect(adr).toMatchObject({ id: 'ADR-012', title: 'Adapter architecture', decisionStatus: 'proposed', implementationStatus: 'verified' });
    expect(adr.body).toContain('## Context');
  });

  it('reads bug sections and uses the latest status', () => {
    const bugs = parseBuglogMarkdown('## BUG-012 · Broken archive\n\n**状态**：OPEN\n**症状**：Binary Markdown\n\n**状态**：FIXED\n**验证**：passed: test\n', 'docs/buglog.md');
    expect(bugs[0]).toMatchObject({ id: 'BUG-012', title: 'Broken archive', status: 'FIXED', symptom: 'Binary Markdown' });
    expect(bugs[0].evidence[0]).toMatchObject({ kind: 'verification', status: 'passed' });
  });

  it('reads INDEX table rows', () => {
    const timeline = parseIndexMarkdown('| 日期 | 事件 |\n|---|---|\n| 2026-07-14 | Archive implemented |\n', 'docs/INDEX.md');
    expect(timeline[0]).toMatchObject({ date: '2026-07-14', title: 'Archive implemented' });
  });
});
