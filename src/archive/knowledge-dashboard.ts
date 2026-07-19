/**
 * Chronicle Dashboard HTML — visual board, not a flat list.
 * Sections: time axis | urgency board | SVG dependency graph | buglog | ADR.
 * Zero external deps; graph JSON embedded for offline open.
 */
import type { ChronicleGraph, GraphEdge, GraphNode } from './knowledge-graph.js';
import { escapeHtml } from './html-escape.js';

export function renderKnowledgeDashboardHtml(graph: ChronicleGraph, projectTitle = 'Student Agent'): string {
  const data = JSON.stringify(graph).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(projectTitle)} · Chronicle Board</title>
<style>
:root{
  color-scheme:dark;
  --bg:#090a0d;--panel:#12141a;--card:#171a22;--line:#2a2f3a;--ink:#eef0f5;--muted:#939bab;
  --phase:#6b75e0;--bug:#ff6b6b;--adr:#4fd1a5;--campaign:#f0c14a;--finding:#b794f6;
  --done:#2f6f4e;--ready:#3d4a9a;--blocked:#6b3a3a;--tomb:#555;
}
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--ink)}
a{color:#a8b4ff}
header.top{position:sticky;top:0;z-index:20;display:flex;flex-wrap:wrap;gap:10px;align-items:center;
  padding:12px 18px;background:rgba(9,10,13,.92);border-bottom:1px solid var(--line);backdrop-filter:blur(8px)}
header.top h1{font-size:16px;margin:0;font-weight:650}
.chip{display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:999px;border:1px solid var(--line);
  font-size:12px;color:var(--muted);background:#0e1016}
nav.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
nav.tabs button{background:transparent;border:1px solid var(--line);color:var(--ink);padding:6px 12px;border-radius:8px;cursor:pointer}
nav.tabs button.on{background:var(--phase);border-color:var(--phase)}
main{padding:18px 18px 48px;max-width:1280px;margin:0 auto}
section.block{display:none;animation:in .25s ease}
section.block.on{display:block}
@keyframes in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
h2{font-size:15px;margin:0 0 12px;font-weight:650}
h3{font-size:13px;margin:0 0 8px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.muted{color:var(--muted)}
.grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
@media(max-width:900px){.grid-3{grid-template-columns:1fr}}

/* —— Time axis —— */
.axis-wrap{overflow-x:auto;padding-bottom:8px}
.axis{position:relative;min-width:960px;height:220px;margin:8px 0 20px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}
.axis-line{position:absolute;left:24px;right:24px;top:50%;height:2px;background:linear-gradient(90deg,#2a2f3a,#6b75e0,#2a2f3a)}
.tick{position:absolute;top:50%;transform:translate(-50%,-50%);width:10px;height:10px;border-radius:50%;background:var(--campaign);border:2px solid #0b0c10;cursor:pointer}
.tick .tip{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);width:160px;padding:8px;border-radius:8px;
  background:var(--card);border:1px solid var(--line);font-size:11px;line-height:1.35;display:none;z-index:5}
.tick:hover .tip,.tick:focus .tip{display:block}
.tick .date{position:absolute;top:14px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:10px;color:var(--muted)}
.tick.above .tip{bottom:auto;top:18px}

/* —— Urgency board —— */
.board{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
@media(max-width:900px){.board{grid-template-columns:1fr}}
.col{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px;min-height:200px}
.col.done{border-top:3px solid var(--done)}
.col.ready{border-top:3px solid var(--ready)}
.col.blocked{border-top:3px solid var(--blocked)}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0;cursor:pointer}
.card:hover{border-color:#6b75e0}
.card .id{font-size:11px;color:var(--muted)}
.card .title{font-weight:600;margin:4px 0}
.card .req{font-size:12px;color:var(--muted);margin-top:6px;padding-top:6px;border-top:1px dashed var(--line)}
.badge{display:inline-block;font-size:10px;padding:1px 6px;border-radius:4px;margin-right:4px}
.badge.p{background:#2a3160;color:#c5cbff}
.badge.b{background:#5a2a2a;color:#ffc9c9}
.badge.f{background:#3a2a5a;color:#e0d0ff}

/* —— SVG graph —— */
.graph-box{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:auto}
svg.dep{width:100%;min-width:900px;height:520px;display:block}
svg.dep .nrect{fill:var(--card);stroke:var(--line);stroke-width:1.5;rx:10}
svg.dep .nrect.phase{stroke:var(--phase)}
svg.dep .nrect.finding{stroke:var(--finding)}
svg.dep .nrect.bug{stroke:var(--bug)}
svg.dep .nrect.adr{stroke:var(--adr)}
svg.dep .nrect.tomb{fill:#1a1a1a;stroke:var(--tomb);opacity:.75}
svg.dep text{fill:var(--ink);font-size:11px;pointer-events:none}
svg.dep text.sub{fill:var(--muted);font-size:10px}
svg.dep line.edge{stroke:#5a6275;stroke-width:1.5;marker-end:url(#arrow)}
svg.dep line.edge.requires{stroke:#6b75e0}
svg.dep line.edge.tombstones{stroke:#888;stroke-dasharray:4 3}
svg.dep .hit{cursor:pointer}

/* —— Browse lists —— */
.browse{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:900px){.browse{grid-template-columns:1fr}}
.browse-col{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px;max-height:70vh;overflow:auto}
.browse-item{border:1px solid var(--line);border-radius:10px;padding:10px;margin:8px 0;background:var(--card)}
.browse-item h4{margin:0 0 6px;font-size:13px}
.browse-item pre,.browse-item .body{white-space:pre-wrap;font-size:12px;color:var(--muted);margin:0;font-family:ui-sans-serif,system-ui,sans-serif}
.detail-dock{position:fixed;right:12px;bottom:12px;width:min(360px,calc(100vw - 24px));max-height:45vh;overflow:auto;
  background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px;box-shadow:0 12px 40px rgba(0,0,0,.45);display:none}
.detail-dock.on{display:block}
.answers{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px}
@media(max-width:900px){.answers{grid-template-columns:1fr}}
.ans{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px;font-size:12px}
.ans strong{display:block;margin-bottom:4px;font-size:12px}
</style>
</head>
<body>
<header class="top">
  <h1>${escapeHtml(projectTitle)} · Chronicle Board</h1>
  <span class="chip">hash ${escapeHtml(graph.contentHash)}</span>
  <span class="chip" id="stats"></span>
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
    <div class="answers" id="answers"></div>
    <h2>时间轴 · 做过的事</h2>
    <p class="muted">横轴为 INDEX 时间线（按日期排序）。悬停看事件。</p>
    <div class="axis-wrap"><div class="axis" id="axis"></div></div>
    <h2>紧迫度看板 · 要做的事</h2>
    <p class="muted">已完成 / 可并行推进 / 被挡住。卡片内是需求与前置。</p>
    <div class="board" id="board"></div>
  </section>

  <section class="block" id="tab-graph">
    <h2>关系图 · 前置与墓碑</h2>
    <p class="muted">线 = 关系卡片的方向：蓝实线 = 前提(requires)；灰虚线 = 否决/墓碑。点节点看详情。</p>
    <div class="graph-box"><svg class="dep" id="svg" viewBox="0 0 1100 520"></svg></div>
    <div class="section" style="margin-top:16px">
      <h2>关系清单（每条边一张卡）</h2>
      <div class="grid-3" id="edge-cards"></div>
    </div>
  </section>

  <section class="block" id="tab-bugs">
    <h2>Buglog 区块</h2>
    <p class="muted">从机读 buglog 抽出；点开可看症状/状态/源文件行号。</p>
    <div id="bug-list"></div>
  </section>

  <section class="block" id="tab-adrs">
    <h2>ADR 区块</h2>
    <p class="muted">ADR 与阶段决策摘要；墓碑 finding 附在相关 ADR 下。</p>
    <div id="adr-list"></div>
  </section>

  <section class="block" id="tab-next">
    <h2>下一步清单（机器推导）</h2>
    <p class="muted">前提全绿且自身未 CLOSED。与人工 todo 的 diff 如下。</p>
    <div id="next-list"></div>
    <h3 style="margin-top:16px">图 vs todo diff</h3>
    <pre class="muted" id="todo-diff" style="background:var(--panel);padding:12px;border-radius:10px;border:1px solid var(--line)"></pre>
    <h3 style="margin-top:16px">解析错误（不静默）</h3>
    <pre class="muted" id="errors" style="background:var(--panel);padding:12px;border-radius:10px;border:1px solid var(--line)"></pre>
  </section>
</main>
<div class="detail-dock" id="dock"></div>
<script id="graph-data" type="application/json">${data}</script>
<script>
(function(){
  const G = JSON.parse(document.getElementById('graph-data').textContent);
  const byId = Object.fromEntries(G.nodes.map(n => [n.id, n]));
  const $ = (id) => document.getElementById(id);
  $('stats').textContent = G.nodes.length + ' nodes · ' + G.edges.length + ' edges';

  // tabs
  document.querySelectorAll('#tabs button').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#tabs button').forEach(b => b.classList.remove('on'));
      document.querySelectorAll('section.block').forEach(s => s.classList.remove('on'));
      btn.classList.add('on');
      $('tab-' + btn.dataset.tab).classList.add('on');
    };
  });

  // answers
  $('answers').innerHTML = [
    ['a) BUG-011', G.answers.bug011],
    ['b) J-space 墓碑', G.answers.jspaceTombstone],
    ['c) 注入实验缺前提', G.answers.injectionMissing],
  ].map(([t,v]) => '<div class="ans"><strong>'+esc(t)+'</strong>'+esc(v||'')+'</div>').join('');

  // —— TIME AXIS ——
  const camps = G.nodes.filter(n => n.kind==='campaign' && n.date)
    .map(n => ({...n, sort: firstDate(n.date)}))
    .filter(n => n.sort)
    .sort((a,b) => a.sort.localeCompare(b.sort));
  // sample if too many: keep last 24 + evenly sparse
  const shown = camps.length > 28 ? thin(camps, 28) : camps;
  const axis = $('axis');
  if (shown.length) {
    const t0 = Date.parse(shown[0].sort+'T00:00:00Z');
    const t1 = Date.parse(shown[shown.length-1].sort+'T00:00:00Z') || t0+1;
    shown.forEach((n,i) => {
      const x = 4 + ((Date.parse(n.sort+'T00:00:00Z')-t0)/Math.max(1,t1-t0))*92;
      const el = document.createElement('div');
      el.className = 'tick' + (i%2 ? ' above' : '');
      el.style.left = x + '%';
      el.tabIndex = 0;
      el.innerHTML = '<div class="tip"><div class="muted">'+esc(n.date)+'</div>'+esc(n.title)+'</div><div class="date">'+esc(shortDate(n.date))+'</div>';
      el.onclick = () => showDock(n);
      axis.appendChild(el);
    });
  } else {
    axis.innerHTML = '<p class="muted" style="padding:16px">无带日期 campaign</p>';
  }

  // —— URGENCY BOARD ——
  const phases = G.nodes.filter(n => n.kind==='phase').sort((a,b)=>a.id.localeCompare(b.id));
  const findings = G.nodes.filter(n => n.kind==='finding' && !n.tombstone);
  const requires = G.edges.filter(e => e.kind==='requires');
  function prereqsOf(id){ return requires.filter(e => e.from===id).map(e => e.to); }
  function isClosed(id){
    const n = byId[id]; if(!n) return false;
    return /CLOSED|DONE|FIXED|合页|关案/i.test(n.status) || n.tombstone;
  }
  function bucket(n){
    if (isClosed(n.id)) return 'done';
    const pre = prereqsOf(n.id);
    if (pre.length && !pre.every(isClosed)) return 'blocked';
    if (G.nextActions.includes(n.id) || /PLANNED|OPEN|BLOCKED|UNKNOWN/i.test(n.status)) return 'ready';
    return 'blocked';
  }
  const cols = {done:[], ready:[], blocked:[]};
  [...phases, ...findings, ...G.nodes.filter(n=>n.id==='finding:injection-effect-experiment')].forEach(n => {
    // dedupe
  });
  const boardNodes = [];
  const seen = new Set();
  for (const n of [...phases, ...findings]) {
    if (seen.has(n.id)) continue; seen.add(n.id);
    boardNodes.push(n);
  }
  boardNodes.forEach(n => cols[bucket(n)].push(n));

  function cardHtml(n){
    const pre = prereqsOf(n.id);
    const preText = pre.length
      ? pre.map(id => {
          const ok = isClosed(id);
          return '<span class="badge '+(ok?'p':'b')+'">'+(ok?'✓ ':'✗ ')+esc(id)+'</span>';
        }).join(' ')
      : '<span class="muted">无硬前置</span>';
    return '<div class="card" data-id="'+esc(n.id)+'">'
      + '<div class="id">'+esc(n.id)+' · '+esc(n.status)+'</div>'
      + '<div class="title">'+esc(n.title)+'</div>'
      + '<div class="muted" style="font-size:12px">'+esc((n.summary||'').slice(0,160))+'</div>'
      + '<div class="req"><strong>前置 / 需求</strong><br>'+preText+'</div>'
      + '</div>';
  }
  $('board').innerHTML = [
    ['done','已完成','done'],
    ['ready','可并行推进（紧迫）','ready'],
    ['blocked','被挡住','blocked'],
  ].map(([k,label,cls]) => {
    const list = cols[k];
    return '<div class="col '+cls+'"><h3>'+label+' · '+list.length+'</h3>'
      + (list.map(cardHtml).join('') || '<p class="muted">（空）</p>') + '</div>';
  }).join('');
  $('board').querySelectorAll('.card').forEach(el => el.onclick = () => showDock(byId[el.dataset.id]));

  // —— SVG DEPENDENCY GRAPH ——
  // Layout: phases on a spine, findings/tombstones around
  const svg = $('svg');
  const NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs){ const e=document.createElementNS(NS,name); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
  const defs = el('defs',{});
  defs.innerHTML = '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#5a6275"/></marker>';
  svg.appendChild(defs);

  const focusIds = new Set([
    ...phases.map(p=>p.id),
    'finding:injection-effect-experiment',
    'finding:jspace-external',
    'finding:c2-cache-prefix',
    ...G.nodes.filter(n=>n.tombstone).slice(0,6).map(n=>n.id),
  ]);
  // include endpoints of requires among focus
  G.edges.filter(e=>e.kind==='requires'||e.kind==='tombstones').forEach(e => { focusIds.add(e.from); focusIds.add(e.to); });

  const focus = [...focusIds].map(id => byId[id]).filter(Boolean);
  const pos = {};
  // phases horizontal spine
  const phaseList = phases.length ? phases : focus.filter(n=>n.kind==='phase');
  phaseList.forEach((n,i) => {
    pos[n.id] = { x: 80 + i * 160, y: 200, w: 140, h: 56 };
  });
  // other nodes
  let row = 0;
  focus.filter(n => !pos[n.id]).forEach((n,i) => {
    const col = i % 5;
    if (col===0 && i) row++;
    pos[n.id] = { x: 80 + col * 200, y: n.tombstone ? 360 : (row < 1 ? 60 : 320), w: 170, h: 52 };
  });

  // edges first
  const gEdges = G.edges.filter(e => pos[e.from] && pos[e.to] && (e.kind==='requires' || e.kind==='tombstones' || e.kind==='produces' || e.kind==='verifies'));
  gEdges.forEach(e => {
    const a = pos[e.from], b = pos[e.to];
    // arrow from a center to b center
    const x1 = a.x + a.w/2, y1 = a.y + a.h/2, x2 = b.x + b.w/2, y2 = b.y + b.h/2;
    const line = el('line', {
      x1, y1, x2, y2,
      class: 'edge ' + e.kind,
    });
    svg.appendChild(line);
  });

  focus.forEach(n => {
    const p = pos[n.id]; if (!p) return;
    const g = el('g', { class: 'hit', 'data-id': n.id });
    const rect = el('rect', {
      x: p.x, y: p.y, width: p.w, height: p.h,
      class: 'nrect ' + n.kind + (n.tombstone ? ' tomb' : ''),
    });
    const t1 = el('text', { x: p.x + 10, y: p.y + 20 });
    t1.textContent = n.id.length > 22 ? n.id.slice(0,20)+'…' : n.id;
    const t2 = el('text', { x: p.x + 10, y: p.y + 38, class: 'sub' });
    t2.textContent = (n.title || '').slice(0, 22);
    g.appendChild(rect); g.appendChild(t1); g.appendChild(t2);
    g.addEventListener('click', () => showDock(n));
    svg.appendChild(g);
  });

  // edge cards
  $('edge-cards').innerHTML = gEdges.slice(0, 36).map(e => {
    const label = ({requires:'前提',produces:'产出',exposes:'暴露',motivates:'动机',tombstones:'否决/墓碑',verifies:'验证'})[e.kind] || e.kind;
    return '<div class="card"><div class="id">'+esc(label)+' · '+esc(e.kind)+'</div>'
      + '<div class="title"><code>'+esc(e.from)+'</code> → <code>'+esc(e.to)+'</code></div>'
      + '<div class="muted" style="font-size:12px">'+(e.label?esc(e.label):'')+' · '+esc(e.sourcePath)+':'+e.sourceLine+'</div></div>';
  }).join('');

  // —— Buglog / ADR browse ——
  function browseItem(n){
    return '<div class="browse-item" data-id="'+esc(n.id)+'">'
      + '<h4>'+esc(n.id)+' · '+esc(n.title)+' <span class="chip">'+esc(n.status)+'</span></h4>'
      + '<div class="body">'+esc(n.summary || '')+'</div>'
      + '<div class="muted" style="margin-top:6px">'+esc(n.sourcePath)+':'+n.sourceLine
      + (n.sourcePath ? ' · <a href="'+esc(relDoc(n.sourcePath))+'" target="_blank" rel="noreferrer">打开源 md</a>' : '')
      + '</div></div>';
  }
  // For file:// open, relative links from docs/dashboard.html work for docs/*
  $('bug-list').innerHTML = G.nodes.filter(n=>n.kind==='bug').map(browseItem).join('') || '<p class="muted">无 bug</p>';
  const adrs = G.nodes.filter(n=>n.kind==='adr');
  const tombs = G.nodes.filter(n=>n.tombstone);
  $('adr-list').innerHTML = adrs.map(a => {
    const relatedTombs = tombs.filter(t => G.edges.some(e => e.kind==='tombstones' && e.from===a.id && e.to===t.id));
    return browseItem(a) + (relatedTombs.length
      ? '<div class="muted" style="margin:0 0 12px 12px">墓碑：'+relatedTombs.map(t=>esc(t.title)).join('；')+'</div>'
      : '');
  }).join('') + (tombs.filter(t=>!G.edges.some(e=>e.to===t.id && e.kind==='tombstones')).map(browseItem).join(''));

  $('bug-list').querySelectorAll('.browse-item').forEach(el => el.onclick = (ev) => {
    if (ev.target.tagName === 'A') return;
    showDock(byId[el.dataset.id]);
  });
  $('adr-list').querySelectorAll('.browse-item').forEach(el => el.onclick = (ev) => {
    if (ev.target.tagName === 'A') return;
    showDock(byId[el.dataset.id]);
  });

  // next
  $('next-list').innerHTML = G.nextActions.map(id => {
    const n = byId[id];
    return cardHtml(n || {id, title:id, status:'?', summary:''});
  }).join('') || '<p class="muted">（空）</p>';
  $('next-list').querySelectorAll('.card').forEach(el => el.onclick = () => showDock(byId[el.dataset.id]));
  $('todo-diff').textContent = JSON.stringify(G.todoDiff, null, 2);
  $('errors').textContent = G.parseErrors.length
    ? G.parseErrors.map(e => e.path+':'+e.line+'  '+e.message).join('\\n')
    : '（无）';

  function showDock(n){
    if (!n) return;
    const dock = $('dock');
    const pre = prereqsOf(n.id);
    const outs = G.edges.filter(e => e.from===n.id);
    const ins = G.edges.filter(e => e.to===n.id);
    dock.className = 'detail-dock on';
    dock.innerHTML = '<div style="display:flex;justify-content:space-between;gap:8px"><strong>'+esc(n.id)+'</strong>'
      + '<button type="button" id="dock-x" style="background:transparent;border:0;color:var(--muted);cursor:pointer">关闭</button></div>'
      + '<div style="margin:6px 0;font-weight:600">'+esc(n.title)+'</div>'
      + '<div class="muted" style="font-size:12px;margin-bottom:8px">'+esc(n.status)+(n.tombstone?' · TOMBSTONE':'')+'</div>'
      + '<div style="font-size:13px;margin-bottom:8px">'+esc(n.summary||'')+'</div>'
      + '<div class="muted" style="font-size:12px">'+esc(n.sourcePath)+':'+n.sourceLine+'</div>'
      + (n.sourcePath ? '<div style="margin-top:6px"><a href="'+esc(relDoc(n.sourcePath))+'">打开源文件</a></div>' : '')
      + '<div style="margin-top:10px;font-size:12px"><strong>入边</strong><br>'+(ins.map(e=>esc(e.kind)+': '+esc(e.from)).join('<br>')||'—')+'</div>'
      + '<div style="margin-top:8px;font-size:12px"><strong>出边</strong><br>'+(outs.map(e=>esc(e.kind)+': '+esc(e.to)).join('<br>')||'—')+'</div>'
      + (pre.length ? '<div style="margin-top:8px;font-size:12px"><strong>前置检查</strong><br>'+pre.map(id=>(isClosed(id)?'✓ ':'✗ ')+esc(id)).join('<br>')+'</div>' : '');
    $('dock-x').onclick = () => { dock.className = 'detail-dock'; };
  }

  function firstDate(s){
    const m = String(s).match(/\b(\d{4}-\d{2}-\d{2})\b/);
    return m ? m[1] : null;
  }
  function shortDate(s){
    const m = String(s).match(/(\d{4}-\d{2}-\d{2})|(\d{4}-\d{2})/);
    return m ? (m[1]||m[2]) : String(s).slice(0,10);
  }
  function thin(arr, n){
    if (arr.length <= n) return arr;
    const out = [];
    for (let i=0;i<n;i++) out.push(arr[Math.round(i*(arr.length-1)/(n-1))]);
    return out;
  }
  /** dashboard lives in docs/, so strip docs/ prefix for relative file links */
  function relDoc(p){
    return String(p||'').replace(/^docs\//,'');
  }
  function esc(s){
    return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
})();
</script>
</body>
</html>`;
}
