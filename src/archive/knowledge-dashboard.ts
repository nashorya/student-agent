/**
 * Chronicle Dashboard — visual board with SSR so the page is never empty without JS.
 * Tabs still enhance client-side; core board/timeline/answers are server-rendered.
 */
import type { ChronicleGraph, GraphEdge, GraphNode } from './knowledge-graph.js';
import { escapeHtml } from './html-escape.js';

const EDGE_LABEL: Record<string, string> = {
  requires: '前提',
  produces: '产出',
  exposes: '暴露',
  motivates: '动机',
  tombstones: '否决/墓碑',
  verifies: '验证',
};

export function renderKnowledgeDashboardHtml(graph: ChronicleGraph, projectTitle = 'Student Agent'): string {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const requires = graph.edges.filter((e) => e.kind === 'requires');

  const isClosed = (id: string): boolean => {
    const n = byId.get(id);
    if (!n) return false;
    return n.tombstone === true || /CLOSED|DONE|FIXED|合页|关案/i.test(n.status);
  };
  const prereqsOf = (id: string) => requires.filter((e) => e.from === id).map((e) => e.to);

  const phases = graph.nodes.filter((n) => n.kind === 'phase').sort((a, b) => a.id.localeCompare(b.id));
  const findings = graph.nodes.filter((n) => n.kind === 'finding' && !n.tombstone);
  const boardNodes = [...phases, ...findings];

  const bucket = (n: GraphNode): 'done' | 'ready' | 'blocked' => {
    if (isClosed(n.id)) return 'done';
    const pre = prereqsOf(n.id);
    if (pre.length && !pre.every(isClosed)) return 'blocked';
    if (graph.nextActions.includes(n.id) || /PLANNED|OPEN|BLOCKED|UNKNOWN/i.test(n.status)) return 'ready';
    return 'blocked';
  };

  const cols = { done: [] as GraphNode[], ready: [] as GraphNode[], blocked: [] as GraphNode[] };
  for (const n of boardNodes) cols[bucket(n)].push(n);

  const cardHtml = (n: GraphNode): string => {
    const pre = prereqsOf(n.id);
    const preText = pre.length
      ? pre.map((id) => {
        const ok = isClosed(id);
        return `<span class="badge ${ok ? 'p' : 'b'}">${ok ? '✓' : '✗'} ${escapeHtml(id)}</span>`;
      }).join(' ')
      : '<span class="muted">无硬前置</span>';
    return `<div class="card" data-id="${escapeHtml(n.id)}">
      <div class="id">${escapeHtml(n.id)} · ${escapeHtml(n.status)}</div>
      <div class="title">${escapeHtml(n.title)}</div>
      <div class="muted small">${escapeHtml((n.summary || '').slice(0, 160))}</div>
      <div class="req"><strong>前置 / 需求</strong><br>${preText}</div>
    </div>`;
  };

  // Timeline
  const camps = graph.nodes
    .filter((n) => n.kind === 'campaign' && n.date)
    .map((n) => ({ n, sort: firstIso(n.date!) }))
    .filter((x): x is { n: GraphNode; sort: string } => Boolean(x.sort))
    .sort((a, b) => a.sort.localeCompare(b.sort));
  const shown = thin(camps, 28);
  let ticks = '';
  if (shown.length) {
    const t0 = Date.parse(`${shown[0].sort}T00:00:00Z`);
    const t1 = Date.parse(`${shown[shown.length - 1].sort}T00:00:00Z`) || t0 + 1;
    ticks = shown.map((item, i) => {
      const x = 4 + ((Date.parse(`${item.sort}T00:00:00Z`) - t0) / Math.max(1, t1 - t0)) * 92;
      return `<div class="tick${i % 2 ? ' above' : ''}" style="left:${x}%" title="${escapeHtml(item.n.title)}">
        <div class="tip"><div class="muted">${escapeHtml(item.n.date || '')}</div>${escapeHtml(item.n.title)}</div>
        <div class="date">${escapeHtml(shortDate(item.n.date || item.sort))}</div>
      </div>`;
    }).join('');
  }

  // SVG dependency layout (SSR)
  const focus: GraphNode[] = [];
  const seen = new Set<string>();
  const addFocus = (id: string) => {
    const n = byId.get(id);
    if (!n || seen.has(id)) return;
    seen.add(id);
    focus.push(n);
  };
  for (const p of phases) addFocus(p.id);
  for (const id of [
    'finding:injection-effect-experiment',
    'finding:jspace-external',
    'finding:c2-cache-prefix',
  ]) addFocus(id);
  for (const n of graph.nodes.filter((x) => x.tombstone).slice(0, 6)) addFocus(n.id);
  for (const e of graph.edges) {
    if (e.kind === 'requires' || e.kind === 'tombstones') {
      addFocus(e.from);
      addFocus(e.to);
    }
  }

  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  phases.forEach((n, i) => {
    pos.set(n.id, { x: 60 + i * 170, y: 200, w: 150, h: 58 });
  });
  let row = 0;
  let col = 0;
  for (const n of focus) {
    if (pos.has(n.id)) continue;
    pos.set(n.id, {
      x: 60 + col * 200,
      y: n.tombstone ? 380 : row === 0 ? 50 : 330,
      w: 180,
      h: 54,
    });
    col += 1;
    if (col >= 5) {
      col = 0;
      row += 1;
    }
  }

  const svgEdges = graph.edges.filter(
    (e) => pos.has(e.from) && pos.has(e.to)
      && (e.kind === 'requires' || e.kind === 'tombstones' || e.kind === 'produces' || e.kind === 'verifies'),
  );
  const svgLines = svgEdges.map((e) => {
    const a = pos.get(e.from)!;
    const b = pos.get(e.to)!;
    return `<line class="edge ${escapeHtml(e.kind)}" x1="${a.x + a.w / 2}" y1="${a.y + a.h / 2}" x2="${b.x + b.w / 2}" y2="${b.y + b.h / 2}" />`;
  }).join('\n');
  const svgNodes = focus.map((n) => {
    const p = pos.get(n.id)!;
    return `<g class="hit" data-id="${escapeHtml(n.id)}">
      <rect class="nrect ${escapeHtml(n.kind)}${n.tombstone ? ' tomb' : ''}" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="10" />
      <text x="${p.x + 10}" y="${p.y + 22}">${escapeHtml(n.id.length > 22 ? `${n.id.slice(0, 20)}…` : n.id)}</text>
      <text class="sub" x="${p.x + 10}" y="${p.y + 40}">${escapeHtml((n.title || '').slice(0, 22))}</text>
    </g>`;
  }).join('\n');

  const edgeCards = svgEdges.slice(0, 40).map((e) => {
    const label = EDGE_LABEL[e.kind] || e.kind;
    return `<div class="card">
      <div class="id">${escapeHtml(label)} · ${escapeHtml(e.kind)}</div>
      <div class="title"><code>${escapeHtml(e.from)}</code> → <code>${escapeHtml(e.to)}</code></div>
      <div class="muted small">${escapeHtml(e.label || '')} · ${escapeHtml(e.sourcePath)}:${e.sourceLine}</div>
    </div>`;
  }).join('\n');

  const bugCards = graph.nodes.filter((n) => n.kind === 'bug').map((n) => browseCard(n)).join('\n');
  const adrCards = graph.nodes.filter((n) => n.kind === 'adr').map((n) => {
    const tombs = graph.nodes.filter(
      (t) => t.tombstone && graph.edges.some((e) => e.kind === 'tombstones' && e.from === n.id && e.to === t.id),
    );
    return `${browseCard(n)}${tombs.length
      ? `<div class="muted" style="margin:-4px 0 12px 12px">墓碑：${tombs.map((t) => escapeHtml(t.title)).join('；')}</div>`
      : ''}`;
  }).join('\n');

  const nextCards = graph.nextActions.map((id) => {
    const n = byId.get(id);
    return n ? cardHtml(n) : `<div class="card"><div class="title">${escapeHtml(id)}</div></div>`;
  }).join('\n') || '<p class="muted">（空）</p>';

  const answers = [
    ['a) BUG-011', graph.answers.bug011],
    ['b) J-space 墓碑', graph.answers.jspaceTombstone],
    ['c) 注入实验缺前提', graph.answers.injectionMissing],
  ].map(([t, v]) => `<div class="ans"><strong>${escapeHtml(t)}</strong>${escapeHtml(v || '')}</div>`).join('\n');

  const data = JSON.stringify(graph).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(projectTitle)} · Chronicle Board</title>
<style>
:root{color-scheme:dark;--bg:#090a0d;--panel:#12141a;--card:#171a22;--line:#2a2f3a;--ink:#eef0f5;--muted:#939bab;
--phase:#6b75e0;--bug:#ff6b6b;--adr:#4fd1a5;--campaign:#f0c14a;--finding:#b794f6;
--done:#2f6f4e;--ready:#3d4a9a;--blocked:#6b3a3a;--tomb:#555}
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--ink)}
a{color:#a8b4ff}
header.top{position:sticky;top:0;z-index:20;display:flex;flex-wrap:wrap;gap:10px;align-items:center;
  padding:12px 18px;background:rgba(9,10,13,.94);border-bottom:1px solid var(--line)}
header.top h1{font-size:16px;margin:0;font-weight:650}
.chip{display:inline-flex;padding:2px 9px;border-radius:999px;border:1px solid var(--line);font-size:12px;color:var(--muted)}
nav.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
nav.tabs button{background:transparent;border:1px solid var(--line);color:var(--ink);padding:6px 12px;border-radius:8px;cursor:pointer}
nav.tabs button.on{background:var(--phase);border-color:var(--phase)}
main{padding:18px 18px 48px;max-width:1280px;margin:0 auto}
section.block{display:none}
section.block.on{display:block}
h2{font-size:15px;margin:0 0 10px;font-weight:650}
h3{font-size:12px;margin:0 0 8px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.muted{color:var(--muted)}.small{font-size:12px}
.answers{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
@media(max-width:900px){.answers{grid-template-columns:1fr}}
.ans{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px;font-size:12px}
.ans strong{display:block;margin-bottom:4px}
.axis-wrap{overflow-x:auto}
.axis{position:relative;min-width:960px;height:200px;margin:8px 0 18px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}
.axis-line{position:absolute;left:24px;right:24px;top:50%;height:2px;background:linear-gradient(90deg,#2a2f3a,#6b75e0,#2a2f3a)}
.tick{position:absolute;top:50%;transform:translate(-50%,-50%);width:10px;height:10px;border-radius:50%;background:var(--campaign);border:2px solid #0b0c10}
.tick .tip{display:none;position:absolute;bottom:16px;left:50%;transform:translateX(-50%);width:170px;padding:8px;border-radius:8px;background:var(--card);border:1px solid var(--line);font-size:11px;z-index:5}
.tick:hover .tip{display:block}
.tick .date{position:absolute;top:14px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:10px;color:var(--muted)}
.tick.above .tip{bottom:auto;top:16px}
.board{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
@media(max-width:900px){.board{grid-template-columns:1fr}}
.col{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px;min-height:180px}
.col.done{border-top:3px solid var(--done)}.col.ready{border-top:3px solid var(--ready)}.col.blocked{border-top:3px solid var(--blocked)}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0}
.card .id{font-size:11px;color:var(--muted)}.card .title{font-weight:600;margin:4px 0}
.card .req{font-size:12px;color:var(--muted);margin-top:6px;padding-top:6px;border-top:1px dashed var(--line)}
.badge{display:inline-block;font-size:10px;padding:1px 6px;border-radius:4px;margin:2px 3px 0 0}
.badge.p{background:#2a3160;color:#c5cbff}.badge.b{background:#5a2a2a;color:#ffc9c9}
.graph-box{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:auto}
svg.dep{width:100%;min-width:980px;height:520px;display:block}
svg.dep .nrect{fill:var(--card);stroke:var(--line);stroke-width:1.5}
svg.dep .nrect.phase{stroke:var(--phase)}.svg.dep .nrect.finding{stroke:var(--finding)}
svg.dep .nrect.bug{stroke:var(--bug)}.svg.dep .nrect.adr{stroke:var(--adr)}
svg.dep .nrect.tomb{fill:#1a1a1a;stroke:var(--tomb);opacity:.8}
svg.dep text{fill:var(--ink);font-size:11px}svg.dep text.sub{fill:var(--muted);font-size:10px}
svg.dep line.edge{stroke:#5a6275;stroke-width:1.5;marker-end:url(#arrow)}
svg.dep line.edge.requires{stroke:#6b75e0}
svg.dep line.edge.tombstones{stroke:#888;stroke-dasharray:4 3}
.grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
@media(max-width:900px){.grid-3{grid-template-columns:1fr}}
.browse-item{border:1px solid var(--line);border-radius:10px;padding:10px;margin:8px 0;background:var(--card)}
.browse-item h4{margin:0 0 6px;font-size:13px}
.browse-item .body{white-space:pre-wrap;font-size:12px;color:var(--muted)}
pre.box{background:var(--panel);padding:12px;border-radius:10px;border:1px solid var(--line);white-space:pre-wrap;font-size:12px;color:var(--muted)}
</style>
</head>
<body>
<header class="top">
  <h1>${escapeHtml(projectTitle)} · Chronicle Board</h1>
  <span class="chip">hash ${escapeHtml(graph.contentHash)}</span>
  <span class="chip">${graph.nodes.length} nodes · ${graph.edges.length} edges</span>
  <nav class="tabs" id="tabs">
    <button type="button" data-tab="overview" class="on">总览</button>
    <button type="button" data-tab="graph">关系图</button>
    <button type="button" data-tab="bugs">Buglog</button>
    <button type="button" data-tab="adrs">ADR</button>
    <button type="button" data-tab="next">下一步</button>
  </nav>
</header>
<main>
  <section class="block on" id="tab-overview">
    <div class="answers">${answers}</div>
    <h2>时间轴 · 做过的事</h2>
    <p class="muted">INDEX 时间线（按日期）。点/悬停看事件。</p>
    <div class="axis-wrap"><div class="axis"><div class="axis-line"></div>${ticks || '<p class="muted" style="padding:16px">无带日期事件</p>'}</div></div>
    <h2>紧迫度看板 · 要做的事</h2>
    <p class="muted">左：已完成 · 中：可并行 · 右：被挡住。卡片内是前置条件。</p>
    <div class="board">
      <div class="col done"><h3>已完成 · ${cols.done.length}</h3>${cols.done.map(cardHtml).join('') || '<p class="muted">（空）</p>'}</div>
      <div class="col ready"><h3>可并行推进 · ${cols.ready.length}</h3>${cols.ready.map(cardHtml).join('') || '<p class="muted">（空）</p>'}</div>
      <div class="col blocked"><h3>被挡住 · ${cols.blocked.length}</h3>${cols.blocked.map(cardHtml).join('') || '<p class="muted">（空）</p>'}</div>
    </div>
  </section>

  <section class="block" id="tab-graph" hidden>
    <h2>关系图 · 前置与墓碑</h2>
    <p class="muted">蓝线 = 前提(requires)；灰虚线 = 否决/墓碑。下面每条边也是一张卡。</p>
    <div class="graph-box">
      <svg class="dep" viewBox="0 0 1100 520" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="#5a6275"/>
          </marker>
        </defs>
        ${svgLines}
        ${svgNodes}
      </svg>
    </div>
    <h2 style="margin-top:16px">关系清单</h2>
    <div class="grid-3">${edgeCards}</div>
  </section>

  <section class="block" id="tab-bugs" hidden>
    <h2>Buglog 区块</h2>
    <p class="muted">源文件链接相对 docs/ 打开（建议用本地 http 服务浏览）。</p>
    ${bugCards || '<p class="muted">无 bug 节点</p>'}
  </section>

  <section class="block" id="tab-adrs" hidden>
    <h2>ADR 区块</h2>
    ${adrCards || '<p class="muted">无 ADR 节点</p>'}
  </section>

  <section class="block" id="tab-next" hidden>
    <h2>下一步（机器推导）</h2>
    ${nextCards}
    <h3 style="margin-top:16px">图 vs todo diff</h3>
    <pre class="box">${escapeHtml(JSON.stringify(graph.todoDiff, null, 2))}</pre>
    <h3 style="margin-top:16px">解析错误</h3>
    <pre class="box">${escapeHtml(graph.parseErrors.length
    ? graph.parseErrors.map((e) => `${e.path}:${e.line} ${e.message}`).join('\n')
    : '（无）')}</pre>
  </section>
</main>
<script id="graph-data" type="application/json">${data}</script>
<script>
(function(){
  // Tabs only — content is server-rendered so the page is never blank.
  var tabs = document.getElementById('tabs');
  if (!tabs) return;
  tabs.addEventListener('click', function(ev){
    var btn = ev.target && ev.target.closest ? ev.target.closest('button[data-tab]') : null;
    if (!btn) return;
    var name = btn.getAttribute('data-tab');
    tabs.querySelectorAll('button').forEach(function(b){ b.classList.toggle('on', b===btn); });
    document.querySelectorAll('main section.block').forEach(function(sec){
      var on = sec.id === 'tab-' + name;
      sec.classList.toggle('on', on);
      if (on) sec.removeAttribute('hidden'); else sec.setAttribute('hidden', '');
    });
  });
})();
</script>
</body>
</html>`;
}

function browseCard(n: GraphNode): string {
  const href = n.sourcePath.replace(/^docs\//, '');
  return `<div class="browse-item">
    <h4>${escapeHtml(n.id)} · ${escapeHtml(n.title)} <span class="chip">${escapeHtml(n.status)}</span></h4>
    <div class="body">${escapeHtml(n.summary || '')}</div>
    <div class="muted small" style="margin-top:6px">${escapeHtml(n.sourcePath)}:${n.sourceLine}
      · <a href="${escapeHtml(href)}">打开源 md</a></div>
  </div>`;
}

function firstIso(value: string): string | undefined {
  const m = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (!m) return undefined;
  const candidate = m[0];
  const date = new Date(`${candidate}T00:00:00Z`);
  if (!Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === candidate) return candidate;
  // also accept YYYY-MM as sort key
  return candidate;
}

function shortDate(s: string): string {
  const m = s.match(/(\d{4}-\d{2}-\d{2})|(\d{4}-\d{2})/);
  return m ? (m[1] || m[2] || s.slice(0, 10)) : s.slice(0, 10);
}

function thin<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
  return out;
}
