import type { ArchiveAdr, ArchiveBug, ArchiveProject } from './types.js';

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderArchiveHtml(project: ArchiveProject): string {
  const waitingAdrs = project.adrs.filter((adr) => adr.decisionStatus === 'proposed' && adr.implementationStatus === 'verified');
  const openBugs = project.bugs.filter((bug) => bug.status === 'OPEN' || bug.status === 'REOPENED' || bug.status === 'INVESTIGATING');
  const title = escapeHtml(project.title ?? project.root.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Project archive');
  const generatedAt = latestDate(project) || 'No dated entries';
  const styles = `
:root{color-scheme:light;--bg:#f6f7f9;--surface:#fff;--surface-2:#edf1f4;--ink:#17212b;--muted:#586675;--line:#cbd3db;--accent:#087f5b;--accent-ink:#fff;--danger:#b42318;--warn:#8a4b08;--focus:#006ce0}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:0}
a{color:#075e54}.skip-link{position:absolute;left:12px;top:-64px;background:var(--ink);color:#fff;padding:12px;z-index:10}.skip-link:focus{top:12px}
header{border-bottom:1px solid var(--line);background:var(--surface)}.shell{width:min(100% - 32px,1280px);margin-inline:auto}.topbar{display:flex;justify-content:space-between;gap:24px;align-items:end;padding:24px 0}
h1,h2,h3{line-height:1.2;letter-spacing:0}h1{font-size:clamp(1.75rem,4vw,2.5rem);margin:4px 0}h2{font-size:1.35rem;margin:0 0 16px}h3{font-size:1rem;margin:0}.eyebrow{font-size:.78rem;font-weight:700;text-transform:uppercase;color:var(--accent)}.muted{color:var(--muted)}
main{padding:24px 0 48px}.health-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metric,.panel{background:var(--surface);border:1px solid var(--line);border-radius:8px}.metric{padding:16px}.metric strong{display:block;font-size:1.7rem;font-variant-numeric:tabular-nums}.metric span{color:var(--muted)}
.attention{margin-top:16px;padding:16px;border-left:4px solid var(--warn)}.attention-list{display:grid;gap:8px;margin:0;padding:0;list-style:none}.attention-item{background:var(--surface-2);padding:12px;border-radius:4px}.attention-item strong{margin-right:8px}
.controls{display:grid;grid-template-columns:minmax(220px,1fr) minmax(180px,280px);gap:12px;margin:24px 0 16px}.controls label{font-weight:600}.field{display:grid;gap:6px}input,select{width:100%;min-height:44px;border:1px solid #7b8794;border-radius:4px;background:var(--surface);color:var(--ink);padding:8px 12px;font:inherit}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px}.archive-section{margin-top:16px;padding:20px}.entry-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:12px}.entry{border-top:1px solid var(--line);padding:16px 0;min-width:0}.entry,.source-hash-state{overflow-wrap:anywhere}.entry p{margin:8px 0}.entry-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.badge{display:inline-flex;align-items:center;min-height:28px;border:1px solid currentColor;border-radius:999px;padding:2px 9px;font-size:.78rem;font-weight:700}.badge.attention{color:var(--warn);margin:0;border-left-width:1px}.badge.danger{color:var(--danger)}.badge.good{color:var(--accent)}code{overflow-wrap:anywhere}.source-hash-state{font-family:ui-monospace,monospace;font-size:.78rem}.empty{color:var(--muted);font-style:italic}
@media(max-width:900px){.health-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:720px){.shell{width:min(100% - 24px,1280px)}.topbar{align-items:start;flex-direction:column}.health-grid,.controls{grid-template-columns:1fr}.archive-section{padding:16px}.entry-list{display:block}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Project Health</title><style>${styles}</style></head>
<body><a class="skip-link" href="#main-content">Skip to archive content</a><header><div class="shell topbar"><div><div class="eyebrow">Development archive</div><h1>${title}</h1><div class="muted">Canonical Markdown, human-readable health view</div></div><div class="muted">Latest archive date: ${escapeHtml(generatedAt)}</div></div></header>
<main id="main-content"><div class="shell"><section aria-labelledby="health-heading"><h2 id="health-heading">Project Health</h2><div class="health-grid">
${metric(project.timeline.length, 'Timeline events')}${metric(openBugs.length, 'Open attention bugs')}${metric(project.adrs.length, 'Architecture decisions')}${metric(project.evidence.filter((item) => item.status === 'passed').length, 'Passed verifications')}
</div><div class="panel attention"><h3>Attention</h3><ul class="attention-list">${attentionItems(waitingAdrs, openBugs)}</ul></div></section>
<div class="controls" role="search"><div class="field"><label for="archive-search">Search archive</label><input id="archive-search" type="search" autocomplete="off" placeholder="Search ID, title, status, or summary"></div><div class="field"><label for="archive-filter">Entry type</label><select id="archive-filter" aria-label="Filter archive entries"><option value="all">All entries</option><option value="timeline">Timeline</option><option value="bug">Bugs</option><option value="adr">ADRs</option><option value="verification">Verification</option></select></div></div>
${renderTimeline(project)}${renderBugs(project)}${renderAdrs(project)}${renderEvidence(project)}
<section class="panel archive-section source-hash-state" aria-labelledby="integrity-heading"><h2 id="integrity-heading">Source integrity</h2>${Object.entries(project.sourceHashes).map(([path, hash]) => `<div>${escapeHtml(path)} · ${escapeHtml(hash)}</div>`).join('') || '<div class="empty">No source hashes recorded.</div>'}</section>
</div></main><script>${FILTER_SCRIPT}</script></body></html>`;
}

function metric(value: number, label: string): string { return `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`; }
function searchable(type: string, text: string): string { return `data-entry-type="${type}" data-search-text="${escapeHtml(text.toLowerCase())}"`; }
function statusBadge(status: string, tone = ''): string { return `<span class="badge ${tone}">${escapeHtml(status)}</span>`; }

function attentionItems(adrs: ArchiveAdr[], bugs: ArchiveBug[]): string {
  const items = [
    ...adrs.map((adr) => `<li class="attention-item"><strong>ADR waiting for acceptance</strong>${escapeHtml(adr.id)} · ${escapeHtml(adr.title)}</li>`),
    ...bugs.map((bug) => `<li class="attention-item"><strong>${escapeHtml(bug.status)} bug</strong>${escapeHtml(bug.id)} · ${escapeHtml(bug.title)}</li>`),
  ];
  return items.join('') || '<li class="empty">No archive items need attention.</li>';
}

function renderTimeline(project: ArchiveProject): string {
  return section('timeline', 'Timeline', project.timeline.map((entry) => `<article class="entry" ${searchable('timeline', `${entry.id} ${entry.date} ${entry.title} ${entry.summary}`)}><div class="entry-meta">${statusBadge(entry.date, 'good')}<strong>${escapeHtml(entry.title)}</strong></div><p>${escapeHtml(entry.summary)}</p></article>`));
}
function renderBugs(project: ArchiveProject): string {
  return section('bugs', 'Bugs', project.bugs.map((bug) => `<article class="entry" ${searchable('bug', `${bug.id} ${bug.title} ${bug.status} ${bug.symptom}`)}><div class="entry-meta"><strong>${escapeHtml(bug.id)} · ${escapeHtml(bug.title)}</strong>${statusBadge(bug.status, bug.status === 'OPEN' ? 'danger' : '')}</div><p>${escapeHtml(bug.symptom)}</p>${bug.rootCause ? `<p><strong>Root cause:</strong> ${escapeHtml(bug.rootCause)}</p>` : ''}${bug.fix ? `<p><strong>Fix:</strong> ${escapeHtml(bug.fix)}</p>` : ''}</article>`));
}
function renderAdrs(project: ArchiveProject): string {
  return section('adrs', 'Architecture decisions', project.adrs.map((adr) => `<article class="entry" ${searchable('adr', `${adr.id} ${adr.title} ${adr.decisionStatus} ${adr.implementationStatus} ${adr.body}`)}><div class="entry-meta"><strong>${escapeHtml(adr.id)} · ${escapeHtml(adr.title)}</strong>${statusBadge(adr.decisionStatus, adr.decisionStatus === 'proposed' ? 'attention' : 'good')}${statusBadge(adr.implementationStatus)}</div><p>${escapeHtml(adr.body)}</p></article>`));
}
function renderEvidence(project: ArchiveProject): string {
  return section('verification', 'Verification', project.evidence.map((item) => `<article class="entry" ${searchable('verification', `${item.id} ${item.status} ${item.summary}`)}><div class="entry-meta"><strong>${escapeHtml(item.id)}</strong>${statusBadge(item.status, item.status === 'passed' ? 'good' : 'danger')}</div><p>${escapeHtml(item.summary)}</p></article>`));
}
function section(id: string, heading: string, entries: string[]): string {
  return `<section class="panel archive-section" aria-labelledby="${id}-heading"><h2 id="${id}-heading">${heading}</h2><div class="entry-list">${entries.join('') || '<p class="empty">No entries recorded.</p>'}</div></section>`;
}
function latestDate(project: ArchiveProject): string { return [...project.timeline.map((item) => item.date), ...project.adrs.map((item) => item.date)].filter(Boolean).sort().at(-1) ?? ''; }

const FILTER_SCRIPT = `(()=>{const q=document.querySelector('#archive-search');const f=document.querySelector('#archive-filter');const entries=[...document.querySelectorAll('[data-entry-type]')];const apply=()=>{const term=q.value.trim().toLowerCase();const type=f.value;for(const entry of entries){entry.hidden=!((type==='all'||entry.dataset.entryType===type)&&(!term||entry.dataset.searchText.includes(term)));}};q.addEventListener('input',apply);f.addEventListener('change',apply);})();`;
