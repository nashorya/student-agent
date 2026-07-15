import { buildChronicleModel, type ArchiveChronicleItem, type ArchiveChronicleModel } from './chronicle-model.js';
import { escapeHtml } from './html-escape.js';
import { renderSafeMarkdown } from './safe-markdown.js';
import type { ArchiveAdr, ArchiveBug, ArchiveProject } from './types.js';

export { escapeHtml } from './html-escape.js';

export function renderArchiveHtml(project: ArchiveProject): string {
  const chronicle = buildChronicleModel(project);
  const projectTitle = project.title ?? project.root.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Project archive';
  const title = escapeHtml(projectTitle);
  const openBugs = project.bugs.filter((bug) => ['OPEN', 'REOPENED', 'INVESTIGATING'].includes(bug.status)).length;
  const acceptedAdrs = project.adrs.filter((adr) => adr.decisionStatus === 'accepted').length;
  const range = chronicle.startDate && chronicle.endDate
    ? `${chronicle.startDate} — ${chronicle.endDate}`
    : 'No dated entries';
  const runtimeData = serializeJson({
    commands: [
      ...project.timeline.map((entry) => ({
        id: entry.id,
        title: entry.title,
        subtitle: `${entry.date} · Timeline event`,
        type: 'timeline',
        route: `#event/${encodeURIComponent(entry.id)}`,
        search: `${entry.id} ${entry.date} ${entry.title} ${entry.summary}`.toLowerCase(),
      })),
      ...project.adrs.map((adr) => ({
        id: adr.id,
        title: adr.title,
        subtitle: `${adr.decisionStatus} · ${adr.implementationStatus}`,
        type: 'adr',
        route: `#adr/${adr.id}`,
        search: `${adr.id} ${adr.title} ${adr.decisionStatus} ${adr.implementationStatus} ${adr.body}`.toLowerCase(),
      })),
      ...project.bugs.map((bug) => ({
        id: bug.id,
        title: bug.title,
        subtitle: `${bug.status} · Bug`,
        type: 'bug',
        route: `#bug/${bug.id}`,
        search: `${bug.id} ${bug.title} ${bug.status} ${bug.symptom}`.toLowerCase(),
      })),
    ],
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#010102">
  <title>${title} · Chronicle Atlas</title>
  <style>${STYLES}</style>
</head>
<body>
  <a class="skip-link" href="#chronicle-main">Skip to archive chronicle</a>
  <div class="ambient ambient--one" aria-hidden="true"></div>
  <div class="ambient ambient--two" aria-hidden="true"></div>
  <header class="archive-header">
    <div class="archive-shell header-inner">
      <a class="brand" href="#" aria-label="Chronicle Atlas home">
        <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 5.5h18v21H7z"/><path d="M11 10h10M11 15h10M11 20h6"/></svg>
        <span>Chronicle Atlas</span>
      </a>
      <div class="header-range"><span class="status-light"></span><span>${escapeHtml(range)}</span></div>
      <button class="command-trigger" type="button" data-open-command aria-label="Open archive search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
        <span>Search archive</span><kbd>⌘ K</kbd>
      </button>
    </div>
  </header>

  <main id="chronicle-main">
    <section class="archive-hero archive-shell" aria-labelledby="archive-title">
      <div class="hero-copy">
        <p class="eyebrow"><span></span> Development memory, mapped</p>
        <h1 id="archive-title">The shape of<br><em>${title}</em></h1>
        <p class="hero-lede">Architecture decisions, bugs, fixes, and implementation milestones arranged on one continuous development timeline.</p>
      </div>
      <dl class="archive-stats" aria-label="Archive summary">
        ${stat(project.timeline.length, 'Events', 'The development record')}
        ${stat(project.adrs.length, 'ADRs', `${acceptedAdrs} accepted`)}
        ${stat(project.bugs.length, 'Bugs', `${openBugs} need attention`)}
      </dl>
    </section>

    <section class="archive-minimap-wrap" aria-label="Timeline minimap">
      <div class="archive-shell archive-minimap">
        <div class="minimap-label"><span>${escapeHtml(chronicle.startDate ?? 'Start')}</span><strong>Development span</strong><span>${escapeHtml(chronicle.endDate ?? 'Now')}</span></div>
        <div class="minimap-track">
          <span class="minimap-base"></span>
          <span class="minimap-progress"></span>
          ${renderMinimap(chronicle)}
        </div>
      </div>
    </section>

    <section class="archive-shell archive-chronicle-view" aria-labelledby="timeline-heading">
      <div class="archive-toolbar">
        <div>
          <p class="section-kicker">01 / Chronicle</p>
          <h2 id="timeline-heading">Development timeline</h2>
        </div>
        <div class="archive-controls" role="search">
          <label class="search-field" for="archive-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
            <span class="sr-only">Filter timeline</span>
            <input id="archive-search" data-archive-search type="search" autocomplete="off" placeholder="Filter timeline…">
          </label>
          <label class="select-field"><span class="sr-only">Entry type</span>
            <select data-type-filter><option value="all">All types</option><option value="timeline">Events</option><option value="adr">ADRs</option><option value="bug">Bugs</option></select>
          </label>
          <label class="select-field"><span class="sr-only">Status</span>
            <select data-status-filter><option value="all">All status</option><option value="open">Open</option><option value="closed">Closed</option><option value="proposed">Proposed</option><option value="accepted">Accepted</option><option value="verified">Verified</option></select>
          </label>
        </div>
      </div>
      <p class="result-count" data-result-count aria-live="polite">${chronicle.items.length} timeline entries</p>
      <div class="archive-timeline">
        <ol class="chronicle-list">
          ${renderChronicle(project, chronicle)}
        </ol>
      </div>
      ${chronicle.undatedItems.length ? `
      <section class="undated-section" aria-labelledby="undated-heading">
        <div class="undated-intro"><p class="section-kicker">Outside the date range</p><h2 id="undated-heading">Undated</h2><p>Recorded without inventing a timestamp.</p></div>
        <ol class="undated-list">${chronicle.undatedItems.map((item, index) => renderUndatedItem(project, chronicle, item, index)).join('')}</ol>
      </section>` : ''}
      ${renderSourceIntegrity(project)}
    </section>

    <section class="archive-details archive-shell" aria-label="Archive entry details">
      ${project.adrs.map((adr) => renderAdrDetail(project, adr)).join('')}
      ${project.bugs.map((bug) => renderBugDetail(project, bug)).join('')}
    </section>
  </main>

  <dialog class="command-dialog" data-command-palette aria-labelledby="command-title">
    <div class="command-head">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
      <label for="command-input" id="command-title" class="sr-only">Search every archive entry</label>
      <input id="command-input" data-command-input type="search" autocomplete="off" placeholder="Jump to an ADR, bug, or event…">
      <button type="button" class="dialog-close" data-command-close aria-label="Close search">ESC</button>
    </div>
    <div class="command-results" data-command-results role="listbox" aria-label="Archive search results"></div>
    <div class="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>↵</kbd> Open</span><span>Searches ${project.timeline.length + project.adrs.length + project.bugs.length} records</span></div>
  </dialog>

  <div class="archive-live-region sr-only" aria-live="polite" aria-atomic="true"></div>
  <script type="application/json" id="archive-runtime-data">${runtimeData}</script>
  <script>${CHRONICLE_RUNTIME}</script>
</body>
</html>`;
}

function stat(value: number, label: string, detail: string): string {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd><p>${escapeHtml(detail)}</p></div>`;
}

function renderMinimap(chronicle: ArchiveChronicleModel): string {
  return chronicle.datedItems.map((item) => {
    const route = routeForItem(item);
    const title = `${item.dateLabel} · ${item.entityId} · ${item.title}`;
    return `<a class="minimap-marker minimap-marker--${item.kind}" href="${escapeHtml(route)}" style="left:${(item.position * 100).toFixed(3)}%" data-marker-key="${escapeHtml(item.key)}" aria-label="${escapeHtml(title)}"><span></span></a>`;
  }).join('');
}

function renderChronicle(project: ArchiveProject, chronicle: ArchiveChronicleModel): string {
  return chronicle.datedItems.map((item, index) => renderChronicleItem(project, chronicle, item, index)).join('');
}

function renderChronicleItem(project: ArchiveProject, chronicle: ArchiveChronicleModel, item: ArchiveChronicleItem, index: number): string {
  const statusText = item.statuses.join(' ').toLowerCase();
  const searchText = `${item.entityId} ${item.dateLabel} ${item.title} ${item.summary} ${item.statuses.join(' ')} ${item.relatedEntityIds.join(' ')}`.toLowerCase();
  const route = routeForItem(item);
  const source = item.sourcePath ? `<span class="source-path">${escapeHtml(item.sourcePath)}</span>` : '';
  const mainLink = item.kind === 'adr' || item.kind === 'bug'
    ? `<a href="${escapeHtml(route)}">${escapeHtml(item.title)}</a>`
    : escapeHtml(item.title);
  return `
    <li class="chronicle-item" id="event-${domId(item.entityId)}" data-key="${escapeHtml(item.key)}" data-entity-id="${escapeHtml(item.entityId)}" data-entry-type="${item.kind}" data-status="${escapeHtml(statusText)}" data-search-text="${escapeHtml(searchText)}" style="--reveal-delay:${Math.min(index * 34, 238)}ms">
      <time datetime="${escapeHtml(item.sortDate ?? '')}"><strong>${escapeHtml(item.dateLabel)}</strong><span>${dateCaption(item.sortDate)}</span></time>
      <div class="chronicle-node chronicle-node--${item.kind}" aria-hidden="true"><span></span></div>
      <article class="chronicle-card chronicle-card--${item.kind}">
        <div class="card-topline"><span class="kind-label">${kindLabel(item.kind)}</span><code>${escapeHtml(item.entityId)}</code>${source}</div>
        <h3>${mainLink}</h3>
        <p>${escapeHtml(summary(item.summary))}</p>
        <div class="card-footer">
          <div class="status-list">${item.statuses.map((status) => statusPill(status)).join('')}${renderRelated(project, chronicle, item.relatedEntityIds)}</div>
          ${item.kind === 'adr' || item.kind === 'bug' ? `<a class="open-entry" href="${escapeHtml(route)}">Open record <span aria-hidden="true">↗</span></a>` : ''}
        </div>
      </article>
    </li>`;
}

function renderUndatedItem(project: ArchiveProject, chronicle: ArchiveChronicleModel, item: ArchiveChronicleItem, index: number): string {
  const route = routeForItem(item);
  const statusText = item.statuses.join(' ').toLowerCase();
  const searchText = `${item.entityId} ${item.title} ${item.summary} ${item.statuses.join(' ')}`.toLowerCase();
  return `<li class="undated-card" data-key="${escapeHtml(item.key)}" data-entity-id="${escapeHtml(item.entityId)}" data-entry-type="${item.kind}" data-status="${escapeHtml(statusText)}" data-search-text="${escapeHtml(searchText)}" style="--reveal-delay:${Math.min(index * 34, 238)}ms">
    <div class="card-topline"><span class="kind-label">${kindLabel(item.kind)}</span><code>${escapeHtml(item.entityId)}</code></div>
    <h3><a href="${escapeHtml(route)}">${escapeHtml(item.title)}</a></h3>
    <p>${escapeHtml(summary(item.summary))}</p>
    <div class="status-list">${item.statuses.map((status) => statusPill(status)).join('')}${renderRelated(project, chronicle, item.relatedEntityIds)}</div>
  </li>`;
}

function renderRelated(project: ArchiveProject, chronicle: ArchiveChronicleModel, ids: string[]): string {
  const known = new Set([...project.adrs.map((item) => item.id), ...project.bugs.map((item) => item.id)]);
  return ids.filter((id) => known.has(id)).map((id) => {
    const kind = id.startsWith('ADR-') ? 'adr' : 'bug';
    const route = chronicle.entityRoutes[id] ?? `#${kind}/${id}`;
    return `<a class="entity-chip entity-chip--${kind}" href="${escapeHtml(route)}"><span>${kind.toUpperCase()}</span> ${escapeHtml(id.replace(/^[A-Z]+-/, ''))}</a>`;
  }).join('');
}

function statusPill(status: string): string {
  const value = status.toLowerCase();
  const tone = /open|reopened|investigating|failed/.test(value)
    ? 'danger'
    : /accepted|verified|closed|fixed|passed/.test(value) ? 'positive' : 'neutral';
  return `<span class="status-pill status-pill--${tone}"><i></i>${escapeHtml(status.replace(/_/g, ' '))}</span>`;
}

function renderAdrDetail(project: ArchiveProject, adr: ArchiveAdr): string {
  return `
  <article class="archive-detail archive-detail--adr" id="adr/${escapeHtml(adr.id)}" data-detail-route="adr/${escapeHtml(adr.id)}">
    <a class="detail-back" href="#" data-back-to-chronicle><span aria-hidden="true">←</span> Back to timeline</a>
    <header class="detail-header">
      <p class="detail-type"><span class="detail-glyph">A</span> Architecture Decision Record <code>${escapeHtml(adr.id)}</code></p>
      <h1 tabindex="-1">${escapeHtml(adr.title)}</h1>
      <div class="detail-statuses">${statusPill(adr.decisionStatus)}${statusPill(adr.implementationStatus)}</div>
    </header>
    <dl class="detail-facts">
      <div><dt>Recorded</dt><dd>${escapeHtml(adr.date || 'Undated')}</dd></div>
      <div><dt>Decision</dt><dd>${escapeHtml(adr.decisionStatus)}</dd></div>
      <div><dt>Implementation</dt><dd>${escapeHtml(adr.implementationStatus.replace(/_/g, ' '))}</dd></div>
      <div><dt>Source</dt><dd>${escapeHtml(adr.sourcePath)}</dd></div>
    </dl>
    <div class="detail-grid">
      <div class="detail-markdown">${renderSafeMarkdown(adr.body)}</div>
      <aside class="detail-aside">
        ${renderHistory(adr.history)}
        ${renderHash(project, adr.sourcePath)}
      </aside>
    </div>
  </article>`;
}

function renderBugDetail(project: ArchiveProject, bug: ArchiveBug): string {
  return `
  <article class="archive-detail archive-detail--bug" id="bug/${escapeHtml(bug.id)}" data-detail-route="bug/${escapeHtml(bug.id)}">
    <a class="detail-back" href="#" data-back-to-chronicle><span aria-hidden="true">←</span> Back to timeline</a>
    <header class="detail-header">
      <p class="detail-type"><span class="detail-glyph">B</span> Bug Record <code>${escapeHtml(bug.id)}</code></p>
      <h1 tabindex="-1">${escapeHtml(bug.title)}</h1>
      <div class="detail-statuses">${statusPill(bug.status)}</div>
    </header>
    <dl class="detail-facts">
      <div><dt>Status</dt><dd>${escapeHtml(bug.status)}</dd></div>
      <div><dt>Evidence</dt><dd>${bug.evidence.length} record${bug.evidence.length === 1 ? '' : 's'}</dd></div>
      <div><dt>History</dt><dd>${bug.history.length} event${bug.history.length === 1 ? '' : 's'}</dd></div>
      <div><dt>Source</dt><dd>${escapeHtml(bug.sourcePath)}</dd></div>
    </dl>
    <div class="detail-grid">
      <div class="detail-markdown">
        <section><p class="markdown-label">Symptom</p>${renderSafeMarkdown(bug.symptom)}</section>
        ${bug.rootCause ? `<section><p class="markdown-label">Root cause</p>${renderSafeMarkdown(bug.rootCause)}</section>` : ''}
        ${bug.fix ? `<section><p class="markdown-label">Fix</p>${renderSafeMarkdown(bug.fix)}</section>` : ''}
        ${bug.evidence.length ? `<section><p class="markdown-label">Evidence</p><ul class="evidence-list">${bug.evidence.map((item) => `<li><span>${escapeHtml(item.status)}</span>${escapeHtml(item.summary)}</li>`).join('')}</ul></section>` : ''}
      </div>
      <aside class="detail-aside">
        ${renderHistory(bug.history)}
        ${renderHash(project, bug.sourcePath)}
      </aside>
    </div>
  </article>`;
}

function renderHistory(history: Array<{ at: string; summary: string; evidenceRef?: string }>): string {
  return `<section class="history-block"><p class="aside-label">History</p><ol>${
    history.length
      ? history.map((item) => `<li><time>${escapeHtml(item.at)}</time><p>${escapeHtml(item.summary)}</p>${item.evidenceRef ? `<code>${escapeHtml(item.evidenceRef)}</code>` : ''}</li>`).join('')
      : '<li class="archive-empty">No history recorded.</li>'
  }</ol></section>`;
}

function renderHash(project: ArchiveProject, sourcePath: string): string {
  const hash = project.sourceHashes[sourcePath];
  return `<section class="detail-hash"><p class="aside-label">Source integrity</p><code>${escapeHtml(hash ?? 'Hash unavailable')}</code></section>`;
}

function renderSourceIntegrity(project: ArchiveProject): string {
  const rows = Object.entries(project.sourceHashes);
  return `<details class="source-integrity">
    <summary><span><span class="status-light"></span> Source integrity</span><strong>${rows.length} verified files</strong></summary>
    <div class="source-hash-state">${rows.length ? rows.map(([path, hash]) => `<div><span>${escapeHtml(path)}</span><code>${escapeHtml(hash)}</code></div>`).join('') : '<p class="archive-empty">No source hashes recorded.</p>'}</div>
  </details>`;
}

function routeForItem(item: ArchiveChronicleItem): string {
  if (item.kind === 'adr' || item.kind === 'bug') return item.route;
  return `#event/${encodeURIComponent(item.entityId)}`;
}

function dateCaption(date?: string): string {
  if (!date) return 'No date';
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf())) return '';
  return escapeHtml(new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parsed));
}

function kindLabel(kind: ArchiveChronicleItem['kind']): string {
  return ({ timeline: 'Milestone', adr: 'Architecture', bug: 'Bug record', verification: 'Verification' })[kind];
}

function summary(value: string): string {
  const plain = value.replace(/[#*_`>\[\]()-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > 260 ? `${plain.slice(0, 257)}…` : plain;
}

function domId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '-');
}

function serializeJson(value: unknown): string {
  const replacements: Record<string, string> = {
    '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029',
  };
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => replacements[character] ?? character);
}

const STYLES = `
:root{
  color-scheme:dark;
  --canvas:#010102;--surface-1:#0f1011;--surface-2:#17181c;--surface-3:#202126;
  --hairline:#23252a;--hairline-strong:#34363e;
  --ink:#f7f8f8;--ink-muted:#d0d6e0;--ink-subtle:#8a8f98;--ink-tertiary:#62666d;
  --accent:#5e6ad2;--accent-hover:#828fff;--adr:#59d499;--bug:#ff6161;
  --warning:#ffc533;--focus:#aeb5ff;--positive:#59d499;
  --content:min(100% - 32px,1280px);--ease:cubic-bezier(.16,1,.3,1);
}
*{box-sizing:border-box}
html{background:var(--canvas);scroll-behavior:smooth}
body{margin:0;min-width:320px;background:var(--canvas);color:var(--ink);font:16px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:anywhere}
button,a,input,select{font:inherit}
button,a{touch-action:manipulation}
button{cursor:pointer}
a{color:inherit}
:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
::selection{background:rgba(94,106,210,.42);color:#fff}
.archive-shell{width:var(--content);margin-inline:auto}
.sr-only{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.skip-link{position:fixed;z-index:2000;left:16px;top:12px;transform:translateY(-140%);padding:10px 14px;border-radius:8px;background:var(--ink);color:var(--canvas);font-weight:700;transition:transform 180ms var(--ease)}
.skip-link:focus{transform:none}
.ambient{position:fixed;z-index:-1;border-radius:50%;filter:blur(120px);opacity:.12;pointer-events:none}
.ambient--one{width:440px;height:440px;left:-180px;top:180px;background:#5e6ad2}
.ambient--two{width:380px;height:380px;right:-220px;top:640px;background:#345f54}
.archive-header{position:sticky;z-index:100;top:0;border-bottom:1px solid rgba(52,54,62,.65);background:rgba(1,1,2,.82);backdrop-filter:blur(20px) saturate(140%)}
.header-inner{height:64px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:24px}
.brand{display:inline-flex;align-items:center;gap:11px;width:max-content;text-decoration:none;font-size:14px;font-weight:650;letter-spacing:-.01em}
.brand svg{width:26px;height:26px;fill:none;stroke:var(--ink);stroke-width:1.5}
.header-range{display:flex;align-items:center;justify-content:center;gap:9px;color:var(--ink-subtle);font:12px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace}
.status-light{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--positive);box-shadow:0 0 0 4px rgba(89,212,153,.08),0 0 16px rgba(89,212,153,.45)}
.command-trigger{justify-self:end;display:flex;align-items:center;gap:9px;min-height:40px;padding:5px 7px 5px 11px;border:1px solid var(--hairline-strong);border-radius:9px;background:rgba(23,24,28,.78);color:var(--ink-subtle);transition:border-color 180ms,background 180ms,color 180ms}
.command-trigger:hover{border-color:#50535d;background:var(--surface-2);color:var(--ink)}
.command-trigger svg,.search-field svg,.command-head svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.7}
kbd{display:inline-grid;place-items:center;min-width:25px;height:25px;padding:0 6px;border:1px solid var(--hairline-strong);border-bottom-color:#4d5059;border-radius:5px;background:var(--surface-3);color:var(--ink-muted);font:11px/1 ui-monospace,SFMono-Regular,Consolas,monospace;box-shadow:0 1px 0 rgba(255,255,255,.06)}
.archive-hero{min-height:540px;display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:96px;align-items:end;padding-block:112px 88px;border-bottom:1px solid var(--hairline)}
.hero-copy{max-width:880px}
.eyebrow,.section-kicker{margin:0 0 24px;color:var(--ink-subtle);font:600 11px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.12em;text-transform:uppercase}
.eyebrow{display:flex;align-items:center;gap:10px;color:var(--accent-hover)}
.eyebrow span{width:18px;height:1px;background:currentColor}
.archive-hero h1{margin:0;font-size:clamp(3.8rem,8.4vw,8rem);line-height:.88;letter-spacing:-.073em;font-weight:620}
.archive-hero h1 em{color:var(--ink-subtle);font:inherit;font-weight:420}
.hero-lede{max-width:690px;margin:38px 0 0;color:var(--ink-muted);font-size:clamp(1.05rem,1.55vw,1.3rem);line-height:1.55;letter-spacing:-.015em}
.archive-stats{display:grid;gap:0;margin:0;border-top:1px solid var(--hairline)}
.archive-stats div{padding:20px 0;border-bottom:1px solid var(--hairline);display:grid;grid-template-columns:1fr auto;align-items:end}
.archive-stats dt{color:var(--ink-subtle);font:600 11px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase;letter-spacing:.1em}
.archive-stats dd{grid-row:1/3;grid-column:2;margin:0;font-size:38px;line-height:1;font-weight:540;letter-spacing:-.05em;font-variant-numeric:tabular-nums}
.archive-stats p{margin:6px 0 0;color:var(--ink-tertiary);font-size:12px}
.archive-minimap-wrap{position:sticky;z-index:90;top:64px;background:rgba(1,1,2,.9);backdrop-filter:blur(18px);border-bottom:1px solid var(--hairline)}
.archive-minimap{padding-block:16px}
.minimap-label{display:flex;justify-content:space-between;align-items:center;margin-bottom:11px;color:var(--ink-tertiary);font:10px/1 ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase;letter-spacing:.08em}
.minimap-label strong{color:var(--ink-subtle);font-weight:600}
.minimap-track{position:relative;height:18px;margin-inline:10px}
.minimap-base,.minimap-progress{position:absolute;left:0;right:0;top:8px;height:2px;border-radius:2px}
.minimap-base{background:var(--hairline-strong)}
.minimap-progress{right:auto;width:100%;background:linear-gradient(90deg,var(--accent),var(--accent-hover));transform:scaleX(0);transform-origin:left center;will-change:transform}
.minimap-marker{position:absolute;z-index:2;top:-2px;width:20px;height:20px;transform:translateX(-50%);display:grid;place-items:center;text-decoration:none}
.minimap-marker span{display:block;width:6px;height:6px;border-radius:50%;border:1px solid #787b84;background:var(--canvas);transition:transform 180ms var(--ease),background 180ms,border-color 180ms}
.minimap-marker:hover span,.minimap-marker[aria-current="true"] span{transform:scale(1.8);background:var(--ink);border-color:var(--ink)}
.minimap-marker--adr span{border-color:var(--adr)}.minimap-marker--bug span{border-color:var(--bug)}
.archive-chronicle-view{padding-block:104px 88px}
.archive-toolbar{display:flex;align-items:end;justify-content:space-between;gap:40px;margin-bottom:14px}
.archive-toolbar h2,.undated-intro h2{margin:0;font-size:clamp(2rem,4vw,3.8rem);line-height:1;letter-spacing:-.055em;font-weight:560}
.archive-toolbar .section-kicker,.undated-intro .section-kicker{margin-bottom:14px}
.archive-controls{display:flex;gap:8px;align-items:center}
.search-field,.select-field{position:relative;display:flex;align-items:center;min-height:44px;border:1px solid var(--hairline-strong);border-radius:9px;background:var(--surface-1);color:var(--ink-subtle)}
.search-field{gap:8px;width:min(29vw,310px);padding:0 12px}
.search-field input{min-width:0;width:100%;border:0;outline:0;background:transparent;color:var(--ink)}
.search-field input::placeholder{color:var(--ink-tertiary)}
.select-field select{min-height:42px;padding:0 32px 0 12px;border:0;outline:0;background:transparent;color:var(--ink-muted);cursor:pointer}
.result-count{margin:0 0 34px;text-align:right;color:var(--ink-tertiary);font:11px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace}
.archive-timeline{position:relative}
.chronicle-list{position:relative;list-style:none;margin:0;padding:0}
.chronicle-list::before{content:"";position:absolute;top:0;bottom:0;left:168px;width:1px;background:linear-gradient(180deg,transparent,var(--hairline-strong) 3%,var(--hairline-strong) 97%,transparent)}
.chronicle-item{position:relative;display:grid;grid-template-columns:136px 32px minmax(0,1fr);gap:16px;align-items:start;min-width:0;padding:0 0 44px;opacity:0;transform:translateY(16px)}
.chronicle-item[hidden],.undated-card[hidden]{display:none}
.chronicle-item.is-visible{animation:chronicle-reveal 360ms var(--ease) var(--reveal-delay,0ms) both}
.chronicle-item time{display:block;padding-top:24px;text-align:right;font-variant-numeric:tabular-nums}
.chronicle-item time strong{display:block;color:var(--ink-muted);font:600 12px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace}
.chronicle-item time span{display:block;margin-top:5px;color:var(--ink-tertiary);font-size:11px}
.chronicle-node{position:relative;z-index:2;display:grid;place-items:center;height:64px}
.chronicle-node>span{width:9px;height:9px;border:2px solid var(--canvas);border-radius:50%;background:#737780;box-shadow:0 0 0 1px #737780}
.chronicle-node--adr>span{background:var(--adr);box-shadow:0 0 0 1px var(--adr),0 0 18px rgba(89,212,153,.22)}
.chronicle-node--bug>span{background:var(--bug);box-shadow:0 0 0 1px var(--bug),0 0 18px rgba(255,97,97,.2)}
.chronicle-card,.undated-card{min-width:0;padding:22px 24px 20px;border:1px solid var(--hairline);border-radius:12px;background:linear-gradient(145deg,rgba(23,24,28,.82),rgba(15,16,17,.72));box-shadow:0 1px 0 rgba(255,255,255,.025) inset;transition:transform 260ms var(--ease),border-color 260ms,background 260ms}
.chronicle-card:hover,.undated-card:hover{transform:translateY(-2px);border-color:var(--hairline-strong);background:linear-gradient(145deg,rgba(30,31,36,.94),rgba(15,16,17,.84))}
.chronicle-card--adr{border-left-color:rgba(89,212,153,.45)}.chronicle-card--bug{border-left-color:rgba(255,97,97,.5)}
.card-topline{display:flex;align-items:center;gap:10px;min-width:0;margin-bottom:13px;color:var(--ink-tertiary);font:10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase;letter-spacing:.08em}
.kind-label{color:var(--ink-subtle);font-weight:650}
.card-topline code{padding:3px 6px;border:1px solid var(--hairline);border-radius:4px;color:var(--ink-tertiary);font:inherit;letter-spacing:0}
.source-path{margin-left:auto;max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-transform:none;letter-spacing:0}
.chronicle-card h3,.undated-card h3{margin:0;font-size:clamp(1.18rem,2vw,1.55rem);line-height:1.25;letter-spacing:-.025em;font-weight:570}
.chronicle-card h3 a,.undated-card h3 a{text-decoration:none}.chronicle-card h3 a:hover,.undated-card h3 a:hover{color:var(--accent-hover)}
.chronicle-card>p,.undated-card>p{max-width:780px;margin:11px 0 0;color:var(--ink-subtle);font-size:14px;line-height:1.65}
.card-footer{display:flex;justify-content:space-between;gap:20px;align-items:end;margin-top:18px}
.status-list{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.status-pill,.entity-chip{display:inline-flex;align-items:center;gap:6px;min-height:26px;padding:3px 8px;border:1px solid var(--hairline-strong);border-radius:999px;background:rgba(1,1,2,.25);color:var(--ink-subtle);font:600 10px/1 ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase;text-decoration:none;letter-spacing:.035em}
.status-pill i{width:5px;height:5px;border-radius:50%;background:#777b84}.status-pill--positive i{background:var(--positive)}.status-pill--danger i{background:var(--bug)}
.entity-chip{min-height:30px;transition:border-color 180ms,color 180ms,background 180ms}
.entity-chip span{font-size:8px;letter-spacing:.08em}
.entity-chip--adr{border-color:rgba(89,212,153,.38);color:#a6e9c9}.entity-chip--bug{border-color:rgba(255,97,97,.38);color:#ff9d9d}
.entity-chip:hover{background:var(--surface-3);border-color:currentColor}
.open-entry{display:inline-flex;align-items:center;gap:8px;min-height:38px;padding-inline:4px;color:var(--ink-muted);font-size:12px;text-decoration:none;white-space:nowrap}
.open-entry span{transition:transform 180ms var(--ease)}.open-entry:hover{color:var(--ink)}.open-entry:hover span{transform:translate(2px,-2px)}
.undated-section{display:grid;grid-template-columns:240px minmax(0,1fr);gap:64px;margin-top:68px;padding-top:72px;border-top:1px solid var(--hairline)}
.undated-intro>p:last-child{color:var(--ink-tertiary);font-size:13px}
.undated-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;list-style:none;margin:0;padding:0}
.undated-card{padding:20px}
.source-integrity{margin-top:72px;border-top:1px solid var(--hairline);border-bottom:1px solid var(--hairline)}
.source-integrity summary{display:flex;justify-content:space-between;align-items:center;min-height:64px;cursor:pointer;color:var(--ink-subtle);font-size:13px}
.source-integrity summary>span{display:flex;align-items:center;gap:10px}.source-integrity summary strong{color:var(--ink-tertiary);font:500 11px ui-monospace,SFMono-Regular,Consolas,monospace}
.source-hash-state{padding:0 0 22px}.source-hash-state div{display:grid;grid-template-columns:minmax(180px,1fr) minmax(260px,2fr);gap:20px;padding:10px 0;border-top:1px solid var(--hairline);color:var(--ink-subtle);font-size:12px}.source-hash-state code{color:var(--ink-tertiary);font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
.archive-detail{display:block;padding-block:70px 110px}
.has-js .archive-detail:not(.is-active){display:none}
.has-js .archive-chronicle-view.is-detail-open{display:none}
.detail-back{display:inline-flex;align-items:center;gap:10px;min-height:44px;margin-bottom:64px;color:var(--ink-subtle);font-size:13px;text-decoration:none}.detail-back:hover{color:var(--ink)}
.detail-header{max-width:980px;padding-bottom:50px;border-bottom:1px solid var(--hairline)}
.detail-type{display:flex;align-items:center;gap:10px;margin:0 0 26px;color:var(--ink-subtle);font:600 11px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase;letter-spacing:.1em}
.detail-type code{color:var(--ink-tertiary);font:inherit}.detail-glyph{display:grid;place-items:center;width:24px;height:24px;border:1px solid currentColor;border-radius:6px;color:var(--adr)}.archive-detail--bug .detail-glyph{color:var(--bug)}
.detail-header h1{max-width:1000px;margin:0;font-size:clamp(3rem,7vw,7rem);line-height:.95;letter-spacing:-.065em;font-weight:590}
.detail-statuses{display:flex;gap:7px;margin-top:30px}
.detail-facts{display:grid;grid-template-columns:repeat(4,1fr);margin:0;border-bottom:1px solid var(--hairline)}
.detail-facts div{min-width:0;padding:22px 22px 22px 0;border-right:1px solid var(--hairline)}.detail-facts div+div{padding-left:22px}
.detail-facts div:last-child{border-right:0}.detail-facts dt{color:var(--ink-tertiary);font:600 10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase;letter-spacing:.1em}.detail-facts dd{margin:8px 0 0;color:var(--ink-muted);font-size:13px}
.detail-grid{display:grid;grid-template-columns:minmax(0,760px) minmax(240px,1fr);gap:clamp(48px,8vw,120px);padding-top:64px}
.detail-markdown{min-width:0;color:var(--ink-muted);font-size:16px;line-height:1.76}
.detail-markdown h2,.detail-markdown h3,.detail-markdown h4{margin:2em 0 .7em;color:var(--ink);line-height:1.2;letter-spacing:-.025em}.detail-markdown h2{font-size:2rem}.detail-markdown h3{font-size:1.45rem}.detail-markdown>h2:first-child,.detail-markdown>h3:first-child{margin-top:0}
.detail-markdown p{margin:0 0 1.2em}.detail-markdown a{color:var(--accent-hover);text-decoration-thickness:1px;text-underline-offset:3px}.detail-markdown strong{color:var(--ink);font-weight:620}.detail-markdown blockquote{margin:1.7em 0;padding:2px 0 2px 20px;border-left:2px solid var(--accent);color:var(--ink-subtle)}
.detail-markdown code{padding:2px 5px;border:1px solid var(--hairline);border-radius:4px;background:var(--surface-2);color:#d7daef;font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}.detail-markdown pre{max-width:100%;overflow:auto;padding:18px;border:1px solid var(--hairline);border-radius:10px;background:#090a0b}.detail-markdown pre code{padding:0;border:0;background:transparent;color:#d7dae2}
.detail-markdown ul,.detail-markdown ol{padding-left:1.4em}.detail-markdown li{margin:.45em 0}.detail-markdown hr{margin:2.2em 0;border:0;border-top:1px solid var(--hairline)}
.detail-markdown section{margin-bottom:48px}.markdown-label,.aside-label{margin:0 0 14px!important;color:var(--ink-tertiary)!important;font:650 10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace!important;text-transform:uppercase;letter-spacing:.12em}
.detail-table-wrap{max-width:100%;overflow:auto;border:1px solid var(--hairline);border-radius:8px}.detail-table-wrap table{width:100%;border-collapse:collapse}.detail-table-wrap th,.detail-table-wrap td{padding:10px 12px;border-bottom:1px solid var(--hairline);text-align:left;font-size:13px}.detail-table-wrap th{color:var(--ink);background:var(--surface-2)}
.detail-aside{min-width:0}.history-block,.detail-hash{padding:20px 0;border-top:1px solid var(--hairline)}
.history-block ol{list-style:none;margin:0;padding:0}.history-block li{position:relative;padding:0 0 20px 16px;border-left:1px solid var(--hairline)}.history-block li::before{content:"";position:absolute;left:-3px;top:5px;width:5px;height:5px;border-radius:50%;background:var(--ink-tertiary)}.history-block time{display:block;color:var(--ink-tertiary);font:10px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace}.history-block p{margin:6px 0 0;color:var(--ink-subtle);font-size:12px}.history-block code,.detail-hash code{display:block;color:var(--ink-tertiary);font:10px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}
.evidence-list{list-style:none!important;padding:0!important}.evidence-list li{display:grid;grid-template-columns:auto 1fr;gap:12px;padding:12px 0;border-bottom:1px solid var(--hairline)}.evidence-list span{color:var(--positive);font:10px ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase}
.command-dialog{width:min(calc(100% - 32px),680px);max-height:min(76vh,680px);margin:12vh auto 0;padding:0;border:1px solid #40434c;border-radius:14px;background:rgba(18,19,22,.98);color:var(--ink);box-shadow:0 36px 100px rgba(0,0,0,.68);overflow:hidden}
.command-dialog::backdrop{background:rgba(0,0,0,.66);backdrop-filter:blur(6px)}
.command-head{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;padding:13px 14px;border-bottom:1px solid var(--hairline)}.command-head{color:var(--ink-subtle)}.command-head input{width:100%;min-height:44px;border:0;outline:0;background:transparent;color:var(--ink);font-size:16px}.command-head input::placeholder{color:var(--ink-tertiary)}
.dialog-close{min-width:44px;min-height:32px;border:1px solid var(--hairline-strong);border-radius:6px;background:var(--surface-3);color:var(--ink-subtle);font:10px ui-monospace,SFMono-Regular,Consolas,monospace}
.command-results{max-height:480px;overflow:auto;padding:8px}.command-result{display:grid;grid-template-columns:34px 1fr auto;gap:11px;align-items:center;width:100%;min-height:62px;padding:8px 10px;border:0;border-radius:8px;background:transparent;color:var(--ink);text-align:left}.command-result.is-active,.command-result:hover{background:var(--surface-3)}
.command-icon{display:grid;place-items:center;width:32px;height:32px;border:1px solid var(--hairline-strong);border-radius:7px;color:var(--ink-subtle);font:650 11px ui-monospace,SFMono-Regular,Consolas,monospace}.command-result[data-type="adr"] .command-icon{color:var(--adr)}.command-result[data-type="bug"] .command-icon{color:var(--bug)}
.command-copy{min-width:0}.command-copy strong,.command-copy span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.command-copy strong{font-size:13px}.command-copy span{margin-top:3px;color:var(--ink-tertiary);font-size:11px}.command-id{color:var(--ink-tertiary);font:10px ui-monospace,SFMono-Regular,Consolas,monospace}
.command-empty{padding:44px;text-align:center;color:var(--ink-tertiary);font-size:13px}
.command-footer{display:flex;gap:18px;padding:10px 14px;border-top:1px solid var(--hairline);color:var(--ink-tertiary);font-size:10px}.command-footer span{display:flex;align-items:center;gap:5px}.command-footer span:last-child{margin-left:auto}.command-footer kbd{min-width:18px;height:18px;padding:0 3px;font-size:9px}
.shared-transition{position:fixed;z-index:1000;pointer-events:none;will-change:transform,opacity}
.archive-empty{color:var(--ink-tertiary);font-style:italic}
@keyframes chronicle-reveal{to{opacity:1;transform:none}}
@media(max-width:960px){
  .archive-hero{grid-template-columns:1fr;gap:60px;align-items:start}.archive-stats{grid-template-columns:repeat(3,1fr)}.archive-stats div{padding:18px;border-right:1px solid var(--hairline)}.archive-stats div:first-child{padding-left:0}.archive-stats div:last-child{border-right:0}.archive-stats dd{font-size:30px}
  .archive-toolbar{align-items:start;flex-direction:column}.archive-controls{width:100%}.search-field{width:auto;flex:1}.detail-grid{grid-template-columns:1fr}.detail-aside{display:grid;grid-template-columns:1fr 1fr;gap:32px}.undated-section{grid-template-columns:1fr;gap:30px}
}
@media(max-width:767px){
  :root{--content:min(100% - 24px,1280px)}
  .header-inner{grid-template-columns:1fr auto;height:58px}.header-range{display:none}.brand span{font-size:13px}.command-trigger{min-width:44px;padding:0;justify-content:center}.command-trigger>span,.command-trigger kbd{display:none}
  .archive-hero{min-height:auto;padding-block:72px 58px}.archive-hero h1{font-size:clamp(3.25rem,16vw,5.5rem)}.hero-lede{margin-top:28px}.archive-stats{grid-template-columns:1fr}.archive-stats div{padding:16px 0;border-right:0}.archive-minimap-wrap{top:58px}.minimap-label strong{display:none}
  .archive-chronicle-view{padding-block:68px}.archive-toolbar{gap:28px}.archive-controls{display:grid;grid-template-columns:1fr 1fr}.search-field{grid-column:1/-1}.archive-controls select{width:100%}.result-count{text-align:left}
  .chronicle-list::before{left:104px}.chronicle-item{grid-template-columns:76px 24px minmax(0,1fr);gap:8px;padding-bottom:28px}.chronicle-item time{padding-top:19px}.chronicle-item time strong{font-size:10px}.chronicle-item time span{font-size:9px}.chronicle-node{height:54px}
  .chronicle-card{padding:17px 16px}.source-path{display:none}.chronicle-card h3,.undated-card h3{font-size:1.1rem}.chronicle-card>p,.undated-card>p{font-size:13px}.card-footer{display:block}.open-entry{margin-top:10px}.entity-chip{min-height:28px}.undated-list{grid-template-columns:1fr}
  .source-hash-state div{grid-template-columns:1fr;gap:4px}.source-hash-state code{font-size:9px}
  .archive-detail{padding-block:38px 80px}.detail-back{margin-bottom:38px}.detail-header{padding-bottom:34px}.detail-header h1{font-size:clamp(2.8rem,14vw,5rem)}.detail-facts{grid-template-columns:1fr 1fr}.detail-facts div:nth-child(2){border-right:0}.detail-facts div:nth-child(n+3){border-top:1px solid var(--hairline)}.detail-grid{padding-top:42px}.detail-aside{grid-template-columns:1fr}.detail-markdown{font-size:15px}
  .command-dialog{margin-top:7vh}.command-footer span:last-child{display:none}
}
@media(prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}.ambient{display:none}.chronicle-item{opacity:1;transform:none}.chronicle-item.is-visible{animation:none}.shared-transition{display:none}*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
}
`;

const CHRONICLE_RUNTIME = String.raw`(() => {
  'use strict';
  const root = document.documentElement;
  root.classList.add('has-js');
  const dataNode = document.querySelector('#archive-runtime-data');
  let data = { commands: [] };
  try { data = dataNode ? JSON.parse(dataNode.textContent || '{}') : data; } catch (_) {}
  const commands = Array.isArray(data.commands) ? data.commands : [];
  const view = document.querySelector('.archive-chronicle-view');
  const details = Array.from(document.querySelectorAll('.archive-detail'));
  const items = Array.from(document.querySelectorAll('[data-entry-type][data-search-text]'));
  const markers = Array.from(document.querySelectorAll('[data-marker-key]'));
  const live = document.querySelector('.archive-live-region');
  const count = document.querySelector('[data-result-count]');
  const queryInput = document.querySelector('[data-archive-search]');
  const typeFilter = document.querySelector('[data-type-filter]');
  const statusFilter = document.querySelector('[data-status-filter]');
  const progress = document.querySelector('.minimap-progress');
  const dialog = document.querySelector('[data-command-palette]');
  const commandInput = document.querySelector('[data-command-input]');
  const results = document.querySelector('[data-command-results]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let activeResult = 0;
  let renderedCommands = [];
  let scrollFrame = 0;
  let lastOrigin = null;

  const announce = (message) => { if (live) live.textContent = message; };
  const routeFromHash = () => {
    try { return decodeURIComponent(location.hash.slice(1)); }
    catch (_) { return location.hash.slice(1); }
  };

  function saveChronicleState() {
    try {
      sessionStorage.setItem('archive:last-state', JSON.stringify({
        scrollY: window.scrollY,
        query: queryInput ? queryInput.value : '',
        type: typeFilter ? typeFilter.value : 'all',
        status: statusFilter ? statusFilter.value : 'all',
        focusId: document.activeElement && document.activeElement.id ? document.activeElement.id : '',
      }));
    } catch (_) {}
  }

  function restoreChronicleState() {
    let state = null;
    try { state = JSON.parse(sessionStorage.getItem('archive:last-state') || 'null'); } catch (_) {}
    if (!state) return;
    if (queryInput) queryInput.value = state.query || '';
    if (typeFilter) typeFilter.value = state.type || 'all';
    if (statusFilter) statusFilter.value = state.status || 'all';
    applyFilters();
    requestAnimationFrame(() => {
      window.scrollTo(0, Number(state.scrollY) || 0);
      if (state.focusId) {
        const focusTarget = document.getElementById(state.focusId);
        if (focusTarget) focusTarget.focus({ preventScroll: true });
      }
    });
  }

  function showRoute(route, options) {
    const detail = route ? document.getElementById(route) : null;
    details.forEach((node) => {
      const active = node === detail;
      node.classList.toggle('is-active', active);
      node.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    if (view) view.classList.toggle('is-detail-open', Boolean(detail));

    if (detail) {
      window.scrollTo(0, 0);
      const heading = detail.querySelector('h1');
      if (heading) {
        if (!reducedMotion.matches && heading.animate) {
          heading.animate(
            [{ opacity: 0, transform: 'translateY(22px) scale(.985)' }, { opacity: 1, transform: 'none' }],
            { duration: 380, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' }
          ).finished.finally(() => heading.focus({ preventScroll: true }));
        } else heading.focus({ preventScroll: true });
      }
      announce('Opened ' + route);
      return;
    }

    if (route.indexOf('event/') === 0) {
      const entityId = route.slice(6);
      const target = items.find((node) => node.dataset.entityId === entityId);
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
        target.classList.add('is-visible');
        const focusTarget = target.querySelector('a,button');
        if (focusTarget) focusTarget.focus({ preventScroll: true });
        announce('Focused timeline event ' + entityId);
      } else announce('Archive event not found');
      return;
    }

    if (route) announce('Archive entry not found');
    else restoreChronicleState();
  }

  function navigate(route, origin) {
    const cleanRoute = route.replace(/^#/, '');
    if (/^(adr|bug)\//.test(cleanRoute)) saveChronicleState();
    lastOrigin = origin || null;
    history.pushState({ archiveRoute: cleanRoute }, '', '#' + encodeURI(cleanRoute));
    showRoute(cleanRoute, { origin: lastOrigin });
  }

  function applyFilters() {
    const query = queryInput ? queryInput.value.trim().toLowerCase() : '';
    const type = typeFilter ? typeFilter.value : 'all';
    const status = statusFilter ? statusFilter.value : 'all';
    let visible = 0;
    items.forEach((item) => {
      const typeMatch = type === 'all' || item.dataset.entryType === type;
      const statusMatch = status === 'all' || (item.dataset.status || '').indexOf(status) >= 0;
      const queryMatch = !query || (item.dataset.searchText || '').indexOf(query) >= 0;
      item.hidden = !(typeMatch && statusMatch && queryMatch);
      if (!item.hidden) visible += 1;
    });
    markers.forEach((marker) => {
      const item = items.find((entry) => entry.dataset.key === marker.dataset.markerKey);
      marker.hidden = Boolean(item && item.hidden);
    });
    if (count) count.textContent = visible + (visible === 1 ? ' timeline entry' : ' timeline entries');
  }

  function updateMinimap() {
    scrollFrame = 0;
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    if (progress) progress.style.transform = 'scaleX(' + Math.max(0, Math.min(1, window.scrollY / max)) + ')';
    let active = null;
    let distance = Infinity;
    items.forEach((item) => {
      if (item.hidden) return;
      const nextDistance = Math.abs(item.getBoundingClientRect().top - window.innerHeight * .42);
      if (nextDistance < distance) { distance = nextDistance; active = item; }
    });
    markers.forEach((marker) => marker.setAttribute('aria-current', active && marker.dataset.markerKey === active.dataset.key ? 'true' : 'false'));
  }

  function requestMinimapUpdate() {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(updateMinimap);
  }

  function revealChronicleItems() {
    if (reducedMotion.matches || !('IntersectionObserver' in window)) {
      items.forEach((item) => item.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: .08 });
    items.forEach((item) => observer.observe(item));
  }

  function renderResults() {
    if (!results) return;
    const query = commandInput ? commandInput.value.trim().toLowerCase() : '';
    renderedCommands = commands.filter((command) => !query || String(command.search || '').indexOf(query) >= 0).slice(0, 14);
    activeResult = Math.max(0, Math.min(activeResult, renderedCommands.length - 1));
    results.textContent = '';
    if (!renderedCommands.length) {
      const empty = document.createElement('p');
      empty.className = 'command-empty';
      empty.textContent = 'No matching archive records';
      results.append(empty);
      return;
    }
    renderedCommands.forEach((command, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'command-result' + (index === activeResult ? ' is-active' : '');
      button.dataset.index = String(index);
      button.dataset.type = command.type;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', index === activeResult ? 'true' : 'false');
      const icon = document.createElement('span');
      icon.className = 'command-icon';
      icon.textContent = command.type === 'adr' ? 'A' : command.type === 'bug' ? 'B' : 'E';
      const copy = document.createElement('span');
      copy.className = 'command-copy';
      const title = document.createElement('strong');
      title.textContent = command.title;
      const subtitle = document.createElement('span');
      subtitle.textContent = command.subtitle;
      copy.append(title, subtitle);
      const id = document.createElement('code');
      id.className = 'command-id';
      id.textContent = command.id;
      button.append(icon, copy, id);
      results.append(button);
    });
  }

  function openCommand() {
    if (!dialog) return;
    activeResult = 0;
    renderResults();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    requestAnimationFrame(() => commandInput && commandInput.focus());
  }

  function closeCommand() {
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function moveResult(direction) {
    if (!renderedCommands.length) return;
    activeResult = (activeResult + direction + renderedCommands.length) % renderedCommands.length;
    renderResults();
    const active = results && results.querySelector('.command-result.is-active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function openResult(index) {
    const command = renderedCommands[index];
    if (!command) return;
    closeCommand();
    navigate(command.route, null);
  }

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const open = target.closest('[data-open-command]');
    if (open) { event.preventDefault(); openCommand(); return; }
    if (target.closest('[data-command-close]')) { event.preventDefault(); closeCommand(); return; }
    const result = target.closest('.command-result');
    if (result) { event.preventDefault(); openResult(Number(result.dataset.index)); return; }
    const back = target.closest('[data-back-to-chronicle]');
    if (back) {
      event.preventDefault();
      if (history.state && history.state.archiveRoute) history.back();
      else {
        history.replaceState({}, '', location.pathname + location.search);
        showRoute('');
      }
      return;
    }
    const anchor = target.closest('a[href^="#adr/"],a[href^="#bug/"],a[href^="#event/"]');
    if (!anchor || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(anchor.getAttribute('href') || '', anchor.closest('.chronicle-card,.undated-card'));
  });

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openCommand();
      return;
    }
    if (!dialog || !dialog.hasAttribute('open')) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); moveResult(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveResult(-1); }
    else if (event.key === 'Enter') { event.preventDefault(); openResult(activeResult); }
  });

  if (commandInput) commandInput.addEventListener('input', () => { activeResult = 0; renderResults(); });
  if (queryInput) queryInput.addEventListener('input', applyFilters);
  if (typeFilter) typeFilter.addEventListener('change', applyFilters);
  if (statusFilter) statusFilter.addEventListener('change', applyFilters);
  window.addEventListener('scroll', requestMinimapUpdate, { passive: true });
  window.addEventListener('resize', requestMinimapUpdate);
  window.addEventListener('hashchange', () => showRoute(routeFromHash()));
  window.addEventListener('popstate', () => showRoute(routeFromHash()));

  applyFilters();
  revealChronicleItems();
  updateMinimap();
  showRoute(routeFromHash());
})();`;
