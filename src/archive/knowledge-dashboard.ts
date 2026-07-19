/**
 * Single-file Chronicle Dashboard HTML (zero external deps).
 * Embeds chronicle-graph.json data inline for offline viewing.
 */
import type { ChronicleGraph } from './knowledge-graph.js';
import { escapeHtml } from './html-escape.js';

export function renderKnowledgeDashboardHtml(graph: ChronicleGraph, projectTitle = 'Student Agent'): string {
  const data = JSON.stringify(graph).replace(/</g, '\\u003c');
  const vitalsRows = graph.nodes
    .filter((n) => n.vitals && Object.keys(n.vitals).length > 0)
    .map((n) => {
      const cells = Object.entries(n.vitals ?? {})
        .map(([k, v]) => `<td>${escapeHtml(k)}</td><td>${escapeHtml(String(v))}</td>`)
        .join('');
      return `<tr><td>${escapeHtml(n.id)}</td><td>${escapeHtml(n.title)}</td>${cells}</tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(projectTitle)} · Chronicle Dashboard</title>
<style>
:root{color-scheme:dark;--bg:#0b0c0f;--panel:#14161c;--line:#2a2e38;--ink:#e8eaef;--muted:#9aa3b2;
--phase:#5e6ad2;--bug:#ff6161;--adr:#59d499;--campaign:#ffc533;--finding:#a78bfa;--tomb:#666}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 ui-sans-serif,system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{padding:16px 20px;border-bottom:1px solid var(--line);display:flex;gap:12px;flex-wrap:wrap;align-items:center}
header h1{font-size:18px;margin:0}
.layout{display:grid;grid-template-columns:1fr 340px;min-height:calc(100vh - 58px)}
@media(max-width:900px){.layout{grid-template-columns:1fr}}
.panel{border-right:1px solid var(--line);padding:16px;overflow:auto}
.side{padding:16px;background:var(--panel);overflow:auto}
.chip{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;border:1px solid var(--line);margin:2px}
.node{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0;cursor:pointer;background:#101218}
.node:hover,.node.active{border-color:#5e6ad2}
.node.tomb{opacity:.55;filter:grayscale(.7)}
.k-phase{border-left:4px solid var(--phase)}.k-bug{border-left:4px solid var(--bug)}
.k-adr{border-left:4px solid var(--adr)}.k-campaign{border-left:4px solid var(--campaign)}
.k-finding{border-left:4px solid var(--finding)}
.muted{color:var(--muted);font-size:13px}
.section{margin-top:18px}
table{width:100%;border-collapse:collapse;font-size:13px}
td,th{border:1px solid var(--line);padding:6px 8px;text-align:left}
.answers{background:#12141a;border:1px solid var(--line);border-radius:10px;padding:12px;margin:12px 0}
.answers h3{margin:0 0 8px;font-size:14px}
.edge{font-size:12px;color:var(--muted);margin:4px 0}
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(projectTitle)} · Chronicle Dashboard v1</h1>
  <span class="chip">hash ${escapeHtml(graph.contentHash)}</span>
  <span class="chip">nodes ${graph.nodes.length}</span>
  <span class="chip">edges ${graph.edges.length}</span>
  <span class="chip">next ${graph.nextActions.length}</span>
</header>
<div class="layout">
  <main class="panel">
    <div class="answers" id="acceptance">
      <h3>三问验收（不看 md）</h3>
      <p><strong>a) BUG-011</strong><br><span class="muted" id="ans-bug011"></span></p>
      <p><strong>b) J-space 墓碑</strong><br><span class="muted" id="ans-jspace"></span></p>
      <p><strong>c) 注入实验缺前提</strong><br><span class="muted" id="ans-inject"></span></p>
    </div>
    <div class="section">
      <h2>图谱节点</h2>
      <p class="muted">点击节点查看六边邻居。tombstone 灰显。</p>
      <div id="nodes"></div>
    </div>
    <div class="section">
      <h2>时间线（campaign）</h2>
      <div id="timeline"></div>
    </div>
    <div class="section">
      <h2>生命体征（批次表格）</h2>
      <table>
        <thead><tr><th>id</th><th>title</th><th>vital</th><th>value</th></tr></thead>
        <tbody>${vitalsRows || '<tr><td colspan="4" class="muted">无 JSON vitals</td></tr>'}</tbody>
      </table>
    </div>
    <div class="section">
      <h2>下一步（机器推导）</h2>
      <ul id="next"></ul>
      <h3 class="muted">与 todo 对照 diff</h3>
      <pre class="muted" id="todo-diff"></pre>
    </div>
    <div class="section">
      <h2>解析错误（禁止静默）</h2>
      <pre class="muted" id="errors"></pre>
    </div>
  </main>
  <aside class="side">
    <h2>节点详情</h2>
    <div id="detail" class="muted">选择左侧节点</div>
    <div class="section"><h3>六边邻居</h3><div id="neighbors"></div></div>
  </aside>
</div>
<script id="graph-data" type="application/json">${data}</script>
<script>
(function(){
  const graph = JSON.parse(document.getElementById('graph-data').textContent);
  const byId = Object.fromEntries(graph.nodes.map(n => [n.id, n]));
  const edgeLabel = {requires:'前提',produces:'产出',exposes:'暴露',motivates:'动机',tombstones:'否决/墓碑',verifies:'验证'};
  const kindClass = k => 'k-' + k;
  document.getElementById('ans-bug011').textContent = graph.answers.bug011 || '';
  document.getElementById('ans-jspace').textContent = graph.answers.jspaceTombstone || '';
  document.getElementById('ans-inject').textContent = graph.answers.injectionMissing || '';
  document.getElementById('next').innerHTML = graph.nextActions.map(id => {
    const n = byId[id]; return '<li><code>'+id+'</code> '+(n?n.title:'')+' <span class="chip">'+(n?n.status:'')+'</span></li>';
  }).join('') || '<li class="muted">（空）</li>';
  document.getElementById('todo-diff').textContent = JSON.stringify(graph.todoDiff, null, 2);
  document.getElementById('errors').textContent = graph.parseErrors.length
    ? graph.parseErrors.map(e => e.path+':'+e.line+' '+e.message).join('\\n')
    : '（无）';

  const nodesEl = document.getElementById('nodes');
  graph.nodes.forEach(n => {
    const el = document.createElement('div');
    el.className = 'node ' + kindClass(n.kind) + (n.tombstone ? ' tomb' : '');
    el.dataset.id = n.id;
    el.innerHTML = '<div><strong>'+esc(n.id)+'</strong> <span class="chip">'+esc(n.kind)+'</span> <span class="chip">'+esc(n.status)+'</span></div>'
      + '<div>'+esc(n.title)+'</div><div class="muted">'+esc(n.sourcePath)+':'+n.sourceLine+'</div>';
    el.onclick = () => select(n.id);
    nodesEl.appendChild(el);
  });

  const timeline = document.getElementById('timeline');
  graph.nodes.filter(n => n.kind==='campaign').forEach(n => {
    const el = document.createElement('div');
    el.className = 'node k-campaign';
    el.textContent = (n.date ? n.date+' · ' : '') + n.title;
    el.onclick = () => select(n.id);
    timeline.appendChild(el);
  });

  function select(id){
    document.querySelectorAll('.node').forEach(n => n.classList.toggle('active', n.dataset.id===id));
    const n = byId[id];
    if (!n) return;
    document.getElementById('detail').innerHTML =
      '<p><strong>'+esc(n.id)+'</strong></p><p>'+esc(n.title)+'</p><p class="muted">'+esc(n.summary)+'</p>'
      + '<p class="muted">status='+esc(n.status)+(n.tombstone?' · TOMBSTONE':'')+'</p>'
      + '<p class="muted">'+esc(n.sourcePath)+':'+n.sourceLine+'</p>';
    const neigh = graph.edges.filter(e => e.from===id || e.to===id);
    const groups = {};
    neigh.forEach(e => {
      const k = e.kind;
      groups[k] = groups[k] || [];
      groups[k].push(e);
    });
    const box = document.getElementById('neighbors');
    box.innerHTML = Object.keys(edgeLabel).map(k => {
      const list = groups[k] || [];
      if (!list.length) return '';
      return '<div class="edge"><strong>'+edgeLabel[k]+' ('+k+')</strong><ul>'+list.map(e => {
        const other = e.from===id ? e.to : e.from;
        const dir = e.from===id ? '→' : '←';
        return '<li>'+dir+' <a href="#" data-id="'+esc(other)+'">'+esc(other)+'</a> '+(e.label?esc(e.label):'')+'</li>';
      }).join('')+'</ul></div>';
    }).join('') || '<p class="muted">无边</p>';
    box.querySelectorAll('a[data-id]').forEach(a => a.onclick = (ev) => { ev.preventDefault(); select(a.getAttribute('data-id')); });
  }

  // Prefer selecting key nodes for the three questions
  if (byId['BUG-011']) select('BUG-011');
  else if (byId['BUG-004']) select('BUG-004');
  else if (graph.nodes[0]) select(graph.nodes[0].id);

  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
})();
</script>
</body>
</html>
`;
}
