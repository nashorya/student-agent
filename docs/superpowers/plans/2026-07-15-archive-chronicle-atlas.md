# Archive Chronicle Atlas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat generated archive dashboard with the approved Chronicle Atlas timeline, minimap, command palette, safe Markdown detail routes, and accessible motion system.

**Architecture:** Build a deterministic `ArchiveChronicleModel` from the existing normalized `ArchiveProject`, then render all chronicle and detail content statically. A small self-contained client runtime enhances hash routing, command search, minimap progress, focus restoration, and Web Animations API transitions without becoming a second data source.

**Tech Stack:** TypeScript ESM, existing `marked` tokenizer, static HTML/CSS/SVG, browser History API, Web Animations API, IntersectionObserver, Vitest, Playwright.

---

## File Structure

Create:

- `src/archive/chronicle-model.ts` — deterministic timeline placement, relationships, routes, and minimap positions.
- `src/archive/safe-markdown.ts` — allowlisted Markdown-token renderer with escaped HTML and safe URLs.
- `src/archive/chronicle-runtime.ts` — self-contained browser runtime source for routing, search, filters, minimap, focus, and motion.
- `src/archive/__tests__/chronicle-model.test.ts` — placement and cross-link regression tests.
- `src/archive/__tests__/safe-markdown.test.ts` — Markdown rendering and injection safety tests.
- `src/archive/__tests__/chronicle-runtime.test.ts` — static runtime contract and script-context safety tests.
- `scripts/verify-dashboard-ui.ts` — Playwright desktop/mobile/hash/keyboard/reduced-motion verification.

Modify:

- `src/archive/html-renderer.ts` — compose the Chronicle Atlas document from the presentation model.
- `src/archive/__tests__/html-renderer.test.ts` — replace flat-dashboard expectations with Chronicle Atlas structure and safety assertions.
- `src/archive/__tests__/service.test.ts` — confirm ArchiveService builds the new document from an arbitrary root.
- `docs/dashboard.html` — regenerate deterministic output from repository Markdown.

Do not modify or commit:

- `awesome-design-md-main.zip`
- `awesome-design-md-main.zip:Zone.Identifier`
- `docs/adr/external_jspace_architecture_review.md:Zone.Identifier`

---

### Task 1: Build the Deterministic Chronicle Presentation Model

**Files:**

- Create: `src/archive/chronicle-model.ts`
- Create: `src/archive/__tests__/chronicle-model.test.ts`
- Modify: `src/archive/index.ts`

- [ ] **Step 1: Write failing placement and relationship tests**

Create `src/archive/__tests__/chronicle-model.test.ts` with a local fixture and these exact behavior cases:

```ts
import { describe, expect, it } from 'vitest';
import { buildChronicleModel, extractEntityIds, firstIsoDate } from '../chronicle-model.js';
import type { ArchiveProject } from '../types.js';

function project(values: Partial<ArchiveProject> = {}): ArchiveProject {
  return {
    root: '/project', title: 'Student Agent',
    indexPath: 'docs/INDEX.md', buglogPath: 'docs/buglog.md',
    adrDir: 'docs/adr', dashboardPath: 'docs/dashboard.html',
    timeline: [], adrs: [], bugs: [], evidence: [], sourceHashes: {},
    ...values,
  };
}

describe('chronicle model', () => {
  it('sorts by the first ISO date while preserving the visible range label', () => {
    const model = buildChronicleModel(project({ timeline: [
      { id: 'INDEX-2', date: '2026-07-14', title: 'Archive', summary: '', kind: 'change' },
      { id: 'INDEX-1', date: '2026-06-04 ~ 06', title: 'TUI', summary: '', kind: 'change' },
    ] }));
    expect(model.datedItems.map((item) => item.entityId)).toEqual(['INDEX-1', 'INDEX-2']);
    expect(model.datedItems[0]).toMatchObject({ dateLabel: '2026-06-04 ~ 06', sortDate: '2026-06-04' });
  });

  it('attaches a referenced ADR without creating a duplicate standalone item', () => {
    const model = buildChronicleModel(project({
      timeline: [{ id: 'INDEX-1', date: '2026-07-13', title: 'Ranking', summary: 'Implements ADR-005', kind: 'change' }],
      adrs: [{ id: 'ADR-005', title: 'Ranking protocol', date: '2026-07-13', decisionStatus: 'accepted', implementationStatus: 'verified', body: 'Body', sourcePath: 'docs/adr/ADR-005.md', history: [] }],
    }));
    expect(model.items.filter((item) => item.entityId === 'ADR-005')).toHaveLength(0);
    expect(model.items[0].relatedEntityIds).toContain('ADR-005');
    expect(model.entityRoutes['ADR-005']).toBe('#adr/ADR-005');
  });

  it('places a bug on the earliest exact BUG-ID reference', () => {
    const model = buildChronicleModel(project({
      timeline: [
        { id: 'INDEX-2', date: '2026-06-12', title: 'Closed BUG-007', summary: '', kind: 'change' },
        { id: 'INDEX-1', date: '2026-06-10', title: 'Found BUG-007', summary: '', kind: 'change' },
      ],
      bugs: [{ id: 'BUG-007', title: 'Probe credentials', status: 'CLOSED', symptom: 'Secret in history', evidence: [], history: [], sourcePath: 'docs/buglog.md' }],
    }));
    expect(model.datedItems[0].relatedEntityIds).toContain('BUG-007');
    expect(model.entityRoutes['BUG-007']).toBe('#bug/BUG-007');
  });

  it('places an unreferenced undated bug in the Undated group', () => {
    const model = buildChronicleModel(project({ bugs: [
      { id: 'BUG-011', title: 'Unknown date', status: 'OPEN', symptom: 'Symptom', evidence: [], history: [], sourcePath: 'docs/buglog.md' },
    ] }));
    expect(model.undatedItems).toHaveLength(1);
    expect(model.undatedItems[0]).toMatchObject({ entityId: 'BUG-011', dateLabel: 'Undated', route: '#bug/BUG-011' });
  });

  it('rejects partial identifier matches', () => {
    expect(extractEntityIds('ADR-005 ADR-0050 BUG-7 BUG-007')).toEqual(['ADR-005', 'BUG-007']);
  });

  it('extracts only a valid calendar date', () => {
    expect(firstIsoDate('2026-02-29 invalid')).toBeUndefined();
    expect(firstIsoDate('range 2026-06-04 ~ 06')).toBe('2026-06-04');
  });
});
```

- [ ] **Step 2: Run the model test and verify RED**

Run:

```bash
npx vitest run src/archive/__tests__/chronicle-model.test.ts
```

Expected: FAIL because `chronicle-model.ts` does not exist.

- [ ] **Step 3: Implement the model types and helpers**

Create `src/archive/chronicle-model.ts` with these public types and functions:

```ts
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

const ENTITY_PATTERN = /(?<![A-Z0-9-])(?:ADR-\d{3,}|BUG-\d{3,})(?![A-Z0-9-])/gi;

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
```

Implement `buildChronicleModel(project)` with this deterministic sequence:

```ts
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
```

`adrItem`, `bugItem`, `compareChronicleItems`, and `assignPositions` must follow these exact rules:

- ADR date comes from `adr.date`; statuses are decision and implementation status.
- Bug date comes from earliest exact timeline reference, then earliest valid history date, then undefined.
- Comparison order is `sortDate`, then kind order `timeline, adr, bug, verification`, then `entityId`.
- Minimap position is the inclusive day offset between start and end, clamped to `0..1`; a single-date archive uses `0.5`.

- [ ] **Step 4: Export the model API**

Add to `src/archive/index.ts`:

```ts
export * from './chronicle-model.js';
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npx vitest run src/archive/__tests__/chronicle-model.test.ts
npm run build
```

Expected: model tests pass and TypeScript compiles.

Commit:

```bash
git add src/archive/chronicle-model.ts src/archive/__tests__/chronicle-model.test.ts src/archive/index.ts
git commit -m "feat(archive): build deterministic chronicle model"
```

---

### Task 2: Render a Safe Markdown Subset for Detail Views

**Files:**

- Create: `src/archive/safe-markdown.ts`
- Create: `src/archive/__tests__/safe-markdown.test.ts`
- Modify: `src/archive/index.ts`

- [ ] **Step 1: Write failing safety and semantics tests**

Create `src/archive/__tests__/safe-markdown.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderSafeMarkdown } from '../safe-markdown.js';

describe('safe archive Markdown renderer', () => {
  it('renders the supported semantic subset', () => {
    const html = renderSafeMarkdown('# Decision\n\n- One\n- **Two**\n\n`code`\n\n```ts\nconst ok = true;\n```');
    expect(html).toContain('<h2>Decision</h2>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<strong>Two</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<pre><code class="language-ts">const ok = true;</code></pre>');
  });

  it('escapes raw HTML and scripts', () => {
    const html = renderSafeMarkdown('<script>alert(1)</script>\n\n<div>raw</div>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<div>raw</div>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('allows local, hash, HTTP, and HTTPS links', () => {
    const html = renderSafeMarkdown('[local](../INDEX.md) [hash](#adr/ADR-001) [web](https://example.com)');
    expect(html).toContain('href="../INDEX.md"');
    expect(html).toContain('href="#adr/ADR-001"');
    expect(html).toContain('href="https://example.com"');
  });

  it('renders unsafe link schemes as text', () => {
    const html = renderSafeMarkdown('[bad](javascript:alert(1))');
    expect(html).not.toContain('href=');
    expect(html).toContain('bad');
  });
});
```

- [ ] **Step 2: Run the Markdown test and verify RED**

Run:

```bash
npx vitest run src/archive/__tests__/safe-markdown.test.ts
```

Expected: FAIL because `safe-markdown.ts` does not exist.

- [ ] **Step 3: Implement token-based rendering**

Create `src/archive/safe-markdown.ts` using the existing `Marked` lexer, never `marked.parse()` output directly:

```ts
import { Marked, type Token, type Tokens } from 'marked';
import { escapeHtml } from './html-renderer.js';

const parser = new Marked({ gfm: true, breaks: false });

export function renderSafeMarkdown(source: string): string {
  if (!source.trim()) return '<p class="archive-empty">No detail content recorded.</p>';
  return parser.lexer(source).map(renderBlock).join('');
}

function renderBlock(token: Token): string {
  switch (token.type) {
    case 'heading': return `<h${Math.min(6, token.depth + 1)}>${renderInline(token.tokens ?? [])}</h${Math.min(6, token.depth + 1)}>`;
    case 'paragraph': return `<p>${renderInline(token.tokens ?? [])}</p>`;
    case 'code': return `<pre><code${token.lang ? ` class="language-${escapeHtml(token.lang.split(/\s+/)[0])}"` : ''}>${escapeHtml(token.text)}</code></pre>`;
    case 'blockquote': return `<blockquote>${(token.tokens ?? []).map(renderBlock).join('')}</blockquote>`;
    case 'list': return renderList(token);
    case 'hr': return '<hr>';
    case 'space': return '';
    case 'html': return `<pre class="archive-raw-html"><code>${escapeHtml('raw' in token ? String(token.raw) : '')}</code></pre>`;
    default: return 'text' in token && typeof token.text === 'string' ? `<p>${escapeHtml(token.text)}</p>` : '';
  }
}
```

Implement `renderList`, `renderListItem`, and `renderInline` recursively. Inline tokens must support text, strong, em, codespan, del, br, and link. Link output must use:

```ts
function safeHref(value: string): string | undefined {
  const href = value.trim();
  if (/^(?:https?:|#|\.\.?\/|\/)/i.test(href)) return href;
  if (/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(href)) return href;
  return undefined;
}
```

For unsafe links, return only the rendered link text. External HTTP(S) links receive `rel="noreferrer"`; no target is required.

- [ ] **Step 4: Remove the circular import before compilation**

Move `escapeHtml` from `src/archive/html-renderer.ts` into `src/archive/text-integrity.ts` or a new small `src/archive/html-escape.ts`. Prefer the new focused file:

```ts
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
```

Update imports in `html-renderer.ts`, `safe-markdown.ts`, and tests. Export it from `src/archive/index.ts` only if another subsystem already consumes it; otherwise keep it internal.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npx vitest run src/archive/__tests__/safe-markdown.test.ts src/archive/__tests__/html-renderer.test.ts
npm run build
```

Expected: Markdown and existing renderer tests pass.

Commit:

```bash
git add src/archive/html-escape.ts src/archive/safe-markdown.ts src/archive/html-renderer.ts src/archive/__tests__/safe-markdown.test.ts src/archive/__tests__/html-renderer.test.ts src/archive/index.ts
git commit -m "feat(archive): render safe Markdown details"
```

---

### Task 3: Replace the Flat Dashboard with Chronicle Atlas Static HTML

**Files:**

- Modify: `src/archive/html-renderer.ts`
- Modify: `src/archive/__tests__/html-renderer.test.ts`
- Modify: `src/archive/__tests__/service.test.ts`

- [ ] **Step 1: Replace flat-dashboard tests with failing Chronicle Atlas assertions**

Extend the renderer fixture with two timeline entries, one linked ADR, one standalone ADR, one referenced bug, and one undated bug. Add assertions:

```ts
it('renders Chronicle Atlas structure and deep-linked details', () => {
  const html = renderArchiveHtml(dashboardProject());
  expect(html).toContain('Chronicle Atlas');
  expect(html).toContain('class="archive-minimap"');
  expect(html).toContain('class="archive-timeline"');
  expect(html).toContain('<ol class="chronicle-list"');
  expect(html).toContain('href="#adr/ADR-001"');
  expect(html).toContain('id="adr/ADR-001"');
  expect(html).toContain('id="bug/BUG-001"');
  expect(html).toContain('data-command-palette');
  expect(html).toContain('Source integrity');
});

it('renders semantic undated content without guessing', () => {
  const html = renderArchiveHtml(dashboardProject());
  expect(html).toContain('id="undated-heading"');
  expect(html).toContain('Undated');
});

it('embeds only escaped JSON data', () => {
  const html = renderArchiveHtml(dashboardProject('</script><script>alert(1)</script>'));
  expect(html).not.toContain('</script><script>alert(1)</script>');
  expect(html).not.toMatch(/innerHTML\s*=/);
});

it('contains responsive and reduced-motion contracts', () => {
  const html = renderArchiveHtml(dashboardProject());
  expect(html).toContain('@media(max-width:767px)');
  expect(html).toContain('@media(prefers-reduced-motion:reduce)');
  expect(html).toContain('min-height:44px');
  expect(html).not.toContain('width:1440px');
});
```

Update `service.test.ts` to expect `Chronicle Atlas`, `archive-minimap`, and `#adr/ADR-001` rather than the old attention-only marker.

- [ ] **Step 2: Run renderer and service tests and verify RED**

Run:

```bash
npx vitest run src/archive/__tests__/html-renderer.test.ts src/archive/__tests__/service.test.ts
```

Expected: FAIL because the flat renderer does not produce Chronicle Atlas structure.

- [ ] **Step 3: Rebuild `renderArchiveHtml` around the model**

At the top of `renderArchiveHtml`:

```ts
const chronicle = buildChronicleModel(project);
const projectTitle = project.title ?? project.root.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Project archive';
const runtimeData = serializeRuntimeData(project, chronicle);
```

Compose the document from focused helpers:

```ts
export function renderArchiveHtml(project: ArchiveProject): string {
  const chronicle = buildChronicleModel(project);
  return `<!doctype html>
<html lang="en"><head>${renderHead(project)}</head>
<body>
  <a class="skip-link" href="#chronicle-main">Skip to archive chronicle</a>
  ${renderHeader(project, chronicle)}
  <main id="chronicle-main">
    ${renderHero(project, chronicle)}
    ${renderMinimap(chronicle)}
    ${renderChronicle(chronicle)}
    ${renderDetailViews(project, chronicle)}
    ${renderSourceIntegrity(project)}
  </main>
  ${renderCommandPalette(project, chronicle)}
  <div class="archive-live-region" aria-live="polite" aria-atomic="true"></div>
  <script type="application/json" id="archive-runtime-data">${runtimeData}</script>
  <script>${CHRONICLE_RUNTIME}</script>
</body></html>`;
}
```

`serializeRuntimeData` must escape `<`, `>`, `&`, U+2028, and U+2029 after `JSON.stringify`:

```ts
function serializeJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => ({
    '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029',
  }[character] ?? character));
}
```

- [ ] **Step 4: Implement Chronicle Atlas CSS tokens and components**

Use the approved token block from the design spec exactly. The renderer CSS must include:

```css
:root{
  color-scheme:dark;
  --canvas:#010102;--surface-1:#0f1011;--surface-2:#17181c;--surface-3:#202126;
  --hairline:#23252a;--hairline-strong:#34363e;
  --ink:#f7f8f8;--ink-muted:#d0d6e0;--ink-subtle:#8a8f98;--ink-tertiary:#62666d;
  --accent:#5e6ad2;--accent-hover:#828fff;--adr:#59d499;--bug:#ff6161;
  --warning:#ffc533;--focus:#aeb5ff;
  --content:min(100% - 32px,1280px);
}
*{box-sizing:border-box}
html{background:var(--canvas);scroll-behavior:smooth}
body{margin:0;background:var(--canvas);color:var(--ink);font:16px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:anywhere}
:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
button,a,input,select{font:inherit}
button,a{touch-action:manipulation}
```

Required component class contracts:

- `.archive-header`, `.archive-hero`, `.archive-stats`
- `.archive-minimap`, `.minimap-track`, `.minimap-marker`, `.minimap-progress`
- `.archive-timeline`, `.chronicle-list`, `.chronicle-item`, `.chronicle-node`, `.chronicle-card`
- `.entity-chip`, `.entity-chip--adr`, `.entity-chip--bug`, `.entity-chip--verification`
- `.archive-details`, `.archive-detail`, `.detail-facts`, `.detail-markdown`
- `.command-dialog`, `.command-input`, `.command-results`, `.command-result`
- `.source-hash-state`, `.archive-live-region`

The timeline must use `<ol>` and event links must be normal `<a href="#...">` anchors. Detail articles must be pre-rendered with IDs such as `adr/ADR-005` and must not receive the HTML `hidden` attribute during generation.

Progressive enhancement uses a runtime-owned root class:

```css
.archive-detail{display:block}
.has-js .archive-detail:not(.is-active){display:none}
.has-js .archive-chronicle-view.is-detail-open{display:none}
```

The runtime adds `has-js` to `document.documentElement` before applying route state. With JavaScript disabled, the timeline and every detail article remain readable in document order.

- [ ] **Step 5: Render safe detail bodies**

Use `renderSafeMarkdown` for ADR bodies. Bug detail body uses structured sections:

```ts
function renderBugBody(bug: ArchiveBug): string {
  return [
    sectionMarkdown('Symptom', bug.symptom),
    bug.rootCause ? sectionMarkdown('Root cause', bug.rootCause) : '',
    bug.fix ? sectionMarkdown('Fix', bug.fix) : '',
  ].join('');
}
```

All detail pages include source path and matching source hash when available.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npx vitest run src/archive/__tests__/chronicle-model.test.ts src/archive/__tests__/safe-markdown.test.ts src/archive/__tests__/html-renderer.test.ts src/archive/__tests__/service.test.ts
npm run build
```

Expected: all model, safety, renderer, and service tests pass.

Commit:

```bash
git add src/archive/html-renderer.ts src/archive/__tests__/html-renderer.test.ts src/archive/__tests__/service.test.ts
git commit -m "feat(archive): render Chronicle Atlas dashboard"
```

---

### Task 4: Add Hash Routing, Command Search, Minimap Progress, and Accessible Motion

**Files:**

- Create: `src/archive/chronicle-runtime.ts`
- Create: `src/archive/__tests__/chronicle-runtime.test.ts`
- Modify: `src/archive/html-renderer.ts`
- Modify: `src/archive/__tests__/html-renderer.test.ts`

- [ ] **Step 1: Write failing runtime contract tests**

Create `src/archive/__tests__/chronicle-runtime.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CHRONICLE_RUNTIME } from '../chronicle-runtime.js';

describe('Chronicle Atlas browser runtime', () => {
  it('implements hash routing, focus restoration, search, minimap, and reduced motion', () => {
    expect(CHRONICLE_RUNTIME).toContain('hashchange');
    expect(CHRONICLE_RUNTIME).toContain('popstate');
    expect(CHRONICLE_RUNTIME).toContain('requestAnimationFrame');
    expect(CHRONICLE_RUNTIME).toContain('IntersectionObserver');
    expect(CHRONICLE_RUNTIME).toContain('prefers-reduced-motion: reduce');
    expect(CHRONICLE_RUNTIME).toContain('archive:last-state');
    expect(CHRONICLE_RUNTIME).toContain('showModal');
  });

  it('does not use unsafe HTML mutation or string evaluation', () => {
    expect(CHRONICLE_RUNTIME).not.toMatch(/innerHTML\s*=/);
    expect(CHRONICLE_RUNTIME).not.toMatch(/outerHTML\s*=/);
    expect(CHRONICLE_RUNTIME).not.toMatch(/\beval\s*\(/);
    expect(CHRONICLE_RUNTIME).not.toMatch(/new Function/);
  });
});
```

Add renderer assertions for `type="application/json"`, `CHRONICLE_RUNTIME`, dialog labels, and route-aware detail classes.

- [ ] **Step 2: Run runtime tests and verify RED**

Run:

```bash
npx vitest run src/archive/__tests__/chronicle-runtime.test.ts src/archive/__tests__/html-renderer.test.ts
```

Expected: FAIL because `chronicle-runtime.ts` does not exist.

- [ ] **Step 3: Implement the self-contained runtime**

Create `src/archive/chronicle-runtime.ts`:

```ts
export const CHRONICLE_RUNTIME = String.raw`(() => {
  const dataNode = document.querySelector('#archive-runtime-data');
  const data = dataNode ? JSON.parse(dataNode.textContent || '{}') : { commands: [], routes: {} };
  const main = document.querySelector('#chronicle-main');
  const details = [...document.querySelectorAll('.archive-detail')];
  const originByRoute = new Map();
  const live = document.querySelector('.archive-live-region');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const dialog = document.querySelector('[data-command-palette]');
  const input = document.querySelector('[data-command-input]');
  const results = document.querySelector('[data-command-results]');
  let activeResult = 0;
  let frame = 0;

  const routeFromHash = () => decodeURIComponent(location.hash.slice(1));
  const detailForRoute = (route) => document.getElementById(route);
  const announce = (message) => { if (live) live.textContent = message; };

  function saveChronicleState() {
    sessionStorage.setItem('archive:last-state', JSON.stringify({
      scrollY: window.scrollY,
      query: document.querySelector('[data-archive-search]')?.value || '',
      type: document.querySelector('[data-type-filter]')?.value || 'all',
      status: document.querySelector('[data-status-filter]')?.value || 'all',
      focusId: document.activeElement?.id || '',
    }));
  }

  function showRoute(route, options = {}) {
    const detail = detailForRoute(route);
    details.forEach((node) => { node.hidden = node !== detail; });
    main?.classList.toggle('is-detail', Boolean(detail));
    if (!detail) {
      if (route) announce('Archive entry not found');
      restoreChronicleState();
      return;
    }
    detail.hidden = false;
    if (options.origin) originByRoute.set(route, options.origin);
    const heading = detail.querySelector('h1,h2');
    if (motion.matches) heading?.focus({ preventScroll: true });
    else animateSharedElement(options.origin, heading).finished.finally(() => heading?.focus({ preventScroll: true }));
  }

  function navigate(anchor) {
    const route = anchor.getAttribute('href')?.replace(/^#/, '');
    if (!route) return;
    saveChronicleState();
    history.pushState({ route }, '', '#' + encodeURI(route));
    showRoute(route, { origin: anchor.closest('.chronicle-card') });
  }

  // Implement restoreChronicleState, animateSharedElement, renderResults,
  // applyFilters, updateMinimap, revealChronicleItems, and dialog handlers below.
  document.documentElement.classList.add('has-js');
  showRoute(routeFromHash());
})();`;
```

Complete the named functions with these exact constraints:

- `restoreChronicleState`: parse `archive:last-state`, restore inputs, apply filters, use `requestAnimationFrame` before `scrollTo`, then restore focus by ID.
- `animateSharedElement`: return `{ finished: Promise.resolve() }` when reduced motion or missing nodes; otherwise clone with `cloneNode(true)`, copy source/target rects, animate transform and opacity for at most 380ms, then remove the clone.
- `renderResults`: create result buttons with `document.createElement`, `textContent`, `setAttribute`, and `append`; never interpolate project text into HTML.
- `applyFilters`: toggle `hidden` on chronicle items and matching minimap markers using type, status, and query data attributes.
- `updateMinimap`: read visible chronicle bounds once per animation frame and update only `transform: scaleX(...)` and `aria-current`.
- `revealChronicleItems`: use IntersectionObserver and a CSS custom property `--reveal-delay` capped at 240ms.
- Global shortcuts: `Meta/Ctrl + K` opens dialog; Escape closes; ArrowUp/ArrowDown change active result; Enter opens it.
- Normal route anchors use one delegated click listener; modified clicks are not intercepted.
- `hashchange` and `popstate` both call `showRoute(routeFromHash())`.

- [ ] **Step 4: Add runtime motion CSS**

Add:

```css
.chronicle-item{opacity:0;transform:translateY(14px)}
.chronicle-item.is-visible{animation:chronicle-reveal 280ms cubic-bezier(.2,.8,.2,1) var(--reveal-delay,0ms) both}
.minimap-progress{transform-origin:left center;will-change:transform}
.shared-transition{position:fixed;z-index:1000;pointer-events:none;will-change:transform,opacity}
@keyframes chronicle-reveal{to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  .chronicle-item{opacity:1;transform:none}
  .chronicle-item.is-visible{animation:none}
  .shared-transition{display:none}
}
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
npx vitest run src/archive/__tests__/chronicle-runtime.test.ts src/archive/__tests__/html-renderer.test.ts
npm run build
```

Expected: runtime contract tests pass and renderer compiles with the embedded script.

Commit:

```bash
git add src/archive/chronicle-runtime.ts src/archive/html-renderer.ts src/archive/__tests__/chronicle-runtime.test.ts src/archive/__tests__/html-renderer.test.ts
git commit -m "feat(archive): add chronicle navigation and motion"
```

---

### Task 5: Add Reproducible Playwright Browser Verification

**Files:**

- Create: `scripts/verify-dashboard-ui.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the browser verifier**

Create `scripts/verify-dashboard-ui.ts`:

```ts
#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const dashboardPath = resolve(process.argv[2] ?? 'docs/dashboard.html');
const browser = await chromium.launch({ headless: true });

try {
  for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: 'dark' });
    await page.goto(pathToFileURL(dashboardPath).href);
    const metrics = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    if (metrics.clientWidth !== metrics.scrollWidth) throw new Error(`${viewport.name} horizontal overflow: ${JSON.stringify(metrics)}`);
    await page.locator('a[href="#adr/ADR-005"]').first().click();
    await page.waitForFunction(() => location.hash === '#adr/ADR-005');
    await page.locator('#adr\\/ADR-005:not([hidden])').waitFor();
    await page.goBack();
    await page.waitForFunction(() => !location.hash);
    await page.close();
  }

  const keyboard = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await keyboard.goto(pathToFileURL(dashboardPath).href);
  await keyboard.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await keyboard.locator('[data-command-palette][open]').waitFor();
  await keyboard.locator('[data-command-input]').fill('ADR-005');
  await keyboard.keyboard.press('Enter');
  await keyboard.waitForFunction(() => location.hash === '#adr/ADR-005');
  const reduced = await keyboard.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (!reduced) throw new Error('Reduced-motion emulation was not active');
  console.log(JSON.stringify({ ok: true, dashboardPath }, null, 2));
  await keyboard.close();
} finally {
  await browser.close();
}
```

- [ ] **Step 2: Add the verification script**

Add to `package.json` scripts:

```json
"archive:verify-ui": "npx tsx scripts/verify-dashboard-ui.ts"
```

- [ ] **Step 3: Regenerate the repository dashboard**

Run:

```bash
npx tsx scripts/build-dashboard.ts
```

Expected counts for the current repository: 36 timeline entries, 7 ADRs, 10 bugs, and zero blocking validation errors.

- [ ] **Step 4: Run browser verification**

Run:

```bash
npm run archive:verify-ui -- docs/dashboard.html
```

Expected: JSON with `"ok": true`.

If the host lacks Playwright system libraries, install or provide them through the environment; do not weaken, skip, or delete the browser verifier. Record any environment-only gap explicitly.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-dashboard-ui.ts package.json docs/dashboard.html
git commit -m "test(archive): verify Chronicle Atlas in browsers"
```

---

### Task 6: Full Regression, Visual Review, and Delivery

**Files:**

- Modify only if verification finds a defect: `src/archive/**`, `scripts/verify-dashboard-ui.ts`, `docs/dashboard.html`

- [ ] **Step 1: Run the targeted archive suite**

```bash
npx vitest run src/archive src/core/pi-bridge/__tests__/archive-tool.test.ts src/cli/__tests__/command-parser.test.ts src/memory/tasks/__tests__/manager.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 2: Run full repository verification**

```bash
npm run build
npm test -- --run
python3 -m unittest tests/test_run_benchmark_comparison.py
npm run eval:validate
git diff --check
```

Expected: TypeScript passes; Vitest passes with only the existing intentional skip; Python passes 20 tests; eval validation succeeds with the existing no-reference skip; diff check is clean.

- [ ] **Step 3: Run browser verification and capture final screenshots**

```bash
npm run archive:verify-ui -- docs/dashboard.html
```

Capture full-page screenshots at:

- desktop: 1440×900;
- mobile: 390×844;
- reduced motion: 1280×800.

Verify visually:

- minimap markers align to the date range;
- timeline is readable and does not overlap;
- ADR and Bug chips remain legible without relying on color alone;
- detail routes preserve readable line length;
- command dialog has a visible active result and focus ring;
- mobile has no horizontal overflow;
- reduced-motion mode has no spatial reveal or shared-element travel.

- [ ] **Step 4: Verify repository scope**

Run:

```bash
git status --short
git diff --stat HEAD~5..HEAD
```

Confirm no commit contains the ZIP files or Zone.Identifier files listed in the plan's `Do not modify or commit` section.

- [ ] **Step 5: Request final code review**

Use `superpowers:requesting-code-review` against the implementation commit range. Fix every Critical and Important issue, rerun the relevant tests, and obtain approval.

- [ ] **Step 6: Complete the branch**

Use `superpowers:finishing-a-development-branch` after all verification and review gates pass.

---

## Plan Self-Review Checklist

- Spec coverage: data placement, minimap, timeline, details, hash routes, command search, safe Markdown, motion, reduced motion, responsive behavior, accessibility, failure states, source integrity, and deterministic output each have an implementation and verification task.
- Placeholder scan: no deferred implementation markers or unspecified test steps remain.
- Type consistency: `ArchiveChronicleItem`, `ArchiveChronicleModel`, `buildChronicleModel`, `renderSafeMarkdown`, and `CHRONICLE_RUNTIME` use the same names throughout.
- Dependency scope: no package dependency is added; the plan uses existing `marked`, Vitest, and Playwright packages.
- Safety: all project content is pre-rendered and escaped; client code uses DOM creation and `textContent`, not project-controlled `innerHTML`.
