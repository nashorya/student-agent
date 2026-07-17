import { describe, expect, it } from 'vitest';
import { renderArchiveHtml } from '../html-renderer.js';
import type { ArchiveProject } from '../types.js';

function dashboardProject(title = 'Student Agent'): ArchiveProject {
  return {
    root: '/project', title, indexPath: 'docs/INDEX.md', buglogPath: 'docs/buglog.md', adrDir: 'docs/adr', dashboardPath: 'docs/dashboard.html',
    timeline: [{ id: 'INDEX-1', date: '2026-07-14', title: 'Archive implemented', summary: 'Human view added', kind: 'change' }],
    adrs: [{ id: 'ADR-001', title: 'Archive architecture', date: '2026-07-14', decisionStatus: 'proposed', implementationStatus: 'verified', body: 'Adapters separate formats.', sourcePath: 'docs/adr/ADR-001.md', history: [] }],
    bugs: [{ id: 'BUG-001', title: 'Binary Markdown', status: 'OPEN', symptom: 'Markdown became binary', evidence: [], history: [], sourcePath: 'docs/buglog.md' }],
    evidence: [{ id: 'test-1', kind: 'verification', status: 'passed', summary: 'Archive tests pass' }],
    sourceHashes: { 'docs/INDEX.md': 'abc123' },
  };
}

describe('archive HTML renderer', () => {
  it('renders health, attention, search, filters, and full entry data', () => {
    const html = renderArchiveHtml(dashboardProject());
    expect(html).toContain('Project Health');
    expect(html).toContain('ADR waiting for acceptance');
    expect(html).toContain('OPEN bug');
    expect(html).toContain('data-search-text=');
    expect(html).toContain('aria-label="Filter archive entries"');
    expect(html).toContain('source-hash-state');
    expect(html).toContain('Adapters separate formats.');
  });

  it('escapes project-controlled HTML', () => {
    const html = renderArchiveHtml(dashboardProject('<script>alert(1)</script>'));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('provides accessible landmarks and responsive interaction styles', () => {
    const html = renderArchiveHtml(dashboardProject());
    expect(html).toMatch(/<header[ >]/);
    expect(html).toContain('<main id="main-content">');
    expect(html).toContain('class="skip-link"');
    expect(html).toContain(':focus-visible');
    expect(html).toContain('min-height:44px');
    expect(html).toContain('@media(max-width:720px)');
    expect(html).toContain('@media(prefers-reduced-motion:reduce)');
    expect(html).toContain('.entry,.source-hash-state{overflow-wrap:anywhere}');
    expect(html).not.toContain('width:1440px');
  });

  it('never injects project data through innerHTML', () => {
    const html = renderArchiveHtml(dashboardProject());
    expect(html).not.toMatch(/innerHTML\s*=/);
  });
});
