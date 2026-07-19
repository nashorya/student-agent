/**
 * Chronicle Dashboard — visual board with SSR so the page is never empty without JS.
 * Tabs still enhance client-side; core board/timeline/answers are server-rendered.
 * Presentation follows Linear product density (DESIGN.md linear.app); logic unchanged.
 */
import type { ChronicleGraph, GraphNode } from './knowledge-graph.js';
import { escapeHtml } from './html-escape.js';

const EDGE_LABEL: Record<string, string> = {
  requires: '前提',
  produces: '产出',
  exposes: '暴露',
  motivates: '动机',
  tombstones: '否决/墓碑',
  verifies: '验证',
  // labels used as edge.label (not kind)
  defines: '定义',
  'consumed-by': '被消费',
  consumes: '消费',
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
    const href = docsHref(n.sourcePath, n.sourceLine);
    const preText = pre.length
      ? pre.map((id) => {
        const ok = isClosed(id);
        const pn = byId.get(id);
        const ph = pn ? docsHref(pn.sourcePath, pn.sourceLine) : '';
        return `<button type="button" class="tag ${ok ? 'ok' : 'bad'} node-link" data-node-id="${escapeHtml(id)}"${ph ? ` data-href="${escapeHtml(ph)}"` : ''} title="打开前置 ${escapeHtml(id)}">${ok ? '✓' : '✗'} ${escapeHtml(id)}</button>`;
      }).join('')
      : '<span class="meta">无硬前置</span>';
    const kind = n.kind || 'finding';
    return `<article class="issue node-link" tabindex="0" role="link" data-node-id="${escapeHtml(n.id)}"${href ? ` data-href="${escapeHtml(href)}"` : ''} title="查看 ${escapeHtml(n.id)}">
      <div class="issue-top">
        <span class="kind kind-${escapeHtml(kind)}"></span>
        <code class="issue-id">${escapeHtml(n.id)}</code>
        <span class="status">${escapeHtml(n.status)}</span>
        ${href ? '<span class="open-hint">md ↗</span>' : '<span class="open-hint">详情</span>'}
      </div>
      <div class="issue-title">${escapeHtml(n.title)}</div>
      ${n.summary ? `<div class="issue-sum">${escapeHtml(n.summary.slice(0, 140))}</div>` : ''}
      <div class="issue-req">${preText}</div>
    </article>`;
  };

  // ── Roadmap / Gantt timeline (Linear product density) ──────────────────────
  const camps = graph.nodes
    .filter((n) => n.kind === 'campaign' && n.date)
    .map((n) => ({ n, sort: firstIso(n.date!) }))
    .filter((x): x is { n: GraphNode; sort: string } => Boolean(x.sort))
    .sort((a, b) => a.sort.localeCompare(b.sort));
  const shown = thin(camps, 36);

  let roadmapHtml = '<div class="empty">无带日期事件</div>';
  if (shown.length) {
    const t0 = Date.parse(`${shown[0].sort}T00:00:00Z`);
    const t1 = Date.parse(`${shown[shown.length - 1].sort}T00:00:00Z`) || t0 + 1;
    const span = Math.max(1, t1 - t0);
    // month ticks for header
    const months: { label: string; pct: number }[] = [];
    {
      const d0 = new Date(t0);
      const d1 = new Date(t1);
      const cursor = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 1));
      while (cursor.getTime() <= d1.getTime() + 86400000 * 32) {
        const pct = ((cursor.getTime() - t0) / span) * 100;
        if (pct >= -2 && pct <= 102) {
          months.push({
            label: `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`,
            pct: Math.max(0, Math.min(100, pct)),
          });
        }
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        if (months.length > 24) break;
      }
    }
    const headerTicks = months
      .map((m) => `<span class="rm-tick" style="left:${m.pct}%">${escapeHtml(m.label)}</span>`)
      .join('');
    const rows = shown.map((item) => {
      const ts = Date.parse(`${item.sort}T00:00:00Z`);
      const left = ((ts - t0) / span) * 100;
      // single-day campaigns: short bar (min ~3%) so they read as a mark on the scale
      const width = Math.max(2.5, 100 / Math.max(8, shown.length));
      const clampedLeft = Math.min(100 - width, Math.max(0, left));
      const title = item.n.title || item.n.id;
      const href = docsHref(item.n.sourcePath, item.n.sourceLine);
      return `<div class="rm-row node-link" tabindex="0" role="link" data-node-id="${escapeHtml(item.n.id)}"${href ? ` data-href="${escapeHtml(href)}"` : ''} title="${escapeHtml(item.n.date || '')} · ${escapeHtml(title)}">
        <div class="rm-label">
          <span class="rm-date">${escapeHtml(shortDate(item.n.date || item.sort))}</span>
          <span class="rm-title">${escapeHtml(title)}</span>
        </div>
        <div class="rm-track">
          <div class="rm-bar" style="left:${clampedLeft}%;width:${width}%"></div>
        </div>
      </div>`;
    }).join('');
    roadmapHtml = `<div class="roadmap">
      <div class="rm-head">
        <div class="rm-label-h">事件</div>
        <div class="rm-scale">${headerTicks}</div>
      </div>
      <div class="rm-body">${rows}</div>
    </div>`;
  }

  // ── ADR expand map: click ADR → phases with prereq | phase | post index ─
  const coverage = graph.edgeCoverage ?? { inventory: [], unconnected: [] };
  const unconnectedIds = new Set(coverage.unconnected.map((u) => u.id));
  const degree = new Map(coverage.inventory.map((e) => [e.id, e.edgeCount]));

  const adrsAll = graph.nodes.filter((n) => n.kind === 'adr').sort((a, b) => a.id.localeCompare(b.id));
  const phasesAll = graph.nodes.filter((n) => n.kind === 'phase').sort((a, b) => a.id.localeCompare(b.id));
  const bugsAll = graph.nodes.filter((n) => n.kind === 'bug').sort((a, b) => a.id.localeCompare(b.id));

  const isClosedNode = (n: GraphNode): boolean =>
    n.tombstone === true || /CLOSED|DONE|FIXED|合页|关案|TOMBSTONE|NOT_IN_BUGLOG/i.test(n.status);

  const isPhaseOpen = (n: GraphNode): boolean =>
    !isClosedNode(n) && /PLANNED|OPEN|BLOCKED|UNKNOWN|IN_PROGRESS|进行/i.test(n.status);

  /** Prefer specialized ADR (005/006) over roadmap ADR-003 when assigning a phase. */
  const primaryOwnerOfPhase = (phaseId: string): string | undefined => {
    const owners = graph.edges
      .filter((e) => e.kind === 'produces' && e.to === phaseId && (e.from.startsWith('ADR-') || e.from.startsWith('ADR:')))
      .map((e) => e.from);
    if (!owners.length) return undefined;
    const specialized = owners.filter((id) => id !== 'ADR-003').sort();
    if (specialized.length) return specialized[0];
    return owners.sort()[0];
  };

  const phaseOwner = new Map<string, string>();
  for (const p of phasesAll) {
    const owner = primaryOwnerOfPhase(p.id);
    if (owner) phaseOwner.set(p.id, owner);
  }

  // ADR → phases + other artifacts
  const phasesUnderAdr = new Map<string, GraphNode[]>();
  const extrasUnderAdr = new Map<string, Array<{ n: GraphNode; label: string }>>();
  const nestedIds = new Set<string>();
  for (const [phaseId, adrId] of phaseOwner) {
    const n = byId.get(phaseId);
    if (!n) continue;
    const list = phasesUnderAdr.get(adrId) || [];
    list.push(n);
    phasesUnderAdr.set(adrId, list);
    nestedIds.add(n.id);
  }
  for (const e of graph.edges) {
    if (!(e.kind === 'produces' || e.kind === 'tombstones' || e.kind === 'motivates')) continue;
    if (!(e.from.startsWith('ADR-') || e.from.startsWith('ADR:'))) continue;
    const n = byId.get(e.to);
    if (!n || n.kind === 'adr' || n.kind === 'phase') continue;
    if (nestedIds.has(n.id)) continue;
    const list = extrasUnderAdr.get(e.from) || [];
    if (list.some((x) => x.n.id === n.id)) continue;
    list.push({ n, label: e.label || EDGE_LABEL[e.kind] || e.kind });
    extrasUnderAdr.set(e.from, list);
    nestedIds.add(n.id);
  }

  const nextSet = new Set(graph.nextActions);
  const activeAdrIds = new Set<string>();
  for (const [adrId, phases] of phasesUnderAdr) {
    if (phases.some((p) => isPhaseOpen(p) || nextSet.has(p.id))) activeAdrIds.add(adrId);
  }
  for (const e of graph.edges) {
    if (e.kind === 'produces' && nextSet.has(e.to) && (e.from.startsWith('ADR-') || e.from.startsWith('ADR:'))) {
      activeAdrIds.add(e.from);
    }
  }

  const adrsSorted = [...adrsAll].sort((a, b) => {
    const aa = activeAdrIds.has(a.id) ? 0 : 1;
    const bb = activeAdrIds.has(b.id) ? 0 : 1;
    if (aa !== bb) return aa - bb;
    return a.id.localeCompare(b.id);
  });

  /** Index chip — short id + title; click routes to node/md */
  const idxChip = (id: string, role: 'pre' | 'post' | 'self'): string => {
    const n = byId.get(id);
    if (!n) {
      return `<span class="idx-chip missing" title="${escapeHtml(id)}">${escapeHtml(id)}</span>`;
    }
    const href = docsHref(n.sourcePath, n.sourceLine);
    const shortTitle = (n.title || id).replace(/^P[0-5]\s*[·:：-]\s*/, '').slice(0, 22);
    const st = isClosedNode(n) ? 'done' : (isPhaseOpen(n) || nextSet.has(n.id) ? 'open' : '');
    return `<button type="button" class="idx-chip node-link role-${role}${st ? ` ${st}` : ''}"
      data-node-id="${escapeHtml(n.id)}"${href ? ` data-href="${escapeHtml(href)}"` : ''}
      title="${escapeHtml(n.id)} · ${escapeHtml(n.title)} · ${escapeHtml(n.status)}（点击打开）">
      <span class="idx-id">${escapeHtml(n.id.replace(/^phase:/, ''))}</span>
      <span class="idx-t">${escapeHtml(shortTitle)}</span>
    </button>`;
  };

  /** Prereqs of a node: requires edges from → to (to is prereq) */
  const prereqsOfNode = (id: string): string[] =>
    graph.edges.filter((e) => e.kind === 'requires' && e.from === id).map((e) => e.to);

  /** Downstream goals: nodes that require this, or this produces/motivates */
  const postsOfNode = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const e of graph.edges) {
      let other: string | undefined;
      if (e.kind === 'requires' && e.to === id) other = e.from;
      else if ((e.kind === 'produces' || e.kind === 'motivates' || e.kind === 'verifies') && e.from === id) other = e.to;
      if (!other || other === id || seen.has(other)) continue;
      seen.add(other);
      out.push(other);
    }
    return out.sort();
  };

  const phaseRowHtml = (p: GraphNode): string => {
    const pres = prereqsOfNode(p.id);
    const posts = postsOfNode(p.id);
    const open = isPhaseOpen(p) || nextSet.has(p.id);
    const done = isClosedNode(p);
    const badge = open
      ? '<span class="xbadge next">下一步</span>'
      : done
        ? '<span class="xbadge done">已完成</span>'
        : `<span class="xbadge muted">${escapeHtml(p.status)}</span>`;
    return `<div class="phase-row${open ? ' is-open' : ''}${done ? ' is-done' : ''}" data-phase="${escapeHtml(p.id)}">
      <div class="phase-side pre">
        <div class="phase-side-h">前置</div>
        <div class="phase-side-b">${pres.length ? pres.map((id) => idxChip(id, 'pre')).join('') : '<span class="idx-empty">无</span>'}</div>
      </div>
      <div class="phase-mid">
        <div class="phase-rail pre-rail" aria-hidden="true"></div>
        ${idxChip(p.id, 'self')}
        ${badge}
        <div class="phase-rail post-rail" aria-hidden="true"></div>
      </div>
      <div class="phase-side post">
        <div class="phase-side-h">后置 / 目标</div>
        <div class="phase-side-b">${posts.length ? posts.map((id) => idxChip(id, 'post')).join('') : '<span class="idx-empty">无</span>'}</div>
      </div>
    </div>`;
  };

  const adrCardHtml = (n: GraphNode): string => {
    const active = activeAdrIds.has(n.id);
    const href = docsHref(n.sourcePath, n.sourceLine);
    const phases = (phasesUnderAdr.get(n.id) || []).sort((a, b) => a.id.localeCompare(b.id));
    const extras = extrasUnderAdr.get(n.id) || [];
    const phaseN = phases.length;
    const openN = phases.filter((p) => isPhaseOpen(p) || nextSet.has(p.id)).length;
    // Active ADRs start expanded so "正在做的" is visible
    const startOpen = active;
    const panel = `<div class="adr-panel"${startOpen ? '' : ' hidden'}>
      ${phaseN
    ? `<div class="phase-rows">${phases.map(phaseRowHtml).join('')}</div>`
    : '<div class="idx-empty" style="padding:8px 0">此 ADR 未挂 phase（无 defines→P*）</div>'}
      ${extras.length
    ? `<div class="adr-extras"><div class="phase-side-h">其它产物 / 墓碑</div><div class="phase-side-b">${extras.map((x) => idxChip(x.n.id, 'post')).join('')}</div></div>`
    : ''}
      <div class="adr-panel-foot">
        <button type="button" class="node-link plain" data-node-id="${escapeHtml(n.id)}"${href ? ` data-href="${escapeHtml(href)}"` : ''}>打开 ADR 详情 / md ↗</button>
      </div>
    </div>`;
    return `<div class="adr-card${active ? ' active' : ''}${startOpen ? ' open' : ''}" data-adr="${escapeHtml(n.id)}" id="adr-card-${escapeHtml(n.id)}">
      <button type="button" class="xtopic kind-adr adr-toggle${active ? ' active' : ''}"
        data-adr-toggle="${escapeHtml(n.id)}"
        data-node-id="${escapeHtml(n.id)}"
        title="点击展开/收起 phase">
        <span class="xt-top">
          <span class="xt-id">${escapeHtml(n.id)}</span>
          ${active ? '<span class="xbadge on">进行中</span>' : ''}
          <span class="xt-chev" data-chev>${startOpen ? '▾' : '▸'} ${phaseN} phase${openN ? ` · ${openN} 开` : ''}</span>
        </span>
        <span class="xt-title">${escapeHtml((n.title || n.id).slice(0, 48))}</span>
        <span class="xt-meta">${escapeHtml(n.status)} · 点开看前置/后置索引</span>
      </button>
      ${panel}
    </div>`;
  };

  const bugChip = (n: GraphNode): string => {
    const href = docsHref(n.sourcePath, n.sourceLine);
    return `<button type="button" class="idx-chip node-link role-post"
      data-node-id="${escapeHtml(n.id)}"${href ? ` data-href="${escapeHtml(href)}"` : ''}
      title="${escapeHtml(n.title)}">
      <span class="idx-id">${escapeHtml(n.id)}</span>
      <span class="idx-t">${escapeHtml((n.title || '').slice(0, 20))}</span>
    </button>`;
  };

  const unconnectedNodes = coverage.unconnected
    .map((u) => byId.get(u.id))
    .filter((n): n is GraphNode => Boolean(n));

  // Sparse links only: center → each ADR (no hairball)
  type MapLink = { from: string; to: string; kind: string; label: string; layer: 'tree' | 'cross' };
  const mapLinks: MapLink[] = adrsSorted.map((n) => ({
    from: '__center__',
    to: n.id,
    kind: 'hub',
    label: 'adr',
    layer: 'tree' as const,
  }));
  const mapLinksJson = JSON.stringify(mapLinks).replace(/</g, '\\u003c');
  const activeList = [...activeAdrIds].sort().join(' · ') || '（无）';

  const mindMapHtml = `<div class="xmap-wrap" id="xmap-wrap">
    <svg class="xmap-svg" id="xmap-svg" aria-hidden="true"></svg>
    <div class="xmap" id="xmap" aria-label="Chronicle ADR map">
      <div class="xlegend">
        <span class="xlegend-active"><i class="lg active"></i>进行中 ADR（可点开）</span>
        <span class="meta">展开后：左=前置索引 · 中=Phase · 右=后置/目标 · 点击芯片路由到节点/md</span>
      </div>
      <div class="xactive-bar">进行中：<strong>${escapeHtml(activeList)}</strong>
        <span class="meta">（默认已展开；其它 ADR 点击展开）</span>
      </div>
      <div class="xmap-row xmap-row-main">
        <div class="xbranch x-adr" data-branch-id="__branch_adr__">
          <div class="xbranch-h" data-node-id="__branch_adr__">ADR<span class="xcnt">${adrsAll.length}</span></div>
          <div class="xbranch-b adr-list">
            ${adrsSorted.map(adrCardHtml).join('')}
          </div>
        </div>
        <div class="xcenter">
          <div class="xcenter-node" data-node-id="__center__" id="x-center">
            <span class="xcenter-k">Chronicle</span>
            <span class="xcenter-t">${escapeHtml(projectTitle)}</span>
            <span class="xcenter-m">${activeAdrIds.size} 进行中 · ${adrsAll.length} ADR</span>
          </div>
        </div>
        <div class="xbranch x-bug" data-branch-id="__branch_bug__">
          <div class="xbranch-h" data-node-id="__branch_bug__">Bug 索引<span class="xcnt">${bugsAll.length}</span></div>
          <div class="xbranch-b bug-index">${bugsAll.map(bugChip).join('')}</div>
        </div>
      </div>
      <div class="xorphan ${unconnectedNodes.length ? '' : 'ok'}">
        <div class="xorphan-h">未连接 · ${unconnectedNodes.length}
          <span class="meta">${unconnectedNodes.length ? '零边节点' : '（空）边覆盖通过'}</span>
        </div>
        <div class="xorphan-b">
          ${unconnectedNodes.length
    ? unconnectedNodes.map((n) => idxChip(n.id, 'post')).join('')
    : '<span class="xempty">没有未连接的 adr / bug / phase</span>'}
        </div>
      </div>
    </div>
  </div>
  <script type="application/json" id="map-links">${mapLinksJson}</script>`;

  // Relation list: structural edges only (not every INDEX expose), capped for readability
  const structuralEdges = graph.edges.filter(
    (e) => e.kind === 'requires' || e.kind === 'tombstones' || e.kind === 'produces'
      || e.kind === 'motivates' || e.kind === 'verifies',
  );
  const edgeCards = structuralEdges.slice(0, 48).map((e) => {
    const label = e.label || EDGE_LABEL[e.kind] || e.kind;
    const fromH = (() => {
      const n = byId.get(e.from);
      return n ? docsHref(n.sourcePath, n.sourceLine) : '';
    })();
    const toH = (() => {
      const n = byId.get(e.to);
      return n ? docsHref(n.sourcePath, n.sourceLine) : '';
    })();
    const edgeH = docsHref(e.sourcePath, e.sourceLine);
    return `<div class="row-item">
      <div class="row-meta"><span class="tag">${escapeHtml(String(label))}</span><span class="meta mono">${escapeHtml(e.kind)}</span>
        ${edgeH ? `<a class="meta open-md" href="${escapeHtml(edgeH)}" target="_blank" rel="noopener">边源 ↗</a>` : ''}
      </div>
      <div class="row-title mono">
        <button type="button" class="node-link plain" data-node-id="${escapeHtml(e.from)}"${fromH ? ` data-href="${escapeHtml(fromH)}"` : ''}>${escapeHtml(e.from)}</button>
        <span class="arrow">→</span>
        <button type="button" class="node-link plain" data-node-id="${escapeHtml(e.to)}"${toH ? ` data-href="${escapeHtml(toH)}"` : ''}>${escapeHtml(e.to)}</button>
      </div>
      <div class="meta">${escapeHtml(e.sourcePath)}:${e.sourceLine}</div>
    </div>`;
  }).join('\n');

  const coverageTable = coverage.inventory.map((e) => {
    const zero = e.edgeCount === 0;
    return `<tr class="${zero ? 'zero' : ''}">
      <td class="mono">${escapeHtml(e.id)}</td>
      <td>${escapeHtml(e.kind)}</td>
      <td class="num">${e.edgeCount}</td>
      <td>${escapeHtml(e.title.slice(0, 48))}</td>
      <td class="mono meta">${escapeHtml(e.sourcePath)}</td>
    </tr>`;
  }).join('\n');

  const unconnList = coverage.unconnected.length
    ? coverage.unconnected.map((e) => `<li class="node-link" data-node-id="${escapeHtml(e.id)}" tabindex="0"><code>${escapeHtml(e.id)}</code> · ${escapeHtml(e.title)} <span class="meta">${escapeHtml(e.sourcePath)}</span></li>`).join('')
    : '<li class="meta">（空）无零边 adr/bug/phase</li>';

  const bugCards = graph.nodes.filter((n) => n.kind === 'bug').map((n) => browseCard(n)).join('\n');
  const adrCards = graph.nodes.filter((n) => n.kind === 'adr').map((n) => {
    const tombs = graph.nodes.filter(
      (t) => t.tombstone && graph.edges.some((e) => e.kind === 'tombstones' && e.from === n.id && e.to === t.id),
    );
    return `${browseCard(n)}${tombs.length
      ? `<div class="tomb-note">墓碑：${tombs.map((t) => escapeHtml(t.title)).join('；')}</div>`
      : ''}`;
  }).join('\n');

  const nextCards = graph.nextActions.map((id) => {
    const n = byId.get(id);
    return n ? cardHtml(n) : `<article class="issue"><div class="issue-title">${escapeHtml(id)}</div></article>`;
  }).join('\n') || '<div class="empty">（空）</div>';

  const answers = [
    ['a) BUG-011', graph.answers.bug011],
    ['b) J-space 墓碑', graph.answers.jspaceTombstone],
    ['c) 注入实验缺前提', graph.answers.injectionMissing],
  ].map(([t, v]) => `<div class="ans">
      <div class="ans-k">${escapeHtml(t)}</div>
      <div class="ans-v">${escapeHtml(v || '')}</div>
    </div>`).join('\n');

  const data = JSON.stringify(graph).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(projectTitle)} · Chronicle</title>
<style>
/* Linear product density — tokens from linear.app DESIGN.md */
:root{
  color-scheme:dark;
  --canvas:#010102;
  --s1:#0f1011;
  --s2:#141516;
  --s3:#18191a;
  --s4:#191a1b;
  --hair:#23252a;
  --hair-strong:#34343a;
  --hair-3:#3e3e44;
  --ink:#f7f8f8;
  --ink-muted:#d0d6e0;
  --ink-subtle:#8a8f98;
  --ink-tertiary:#62666d;
  --accent:#5e6ad2;
  --accent-hover:#828fff;
  --accent-focus:#5e69d1;
  --success:#27a644;
  --danger:#eb5757;
  --warn:#f2c94c;
  --kind-phase:#5e6ad2;
  --kind-bug:#eb5757;
  --kind-adr:#27a644;
  --kind-campaign:#f2c94c;
  --kind-finding:#a78bfa;
  --done:#27a644;
  --ready:#5e6ad2;
  --blocked:#eb5757;
  --font:Inter,SF Pro Display,-apple-system,system-ui,Segoe UI,Roboto,sans-serif;
  --mono:ui-monospace,SF Mono,Menlo,JetBrains Mono,monospace;
  --r-xs:4px;--r-sm:6px;--r-md:8px;--r-lg:12px;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--canvas);color:var(--ink);
  font:13px/1.45 var(--font);-webkit-font-smoothing:antialiased;letter-spacing:-0.01em}
a{color:var(--accent-hover);text-decoration:none}
a:hover{text-decoration:underline}
code,.mono{font-family:var(--mono);font-size:12px;letter-spacing:0}
.meta{color:var(--ink-subtle);font-size:12px}
.empty{color:var(--ink-tertiary);padding:16px;font-size:12px}

/* ── chrome: inverted-L ── */
.app{display:grid;grid-template-columns:200px 1fr;min-height:100vh}
@media(max-width:800px){.app{grid-template-columns:1fr}.side{display:none}}
.side{background:var(--canvas);border-right:1px solid var(--hair);padding:16px 12px;position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:4px}
.brand{display:flex;align-items:center;gap:8px;padding:4px 8px 16px;font-weight:600;font-size:13px;letter-spacing:-0.02em}
.brand-mark{width:16px;height:16px;border-radius:4px;background:var(--accent);flex-shrink:0}
.side-meta{padding:0 8px 12px;border-bottom:1px solid var(--hair);margin-bottom:8px}
.side-meta .chip{display:block;color:var(--ink-tertiary);font-size:11px;font-family:var(--mono);line-height:1.6;word-break:break-all}
.side nav{display:flex;flex-direction:column;gap:1px}
.side nav button{
  text-align:left;background:transparent;border:0;color:var(--ink-subtle);
  padding:6px 8px;border-radius:var(--r-sm);cursor:pointer;font:500 13px/1.3 var(--font);
}
.side nav button:hover{background:var(--s2);color:var(--ink)}
.side nav button.on{background:var(--s2);color:var(--ink)}
.side nav button.on::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent);margin-right:8px;vertical-align:middle}

.main-wrap{display:flex;flex-direction:column;min-width:0;background:var(--canvas)}
.top{height:48px;display:flex;align-items:center;gap:12px;padding:0 20px;border-bottom:1px solid var(--hair);position:sticky;top:0;z-index:10;background:rgba(1,1,2,.92);backdrop-filter:blur(8px)}
.top h1{margin:0;font-size:13px;font-weight:500;color:var(--ink-muted);letter-spacing:-0.01em}
.top h1 strong{color:var(--ink);font-weight:600}
.top-stats{margin-left:auto;display:flex;gap:8px;align-items:center}
.pill{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:9999px;background:var(--s2);color:var(--ink-subtle);font-size:11px;border:1px solid var(--hair)}
.pill b{color:var(--ink-muted);font-weight:500}

main{padding:20px 24px 64px;max-width:1280px;width:100%}
section.block{display:none}
section.block.on{display:block}

/* section headers */
.sec{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 10px}
.sec h2{margin:0;font-size:13px;font-weight:600;letter-spacing:-0.02em;color:var(--ink)}
.sec .hint{color:var(--ink-tertiary);font-size:12px}
.sec-gap{margin-top:28px}

/* answers — compact key/value strip */
.answers{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--hair);border:1px solid var(--hair);border-radius:var(--r-lg);overflow:hidden;margin-bottom:24px}
@media(max-width:900px){.answers{grid-template-columns:1fr}}
.ans{background:var(--s1);padding:12px 14px}
.ans-k{font-size:11px;font-weight:500;color:var(--ink-subtle);letter-spacing:.02em;margin-bottom:6px;text-transform:uppercase}
.ans-v{font-size:13px;color:var(--ink-muted);line-height:1.45}

/* ── Roadmap (Linear Gantt density) ── */
.roadmap{border:1px solid var(--hair);border-radius:var(--r-lg);background:var(--s1);overflow:hidden}
.rm-head{display:grid;grid-template-columns:240px 1fr;border-bottom:1px solid var(--hair);height:28px;align-items:stretch;background:var(--s2)}
.rm-label-h{padding:0 12px;display:flex;align-items:center;font-size:11px;color:var(--ink-tertiary);border-right:1px solid var(--hair);font-weight:500}
.rm-scale{position:relative;min-height:28px}
.rm-tick{position:absolute;top:0;bottom:0;transform:translateX(-50%);font-size:10px;color:var(--ink-tertiary);padding-top:7px;font-family:var(--mono);white-space:nowrap;border-left:1px solid var(--hair)}
.rm-body{max-height:420px;overflow:auto}
.rm-row{display:grid;grid-template-columns:240px 1fr;min-height:32px;border-bottom:1px solid var(--hair)}
.rm-row:last-child{border-bottom:0}
.rm-row:hover{background:var(--s2)}
.rm-label{padding:6px 12px;border-right:1px solid var(--hair);display:flex;flex-direction:column;justify-content:center;gap:1px;min-width:0}
.rm-date{font-family:var(--mono);font-size:10px;color:var(--ink-tertiary)}
.rm-title{font-size:12px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}
.rm-track{position:relative;background:
  repeating-linear-gradient(90deg,transparent,transparent calc(12.5% - 1px),var(--hair) calc(12.5% - 1px),var(--hair) 12.5%)}
.rm-bar{position:absolute;top:50%;transform:translateY(-50%);height:8px;border-radius:3px;background:var(--accent);box-shadow:0 0 0 1px rgba(94,106,210,.35);min-width:8px}
@media(max-width:720px){
  .rm-head,.rm-row{grid-template-columns:1fr}
  .rm-label-h,.rm-label{border-right:0}
  .rm-scale,.rm-track{display:none}
}

/* ── Board (Linear issue columns) ── */
.board{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;align-items:start}
@media(max-width:900px){.board{grid-template-columns:1fr}}
.col{background:var(--s1);border:1px solid var(--hair);border-radius:var(--r-lg);min-height:120px;overflow:hidden}
.col-h{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--hair);font-size:12px;font-weight:500;color:var(--ink-muted)}
.col-h .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.col.done .dot{background:var(--done)}
.col.ready .dot{background:var(--ready)}
.col.blocked .dot{background:var(--blocked)}
.col-h .cnt{margin-left:auto;color:var(--ink-tertiary);font-family:var(--mono);font-size:11px}
.col-body{padding:6px;display:flex;flex-direction:column;gap:4px;max-height:560px;overflow:auto}

/* issue cards */
.issue{background:var(--s2);border:1px solid var(--hair);border-radius:var(--r-md);padding:8px 10px;cursor:pointer}
.issue:hover{border-color:var(--accent);background:var(--s3)}
.issue:focus-visible{outline:2px solid var(--accent-focus);outline-offset:1px}
.issue-top{display:flex;align-items:center;gap:6px;margin-bottom:4px}
.open-hint{margin-left:auto;font-size:10px;color:var(--ink-tertiary);flex-shrink:0}
.issue:hover .open-hint{color:var(--accent-hover)}
button.tag,button.plain{font:inherit;cursor:pointer}
button.tag{display:inline-flex;align-items:center;font-size:10px;font-family:var(--mono);padding:1px 6px;border-radius:var(--r-xs);background:var(--s1);color:var(--ink-subtle);border:1px solid var(--hair);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button.tag:hover{border-color:var(--accent);color:var(--ink)}
button.plain{background:none;border:0;padding:0;color:var(--accent-hover);text-align:left}
button.plain:hover{text-decoration:underline;color:var(--ink)}
a.hit{cursor:pointer;text-decoration:none}
a.hit:hover .nrect{stroke:var(--accent)!important;stroke-width:1.5}
g.hit{cursor:pointer}
g.hit:hover .nrect{stroke:var(--accent)!important}
.rm-row{cursor:pointer}
.rm-row:hover .rm-title{color:var(--accent-hover)}
.open-md{color:var(--accent-hover)!important;margin-left:auto}
.browse-item{cursor:pointer}
.browse-item:hover{border-color:var(--accent)!important}

/* detail drawer */
.drawer-bg{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:40;opacity:0;pointer-events:none;transition:opacity .15s}
.drawer-bg.on{opacity:1;pointer-events:auto}
.drawer{position:fixed;top:0;right:0;bottom:0;width:min(560px,100vw);background:var(--s1);border-left:1px solid var(--hair);z-index:50;transform:translateX(100%);transition:transform .18s ease;display:flex;flex-direction:column;box-shadow:-12px 0 40px rgba(0,0,0,.4)}
.drawer.on{transform:translateX(0)}
.drawer-h{display:flex;align-items:flex-start;gap:10px;padding:14px 16px;border-bottom:1px solid var(--hair)}
.drawer-h .titles{flex:1;min-width:0}
.drawer-h .id{font-family:var(--mono);font-size:11px;color:var(--ink-tertiary)}
.drawer-h h3{margin:4px 0 0;font-size:15px;font-weight:600;letter-spacing:-0.02em;line-height:1.3}
.drawer-x{background:transparent;border:1px solid var(--hair);color:var(--ink-subtle);width:28px;height:28px;border-radius:var(--r-sm);cursor:pointer;flex-shrink:0}
.drawer-x:hover{background:var(--s2);color:var(--ink)}
.drawer-b{padding:14px 16px;overflow:auto;flex:1;display:flex;flex-direction:column;gap:14px}
.drawer-row{display:flex;flex-direction:column;gap:4px}
.drawer-row .k{font-size:11px;color:var(--ink-tertiary);font-weight:500;text-transform:uppercase;letter-spacing:.03em}
.drawer-row .v{font-size:13px;color:var(--ink-muted);line-height:1.5;white-space:pre-wrap;word-break:break-word}
.drawer-actions{display:flex;flex-wrap:wrap;gap:8px;padding-top:4px}
.btn-primary{display:inline-flex;align-items:center;gap:6px;background:var(--accent);color:#fff;border:0;border-radius:var(--r-md);padding:8px 14px;font:500 13px/1.2 var(--font);cursor:pointer;text-decoration:none}
.btn-primary:hover{background:var(--accent-hover);text-decoration:none;color:#fff}
.btn-ghost{display:inline-flex;align-items:center;background:var(--s2);color:var(--ink);border:1px solid var(--hair);border-radius:var(--r-md);padding:8px 14px;font:500 13px/1.2 var(--font);cursor:pointer;text-decoration:none}
.btn-ghost:hover{border-color:var(--hair-strong);text-decoration:none;color:var(--ink)}
.prereq-list{display:flex;flex-direction:column;gap:4px}
.prereq-list button{text-align:left}
#d-src-wrap{display:none}
#d-src-wrap.on{display:flex;flex-direction:column;gap:6px;flex:1;min-height:0}
#d-src-body{
  margin:0;padding:12px;background:var(--canvas);border:1px solid var(--hair);border-radius:var(--r-md);
  font:12px/1.55 var(--mono);color:var(--ink-muted);white-space:pre-wrap;word-break:break-word;
  max-height:min(55vh,520px);overflow:auto
}
#d-src-status{font-size:11px;color:var(--ink-tertiary)}
.kind{width:8px;height:8px;border-radius:2px;flex-shrink:0;background:var(--ink-tertiary)}
.kind-phase{background:var(--kind-phase)}
.kind-bug{background:var(--kind-bug)}
.kind-adr{background:var(--kind-adr)}
.kind-campaign{background:var(--kind-campaign)}
.kind-finding{background:var(--kind-finding)}
.issue-id{color:var(--ink-tertiary);font-size:11px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.status{font-size:10px;color:var(--ink-subtle);background:var(--s1);border:1px solid var(--hair);border-radius:9999px;padding:1px 6px;flex-shrink:0;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.issue-title{font-size:13px;font-weight:500;color:var(--ink);letter-spacing:-0.01em;line-height:1.35}
.issue-sum{font-size:12px;color:var(--ink-subtle);margin-top:4px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.issue-req{margin-top:6px;padding-top:6px;border-top:1px solid var(--hair);display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.tag{display:inline-flex;align-items:center;font-size:10px;font-family:var(--mono);padding:1px 6px;border-radius:var(--r-xs);background:var(--s1);color:var(--ink-subtle);border:1px solid var(--hair);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag.ok{color:#6ee7a0;border-color:rgba(39,166,68,.35);background:rgba(39,166,68,.08)}
.tag.bad{color:#f5a8a8;border-color:rgba(235,87,87,.35);background:rgba(235,87,87,.08)}

/* graph */
/* ── XMind mind map + SVG relation curves ── */
.xmap-wrap{position:relative;background:var(--s1);border:1px solid var(--hair);border-radius:16px;overflow:auto}
.xmap-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:1}
.xmap-svg path{fill:none;stroke-linecap:round;stroke-linejoin:round;transition:stroke-opacity .15s,stroke-width .15s}
.xmap-svg path.hub{stroke:#3e3e44;stroke-width:1.25;stroke-opacity:.55}
.xmap-svg path.tree{stroke:#5e6ad2;stroke-width:1.6;stroke-opacity:.55}
.xmap-svg path.produces{stroke:#27a644;stroke-width:1.5;stroke-opacity:.55}
.xmap-svg path.requires{stroke:#5e6ad2;stroke-width:1.5;stroke-opacity:.5;stroke-dasharray:5 4}
.xmap-svg path.motivates{stroke:#f2c94c;stroke-width:1.4;stroke-opacity:.55}
.xmap-svg path.tombstones{stroke:#8a8f98;stroke-width:1.35;stroke-opacity:.5;stroke-dasharray:3 3}
.xmap-svg path.verifies{stroke:#a78bfa;stroke-width:1.35;stroke-opacity:.5}
.xmap-svg path.cross{stroke-opacity:.35}
.xmap-svg path.dim{stroke-opacity:.08}
.xmap-svg path.hot{stroke-opacity:.95;stroke-width:2.4}
.xmap-svg text.elabel{font:10px var(--mono);fill:#8a8f98;pointer-events:none}
.xmap{position:relative;z-index:2;padding:20px 24px 32px;min-width:960px}
.xlegend{display:flex;flex-wrap:wrap;gap:12px 16px;align-items:center;margin-bottom:12px;font-size:11px;color:var(--ink-subtle)}
.xlegend i.lg{display:inline-block;width:18px;height:0;border-top:2px solid;margin-right:6px;vertical-align:middle;border-radius:1px}
.xlegend i.tree{border-color:#5e6ad2}
.xlegend i.produces{border-color:#27a644}
.xlegend i.requires{border-color:#5e6ad2;border-top-style:dashed}
.xlegend i.motivates{border-color:#f2c94c}
.xlegend i.tombstones{border-color:#8a8f98;border-top-style:dashed}
.xlegend i.active{border-color:#828fff;border-top-width:3px}
.xlegend-active{color:var(--accent-hover);font-weight:500}
.xactive-bar{
  margin:0 0 18px;padding:8px 12px;border-radius:10px;font-size:12px;color:var(--ink-muted);
  background:rgba(94,106,210,.12);border:1px solid rgba(94,106,210,.35)
}
.xactive-bar strong{color:var(--accent-hover);font-weight:600;margin-right:6px}
.xmap-row{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(140px,180px) minmax(0,.9fr);gap:28px 36px;align-items:start}
.xmap-row-main{/* ADR + center + Bug */}
.xcenter{display:flex;justify-content:center;padding-top:12px;position:relative}
.xcenter-node{
  width:160px;min-height:88px;padding:16px 14px;border-radius:18px;text-align:center;
  background:linear-gradient(160deg,#2a3170 0%,#5e6ad2 100%);color:#fff;
  box-shadow:0 8px 28px rgba(94,106,210,.28);display:flex;flex-direction:column;gap:4px;justify-content:center
}
.xcenter-k{font-size:11px;opacity:.85;letter-spacing:.06em;text-transform:uppercase}
.xcenter-t{font-size:15px;font-weight:600;letter-spacing:-0.02em;line-height:1.25}
.xcenter-m{font-size:10px;opacity:.8;margin-top:4px;line-height:1.3}
.xbranch{position:relative;min-width:0}
.xbranch-h{
  display:inline-flex;align-items:center;gap:8px;margin:0 0 16px;padding:6px 12px;
  font-size:12px;font-weight:600;color:var(--ink-muted);letter-spacing:.02em;
  background:var(--s2);border:1px solid var(--hair);border-radius:999px
}
.xbranch-h .xcnt{
  font-family:var(--mono);font-size:11px;font-weight:500;color:var(--ink-tertiary);
  background:var(--canvas);border:1px solid var(--hair);border-radius:999px;padding:1px 8px
}
.xbranch-b{display:flex;flex-direction:column;gap:12px}
.adr-list{gap:10px}
.adr-card{
  border:1px solid var(--hair);border-radius:14px;background:var(--s2);overflow:hidden;
  transition:border-color .15s,box-shadow .15s
}
.adr-card.active{border-color:rgba(130,143,255,.5);box-shadow:0 0 0 1px rgba(94,106,210,.2)}
.adr-card.open{border-color:rgba(130,143,255,.55)}
.adr-toggle{
  display:flex;flex-direction:column;align-items:flex-start;gap:3px;text-align:left;width:100%;
  padding:12px 14px;background:transparent;border:0;color:var(--ink);cursor:pointer;font:inherit
}
.adr-toggle:hover{background:var(--s3)}
.adr-toggle.active{background:linear-gradient(135deg,rgba(94,106,210,.18),rgba(94,106,210,.05))}
.xt-top{display:flex;align-items:center;gap:8px;width:100%;flex-wrap:wrap}
.xt-id{font-family:var(--mono);font-size:11px;color:var(--ink-tertiary)}
.xt-chev{margin-left:auto;font-size:11px;color:var(--ink-tertiary);font-family:var(--mono)}
.xt-title{font-size:13px;font-weight:500;letter-spacing:-0.01em;line-height:1.35;color:var(--ink)}
.xt-meta{font-size:10px;color:var(--ink-tertiary);margin-top:2px}
.xbadge{font-size:10px;font-weight:600;padding:1px 7px;border-radius:999px;letter-spacing:.02em}
.xbadge.on{background:var(--accent);color:#fff}
.xbadge.next{background:rgba(130,143,255,.2);color:var(--accent-hover);border:1px solid rgba(130,143,255,.45)}
.xbadge.done{background:rgba(39,166,68,.15);color:#6ee7a0;border:1px solid rgba(39,166,68,.35)}
.xbadge.muted{background:var(--s1);color:var(--ink-tertiary);border:1px solid var(--hair)}
.adr-panel{padding:0 12px 12px;border-top:1px solid var(--hair);background:var(--s1)}
.adr-panel[hidden]{display:none!important}
.phase-rows{display:flex;flex-direction:column;gap:10px;padding-top:12px}
.phase-row{
  display:grid;grid-template-columns:1fr minmax(120px,150px) 1fr;gap:8px 10px;align-items:center;
  padding:10px;border-radius:12px;background:var(--s2);border:1px solid var(--hair)
}
.phase-row.is-open{border-color:rgba(130,143,255,.45);background:rgba(94,106,210,.08)}
.phase-row.is-done{opacity:.78}
.phase-side-h{font-size:10px;color:var(--ink-tertiary);font-weight:500;margin-bottom:6px;letter-spacing:.04em;text-transform:uppercase}
.phase-side-b{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-start}
.phase-mid{display:flex;flex-direction:column;align-items:center;gap:6px;position:relative}
.phase-rail{display:none}
.idx-chip{
  display:inline-flex;flex-direction:column;align-items:flex-start;gap:1px;max-width:100%;
  padding:5px 8px;border-radius:8px;border:1px solid var(--hair);background:var(--canvas);
  color:var(--ink);cursor:pointer;font:inherit;text-align:left;transition:border-color .12s,background .12s
}
.idx-chip:hover{border-color:var(--accent);background:var(--s3)}
.idx-chip.role-pre{border-color:rgba(242,201,76,.35)}
.idx-chip.role-post{border-color:rgba(39,166,68,.35)}
.idx-chip.role-self{border-color:rgba(94,106,210,.55);background:rgba(94,106,210,.12);align-items:center;text-align:center;min-width:110px}
.idx-chip.open{box-shadow:0 0 0 1px rgba(130,143,255,.35)}
.idx-chip.done{opacity:.75}
.idx-id{font-family:var(--mono);font-size:10px;color:var(--ink-tertiary)}
.idx-t{font-size:11px;font-weight:500;color:var(--ink);line-height:1.3;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.idx-chip.role-self .idx-t{max-width:130px;white-space:normal}
.idx-empty{font-size:11px;color:var(--ink-tertiary)}
.adr-extras{margin-top:10px;padding-top:10px;border-top:1px dashed var(--hair)}
.adr-panel-foot{margin-top:10px;padding-top:8px;border-top:1px solid var(--hair)}
.bug-index{display:flex;flex-wrap:wrap;gap:6px;align-content:flex-start}
.xempty{color:var(--ink-tertiary);font-size:12px;padding:8px 0}
.xorphan{margin-top:36px;padding-top:20px;border-top:1px dashed var(--hair-3)}
.xorphan-h{font-size:12px;font-weight:600;color:var(--danger);margin-bottom:12px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.xorphan.ok .xorphan-h{color:var(--success)}
.xorphan-b{display:flex;flex-wrap:wrap;gap:8px}
@media(max-width:960px){
  .xmap{min-width:0}
  .xmap-row{grid-template-columns:1fr}
  .xcenter{order:-1}
  .phase-row{grid-template-columns:1fr}
}
.cov-table{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0 16px}
.cov-table th,.cov-table td{border-bottom:1px solid var(--hair);padding:6px 8px;text-align:left}
.cov-table th{color:var(--ink-tertiary);font-weight:500;font-size:11px}
.cov-table tr.zero td{color:var(--danger);background:rgba(235,87,87,.06)}
.cov-table .num{font-family:var(--mono);text-align:right}
.unconn-box{border:1px solid rgba(235,87,87,.45);border-radius:var(--r-lg);background:rgba(235,87,87,.06);padding:12px 14px;margin:0 0 16px}
.unconn-box.ok{border-color:rgba(39,166,68,.35);background:rgba(39,166,68,.06)}
.unconn-box h3{margin:0 0 8px;font-size:12px;font-weight:600;color:var(--danger)}
.unconn-box.ok h3{color:var(--success)}
.unconn-box ul{margin:0;padding-left:18px}
.unconn-box li{margin:4px 0;cursor:pointer;font-size:12px}
.unconn-box li:hover{color:var(--accent-hover)}
details.cov-details{margin-top:8px;border:1px solid var(--hair);border-radius:var(--r-lg);background:var(--s1);padding:10px 14px}
details.cov-details summary{cursor:pointer;color:var(--ink-muted);font-size:12px;font-weight:500}
details.cov-details[open] summary{margin-bottom:10px;color:var(--ink)}

.list{display:flex;flex-direction:column;gap:1px;background:var(--hair);border:1px solid var(--hair);border-radius:var(--r-lg);overflow:hidden}
.row-item{background:var(--s1);padding:10px 12px}
.row-item:hover{background:var(--s2)}
.row-meta{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.row-title{font-size:13px;color:var(--ink);font-weight:500;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.row-title .arrow{color:var(--ink-tertiary)}
.browse-item{background:var(--s1);border:1px solid var(--hair);border-radius:var(--r-md);padding:10px 12px;margin:0 0 6px}
.browse-item:hover{border-color:var(--hair-strong)}
.browse-item h4{margin:0 0 4px;font-size:13px;font-weight:500;display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.browse-item .body{white-space:pre-wrap;font-size:12px;color:var(--ink-subtle);line-height:1.45}
.tomb-note{color:var(--ink-tertiary);font-size:11px;margin:-2px 0 10px 12px}
pre.box{background:var(--s1);padding:12px;border-radius:var(--r-md);border:1px solid var(--hair);white-space:pre-wrap;font:12px/1.5 var(--mono);color:var(--ink-subtle);margin:0}
.next-list{display:flex;flex-direction:column;gap:4px;max-width:640px}
</style>
</head>
<body>
<div class="app">
  <aside class="side">
    <div class="brand"><span class="brand-mark"></span>Chronicle</div>
    <div class="side-meta">
      <span class="chip">${graph.nodes.length} nodes · ${graph.edges.length} edges</span>
      <span class="chip">hash ${escapeHtml(graph.contentHash.slice(0, 12))}…</span>
    </div>
    <nav class="tabs" id="tabs">
      <button type="button" data-tab="overview" class="on">总览</button>
      <button type="button" data-tab="graph">关系图</button>
      <button type="button" data-tab="bugs">Buglog</button>
      <button type="button" data-tab="adrs">ADR</button>
      <button type="button" data-tab="next">下一步</button>
    </nav>
  </aside>
  <div class="main-wrap">
    <header class="top">
      <h1><strong>${escapeHtml(projectTitle)}</strong> · knowledge board</h1>
      <div class="top-stats">
        <span class="pill"><b>${cols.ready.length}</b> ready</span>
        <span class="pill"><b>${cols.blocked.length}</b> blocked</span>
        <span class="pill"><b>${cols.done.length}</b> done</span>
      </div>
    </header>
    <main>
      <section class="block on" id="tab-overview">
        <div class="answers">${answers}</div>

        <div class="sec">
          <h2>时间轴</h2>
          <span class="hint">INDEX 战役 · roadmap 密度</span>
        </div>
        ${roadmapHtml}

        <div class="sec sec-gap">
          <h2>紧迫度看板</h2>
          <span class="hint">已完成 · 可并行 · 被挡住</span>
        </div>
        <div class="board">
          <div class="col done">
            <div class="col-h"><span class="dot"></span>已完成<span class="cnt">${cols.done.length}</span></div>
            <div class="col-body">${cols.done.map(cardHtml).join('') || '<div class="empty">（空）</div>'}</div>
          </div>
          <div class="col ready">
            <div class="col-h"><span class="dot"></span>可并行推进<span class="cnt">${cols.ready.length}</span></div>
            <div class="col-body">${cols.ready.map(cardHtml).join('') || '<div class="empty">（空）</div>'}</div>
          </div>
          <div class="col blocked">
            <div class="col-h"><span class="dot"></span>被挡住<span class="cnt">${cols.blocked.length}</span></div>
            <div class="col-body">${cols.blocked.map(cardHtml).join('') || '<div class="empty">（空）</div>'}</div>
          </div>
        </div>
      </section>

      <section class="block" id="tab-graph" hidden>
        <div class="sec">
          <h2>关系图 · 思维导图</h2>
          <span class="hint">XMind 式：中心主题 + 分支；点节点看详情 / 打开 md</span>
        </div>
        ${mindMapHtml}
        <details class="cov-details sec-gap">
          <summary>边覆盖审计 · ${coverage.inventory.length} 节点 · 未连接 ${coverage.unconnected.length}</summary>
          <div class="unconn-box ${coverage.unconnected.length ? '' : 'ok'}">
            <h3>未连接 · ${coverage.unconnected.length}</h3>
            <ul>${unconnList}</ul>
          </div>
          <table class="cov-table">
            <thead><tr><th>id</th><th>kind</th><th>edges</th><th>title</th><th>source</th></tr></thead>
            <tbody>${coverageTable}</tbody>
          </table>
        </details>
        <details class="cov-details">
          <summary>关系清单 · ${structuralEdges.length} 条结构边（不含 INDEX exposes 噪声）</summary>
          <div class="list" style="margin-top:10px">${edgeCards || '<div class="empty">无边</div>'}</div>
        </details>
      </section>

      <section class="block" id="tab-bugs" hidden>
        <div class="sec">
          <h2>Buglog</h2>
          <span class="hint">源文件相对 docs/ 打开</span>
        </div>
        ${bugCards || '<div class="empty">无 bug 节点</div>'}
      </section>

      <section class="block" id="tab-adrs" hidden>
        <div class="sec">
          <h2>ADR</h2>
          <span class="hint">含墓碑关联</span>
        </div>
        ${adrCards || '<div class="empty">无 ADR 节点</div>'}
      </section>

      <section class="block" id="tab-next" hidden>
        <div class="sec">
          <h2>下一步</h2>
          <span class="hint">机器推导</span>
        </div>
        <div class="next-list">${nextCards}</div>
        <div class="sec sec-gap">
          <h2>图 vs todo diff</h2>
        </div>
        <pre class="box">${escapeHtml(JSON.stringify(graph.todoDiff, null, 2))}</pre>
        <div class="sec sec-gap">
          <h2>解析错误</h2>
        </div>
        <pre class="box">${escapeHtml(graph.parseErrors.length
    ? graph.parseErrors.map((e) => `${e.path}:${e.line} ${e.message}`).join('\n')
    : '（无）')}</pre>
      </section>
    </main>
  </div>
</div>

<div class="drawer-bg" id="drawer-bg" hidden></div>
<aside class="drawer" id="drawer" aria-hidden="true">
  <div class="drawer-h">
    <div class="titles">
      <div class="id" id="d-id"></div>
      <h3 id="d-title"></h3>
    </div>
    <button type="button" class="drawer-x" id="drawer-x" aria-label="关闭">✕</button>
  </div>
  <div class="drawer-b">
    <div class="drawer-row"><div class="k">状态 · 类型</div><div class="v" id="d-status"></div></div>
    <div class="drawer-row"><div class="k">摘要</div><div class="v" id="d-sum"></div></div>
    <div class="drawer-row"><div class="k">前置</div><div class="v prereq-list" id="d-pre"></div></div>
    <div class="drawer-row"><div class="k">源文件</div><div class="v mono" id="d-src"></div></div>
    <div class="drawer-actions" id="d-actions"></div>
    <div class="drawer-row" id="d-src-wrap">
      <div class="k">源内容 <span id="d-src-status"></span></div>
      <pre id="d-src-body"></pre>
    </div>
  </div>
</aside>

<script id="graph-data" type="application/json">${data}</script>
<script>
(function(){
  var graph = {};
  try {
    var el = document.getElementById('graph-data');
    graph = el ? JSON.parse(el.textContent || '{}') : {};
  } catch (e) { graph = {}; }
  var byId = {};
  (graph.nodes || []).forEach(function(n){ byId[n.id] = n; });
  var requires = (graph.edges || []).filter(function(e){ return e.kind === 'requires'; });
  var lastSrcText = '';
  var lastSrcHref = '';
  var lastSrcTitle = '';

  function hrefOf(n) {
    if (!n || !n.sourcePath) return '';
    var p = String(n.sourcePath);
    if (p.indexOf('docs/') === 0) return p.slice(5);
    return '';
  }
  function isMd(path) {
    return /\\.md$/i.test(path || '');
  }
  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var drawer = document.getElementById('drawer');
  var drawerBg = document.getElementById('drawer-bg');
  function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove('on');
    drawer.setAttribute('aria-hidden', 'true');
    if (drawerBg) { drawerBg.classList.remove('on'); drawerBg.setAttribute('hidden', ''); }
  }

  function setSrcPreview(state, text) {
    var wrap = document.getElementById('d-src-wrap');
    var body = document.getElementById('d-src-body');
    var st = document.getElementById('d-src-status');
    if (!wrap || !body || !st) return;
    if (!state) {
      wrap.classList.remove('on');
      body.textContent = '';
      st.textContent = '';
      return;
    }
    wrap.classList.add('on');
    st.textContent = state;
    body.textContent = text || '';
  }

  /** Open UTF-8 text in a new tab as HTML (avoids raw .md charset mojibake). */
  function openUtf8Tab(title, text, href) {
    var html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>' + escHtml(title || href || 'source') + '</title>'
      + '<style>body{margin:0;background:#010102;color:#f7f8f8;font:14px/1.55 ui-sans-serif,system-ui,sans-serif}'
      + 'header{padding:12px 20px;border-bottom:1px solid #23252a;color:#8a8f98;font-size:12px}'
      + 'pre{margin:0;padding:20px;white-space:pre-wrap;word-break:break-word;font:13px/1.55 ui-monospace,SF Mono,Menlo,monospace;color:#d0d6e0}</style>'
      + '</head><body><header>' + escHtml(href || '') + ' · UTF-8</header><pre>'
      + escHtml(text) + '</pre></body></html>';
    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(function(){ URL.revokeObjectURL(url); }, 60000);
  }

  function loadSource(href, n) {
    if (!href) {
      setSrcPreview(null);
      return;
    }
    setSrcPreview('加载中…', '');
    lastSrcHref = href;
    lastSrcTitle = (n && (n.title || n.id)) || href;
    // fetch + text() forces UTF-8 decode — fixes python http.server missing charset
    fetch(href, { credentials: 'same-origin' })
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function(text) {
        lastSrcText = text;
        var line = n && n.sourceLine ? Number(n.sourceLine) : 0;
        var shown = text;
        var note = 'UTF-8 · ' + text.length + ' chars';
        if (line > 1) {
          var lines = text.split(/\\r?\\n/);
          var from = Math.max(0, line - 4);
          var to = Math.min(lines.length, line + 40);
          shown = lines.slice(from, to).map(function(L, i) {
            var no = from + i + 1;
            return (no === line ? '› ' : '  ') + String(no).padStart(4, ' ') + ' │ ' + L;
          }).join('\\n');
          note += ' · 定位 L' + line;
        }
        setSrcPreview(note, shown);
      })
      .catch(function(err) {
        lastSrcText = '';
        setSrcPreview('加载失败: ' + (err && err.message ? err.message : String(err)), '');
      });
  }

  function openDrawer(n) {
    if (!drawer || !n) return;
    document.getElementById('d-id').textContent = n.id;
    document.getElementById('d-title').textContent = n.title || n.id;
    document.getElementById('d-status').textContent = (n.status || '—') + ' · ' + (n.kind || '');
    document.getElementById('d-sum').textContent = n.summary || '（无摘要）';
    document.getElementById('d-src').textContent = (n.sourcePath || '—') + (n.sourceLine ? (':' + n.sourceLine) : '');
    var preEl = document.getElementById('d-pre');
    preEl.innerHTML = '';
    var pres = requires.filter(function(e){ return e.from === n.id; }).map(function(e){ return e.to; });
    if (!pres.length) {
      preEl.textContent = '无硬前置';
    } else {
      pres.forEach(function(id) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tag node-link';
        btn.setAttribute('data-node-id', id);
        var pn = byId[id];
        var hh = hrefOf(pn);
        if (hh) btn.setAttribute('data-href', hh);
        btn.textContent = id;
        preEl.appendChild(btn);
      });
    }
    var act = document.getElementById('d-actions');
    act.innerHTML = '';
    var h = hrefOf(n);
    if (h) {
      var tabBtn = document.createElement('button');
      tabBtn.type = 'button';
      tabBtn.className = 'btn-primary';
      tabBtn.textContent = isMd(n.sourcePath) ? '新标签阅读（UTF-8）' : '新标签阅读（UTF-8）';
      tabBtn.addEventListener('click', function() {
        if (lastSrcText) openUtf8Tab(lastSrcTitle, lastSrcText, lastSrcHref || h);
        else {
          fetch(h).then(function(r){ return r.text(); }).then(function(t) {
            openUtf8Tab(n.title || n.id, t, h);
          });
        }
      });
      act.appendChild(tabBtn);
    } else {
      var note = document.createElement('span');
      note.className = 'meta';
      note.textContent = n.sourcePath
        ? '源文件不在 docs/ 下，当前 http 根目录无法 fetch；路径见上。'
        : '无源路径';
      act.appendChild(note);
    }
    setSrcPreview(null);
    drawer.classList.add('on');
    drawer.setAttribute('aria-hidden', 'false');
    if (drawerBg) { drawerBg.classList.add('on'); drawerBg.removeAttribute('hidden'); }
    if (h) loadSource(h, n);
  }

  function openNode(id, hrefHint) {
    var n = byId[id];
    var href = hrefHint || (n ? hrefOf(n) : '');
    if (n) {
      openDrawer(n);
      return;
    }
    // edge-only / unknown id but has href
    if (href) {
      openDrawer({ id: id || href, title: href, status: '', kind: 'source', summary: '', sourcePath: 'docs/' + href, sourceLine: 0 });
    }
  }

  function toggleAdrCard(card) {
    if (!card) return;
    var open = card.classList.toggle('open');
    var panel = card.querySelector('.adr-panel');
    if (panel) {
      if (open) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
    }
    var chev = card.querySelector('[data-chev]');
    if (chev) {
      chev.textContent = (open ? '▾' : '▸') + chev.textContent.replace(/^[▾▸]\s*/, ' ');
    }
    setTimeout(drawMapLinks, 40);
  }

  document.addEventListener('click', function(ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    if (t.closest('#drawer-x') || t.closest('#drawer-bg')) { closeDrawer(); return; }

    // ADR header: expand/collapse phases (not open drawer)
    var tog = t.closest('.adr-toggle');
    if (tog) {
      ev.preventDefault();
      ev.stopPropagation();
      toggleAdrCard(tog.closest('.adr-card'));
      return;
    }

    // intercept ALL source md links — never open raw .md (charset mojibake)
    var openMd = t.closest('a.open-md');
    if (openMd) {
      ev.preventDefault();
      ev.stopPropagation();
      var card = openMd.closest('[data-node-id]');
      var nid = card ? card.getAttribute('data-node-id') : '';
      var href = openMd.getAttribute('href') || '';
      if (nid && byId[nid]) openNode(nid, href);
      else if (href) openNode('', href);
      return;
    }
    var plainA = t.closest('a[href]');
    if (plainA && !plainA.classList.contains('node-link') && !plainA.classList.contains('hit')) return;
    var link = t.closest('.node-link');
    if (!link) return;
    // ignore if it's the adr-toggle (already handled)
    if (link.classList.contains('adr-toggle')) return;
    ev.preventDefault();
    ev.stopPropagation();
    // optional: scroll to target ADR card if chip points to an ADR
    var id = link.getAttribute('data-node-id') || '';
    var targetCard = id ? document.getElementById('adr-card-' + id) : null;
    if (targetCard) {
      if (!targetCard.classList.contains('open')) toggleAdrCard(targetCard);
      targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    openNode(id, link.getAttribute('data-href') || '');
  }, true);

  document.addEventListener('keydown', function(ev) {
    if (ev.key === 'Escape') closeDrawer();
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target && ev.target.classList) {
      if (ev.target.classList.contains('adr-toggle')) {
        ev.preventDefault();
        toggleAdrCard(ev.target.closest('.adr-card'));
        return;
      }
      if (ev.target.classList.contains('node-link')) {
        ev.preventDefault();
        openNode(ev.target.getAttribute('data-node-id'), ev.target.getAttribute('data-href') || '');
      }
    }
  });

  // Tabs
  var tabs = document.getElementById('tabs');
  if (tabs) {
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
      if (name === 'graph') setTimeout(drawMapLinks, 30);
    });
  }

  // ── Mind-map relation curves (XMind-style bezier) ──
  var mapLinks = [];
  try {
    var ml = document.getElementById('map-links');
    mapLinks = ml ? JSON.parse(ml.textContent || '[]') : [];
  } catch (e) { mapLinks = []; }

  function mapAnchor(el, wrapRect, prefer) {
    var r = el.getBoundingClientRect();
    var x, y;
    if (prefer === 'right') { x = r.right; y = (r.top + r.bottom) / 2; }
    else if (prefer === 'left') { x = r.left; y = (r.top + r.bottom) / 2; }
    else if (prefer === 'bottom') { x = (r.left + r.right) / 2; y = r.bottom; }
    else if (prefer === 'top') { x = (r.left + r.right) / 2; y = r.top; }
    else { x = (r.left + r.right) / 2; y = (r.top + r.bottom) / 2; }
    return { x: x - wrapRect.left + (document.getElementById('xmap-wrap').scrollLeft || 0),
             y: y - wrapRect.top + (document.getElementById('xmap-wrap').scrollTop || 0) };
  }

  function findMapEl(id) {
    var wrap = document.getElementById('xmap-wrap');
    if (!wrap) return null;
    var nodes = wrap.querySelectorAll('[data-node-id]');
    var any = null;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-node-id') !== id) continue;
      if (nodes[i].classList.contains('xtopic') || id.indexOf('__') === 0) return nodes[i];
      any = nodes[i];
    }
    return any;
  }

  function bezierPath(a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    // horizontal-ish cubic (XMind style)
    var c = Math.min(80, Math.max(28, Math.abs(dx) * 0.45 + 16));
    if (Math.abs(dx) >= Math.abs(dy) * 0.6) {
      var s = dx >= 0 ? 1 : -1;
      return 'M ' + a.x + ' ' + a.y + ' C ' + (a.x + s * c) + ' ' + a.y + ', ' + (b.x - s * c) + ' ' + b.y + ', ' + b.x + ' ' + b.y;
    }
    // vertical-ish
    var v = dy >= 0 ? 1 : -1;
    var cv = Math.min(60, Math.max(24, Math.abs(dy) * 0.4 + 12));
    return 'M ' + a.x + ' ' + a.y + ' C ' + a.x + ' ' + (a.y + v * cv) + ', ' + b.x + ' ' + (b.y - v * cv) + ', ' + b.x + ' ' + b.y;
  }

  function sideFor(fromEl, toEl) {
    var fr = fromEl.getBoundingClientRect();
    var tr = toEl.getBoundingClientRect();
    var fcx = (fr.left + fr.right) / 2;
    var tcx = (tr.left + tr.right) / 2;
    var fcy = (fr.top + fr.bottom) / 2;
    var tcy = (tr.top + tr.bottom) / 2;
    if (Math.abs(tcx - fcx) >= Math.abs(tcy - fcy)) {
      return tcx >= fcx ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' };
    }
    return tcy >= fcy ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' };
  }

  function drawMapLinks() {
    var wrap = document.getElementById('xmap-wrap');
    var svg = document.getElementById('xmap-svg');
    var map = document.getElementById('xmap');
    if (!wrap || !svg || !map) return;
    // size svg to content
    var w = Math.max(map.scrollWidth, wrap.clientWidth);
    var h = Math.max(map.scrollHeight, wrap.clientHeight);
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.style.width = w + 'px';
    svg.style.height = h + 'px';

    var wrapRect = wrap.getBoundingClientRect();
    // account scroll of wrap
    var scrollLeft = wrap.scrollLeft || 0;
    var scrollTop = wrap.scrollTop || 0;

    function pt(el, prefer) {
      var r = el.getBoundingClientRect();
      var x, y;
      if (prefer === 'right') { x = r.right; y = (r.top + r.bottom) / 2; }
      else if (prefer === 'left') { x = r.left; y = (r.top + r.bottom) / 2; }
      else if (prefer === 'bottom') { x = (r.left + r.right) / 2; y = r.bottom; }
      else if (prefer === 'top') { x = (r.left + r.right) / 2; y = r.top; }
      else { x = (r.left + r.right) / 2; y = (r.top + r.bottom) / 2; }
      return { x: x - wrapRect.left + scrollLeft, y: y - wrapRect.top + scrollTop };
    }

    var parts = [];
    // marker
    parts.push('<defs><marker id="m-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#5a6275"/></marker></defs>');

    mapLinks.forEach(function(link, idx) {
      var aEl = findMapEl(link.from);
      var bEl = findMapEl(link.to);
      if (!aEl || !bEl) return;
      var sides = sideFor(aEl, bEl);
      var a = pt(aEl, sides.from);
      var b = pt(bEl, sides.to);
      var cls = 'link';
      if (link.kind === 'hub') cls += ' hub tree';
      else if (link.layer === 'tree') cls += ' tree ' + (link.kind || '');
      else cls += ' cross ' + (link.kind || '');
      var d = bezierPath(a, b);
      var midX = (a.x + b.x) / 2;
      var midY = (a.y + b.y) / 2;
      var showLabel = link.layer === 'cross' || link.kind === 'produces' || link.kind === 'requires' || link.kind === 'tombstones' || link.kind === 'motivates';
      var label = (link.label || link.kind || '').slice(0, 18);
      parts.push('<path class="' + cls + '" data-i="' + idx + '" data-from="' + link.from.replace(/"/g, '') + '" data-to="' + link.to.replace(/"/g, '') + '" d="' + d + '" marker-end="url(#m-arrow)"/>');
      if (showLabel && link.kind !== 'hub' && label) {
        parts.push('<text class="elabel" data-i="' + idx + '" x="' + midX + '" y="' + (midY - 4) + '" text-anchor="middle">' + label.replace(/</g, '') + '</text>');
      }
    });
    svg.innerHTML = parts.join('');
  }

  function highlightMapNode(id) {
    var svg = document.getElementById('xmap-svg');
    var wrap = document.getElementById('xmap-wrap');
    if (!svg || !wrap) return;
    var paths = svg.querySelectorAll('path.link');
    var labels = svg.querySelectorAll('text.elabel');
    var topics = wrap.querySelectorAll('.xtopic');
    if (!id) {
      paths.forEach(function(p){ p.classList.remove('hot'); p.classList.remove('dim'); });
      labels.forEach(function(t){ t.style.opacity = ''; });
      topics.forEach(function(t){ t.classList.remove('hot'); });
      return;
    }
    paths.forEach(function(p){
      var hit = p.getAttribute('data-from') === id || p.getAttribute('data-to') === id;
      p.classList.toggle('hot', hit);
      p.classList.toggle('dim', !hit);
    });
    labels.forEach(function(t){
      var i = t.getAttribute('data-i');
      var p = svg.querySelector('path.link[data-i="' + i + '"]');
      var hit = p && (p.getAttribute('data-from') === id || p.getAttribute('data-to') === id);
      t.style.opacity = hit ? '1' : '0.15';
    });
    topics.forEach(function(t){
      t.classList.toggle('hot', t.getAttribute('data-node-id') === id);
    });
  }

  var xmap = document.getElementById('xmap-wrap');
  if (xmap) {
    xmap.addEventListener('mouseover', function(ev){
      var t = ev.target && ev.target.closest ? ev.target.closest('.xtopic[data-node-id]') : null;
      if (t) highlightMapNode(t.getAttribute('data-node-id'));
    });
    xmap.addEventListener('mouseleave', function(){ highlightMapNode(null); });
    xmap.addEventListener('scroll', function(){ drawMapLinks(); });
  }
  window.addEventListener('resize', function(){ drawMapLinks(); });
  // initial draw (graph tab may be hidden — redraw on tab open)
  setTimeout(drawMapLinks, 50);
  setTimeout(drawMapLinks, 300);
})();
</script>
</body>
</html>`;
}

/** Browser path relative to docs/ static root; empty if not servable from docs/. */
function docsHref(sourcePath: string, _sourceLine?: number): string {
  if (!sourcePath) return '';
  if (sourcePath.startsWith('docs/')) return sourcePath.slice('docs/'.length);
  // Already under common docs subpaths
  if (/^(adr\/|buglog|INDEX|superpowers\/)/.test(sourcePath)) return sourcePath;
  return '';
}

function browseCard(n: GraphNode): string {
  const href = docsHref(n.sourcePath, n.sourceLine);
  return `<div class="browse-item node-link" tabindex="0" role="link" data-node-id="${escapeHtml(n.id)}"${href ? ` data-href="${escapeHtml(href)}"` : ''}>
    <h4>
      <code class="mono" style="color:var(--ink-tertiary);font-size:11px">${escapeHtml(n.id)}</code>
      ${escapeHtml(n.title)}
      <span class="status">${escapeHtml(n.status)}</span>
      ${href ? '<span class="open-hint">md ↗</span>' : ''}
    </h4>
    <div class="body">${escapeHtml(n.summary || '')}</div>
    <div class="meta" style="margin-top:6px">${escapeHtml(n.sourcePath)}:${n.sourceLine}
      ${href ? `· <a class="open-md" href="${escapeHtml(href)}" target="_blank" rel="noopener">打开源 md</a>` : ''}</div>
  </div>`;
}

function firstIso(value: string): string | undefined {
  const m = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (!m) return undefined;
  const candidate = m[0];
  const date = new Date(`${candidate}T00:00:00Z`);
  if (!Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === candidate) return candidate;
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
