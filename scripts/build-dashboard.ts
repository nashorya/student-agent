#!/usr/bin/env node
/**
 * build-dashboard.ts
 * 读取 docs/ 和 evals/results/ 的现有数据，生成自包含的 HTML 开发仪表盘。
 * 用法：npx tsx scripts/build-dashboard.ts
 * 输出：docs/dashboard.html
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const EVALS = path.join(ROOT, 'evals', 'results');

// ─────────────────────────────────────────────
// 数据解析
// ─────────────────────────────────────────────

interface TimelineEntry {
  date: string;
  event: string;
  links: string;
}

function parseIndexTimeline(): TimelineEntry[] {
  const src = fs.readFileSync(path.join(DOCS, 'INDEX.md'), 'utf-8');
  const entries: TimelineEntry[] = [];
  const lines = src.split('\n');
  let inTable = false;
  for (const line of lines) {
    if (line.includes('| 日期 |')) { inTable = true; continue; }
    if (inTable && line.startsWith('|---')) continue;
    if (inTable && line.startsWith('|')) {
      const cols = line.split('|').map(s => s.trim()).filter(Boolean);
      if (cols.length >= 2) {
        entries.push({ date: cols[0], event: cols[1], links: cols[2] ?? '' });
      }
    } else if (inTable && line.trim() === '') {
      inTable = false;
    }
  }
  return entries;
}

interface BugEntry {
  id: string;
  title: string;
  date: string;
  status: string;
  symptom: string;
  cause: string;
}

function parseBuglog(): BugEntry[] {
  const src = fs.readFileSync(path.join(DOCS, 'buglog.md'), 'utf-8');
  const bugs: BugEntry[] = [];
  const sections = src.split(/^## (BUG-\d+)/m).slice(1);
  for (let i = 0; i < sections.length; i += 2) {
    const id = sections[i].trim();
    const body = sections[i + 1] ?? '';
    const titleMatch = body.match(/^·\s*(.+)/);
    const title = titleMatch ? titleMatch[1].trim() : id;
    const dateMatch = body.match(/\*\*时间\*\*[：:]\s*([^\n,，]+)/);
    const statusMatch = body.match(/\*\*状态\*\*[：:]\s*([^\n]+)/g);
    const symptomMatch = body.match(/\*\*症状\*\*[：:]\s*([^\n]+)/);
    const causeMatch = body.match(/\*\*根因\*\*[：:]\s*([^\n]+)/);
    // 取最后一个状态（可能有多次更新）
    const lastStatus = statusMatch ? statusMatch[statusMatch.length - 1].replace(/\*\*状态\*\*[：:]\s*/, '').split('（')[0].trim() : 'UNKNOWN';
    bugs.push({
      id,
      title,
      date: dateMatch ? dateMatch[1].trim() : '',
      status: lastStatus,
      symptom: symptomMatch ? symptomMatch[1].trim() : '',
      cause: causeMatch ? causeMatch[1].trim() : '',
    });
  }
  return bugs;
}

interface AdrEntry {
  id: string;
  title: string;
  date: string;
  status: string;
  file: string;
}

function parseAdrs(): AdrEntry[] {
  const adrDir = path.join(DOCS, 'adr');
  if (!fs.existsSync(adrDir)) return [];
  return fs.readdirSync(adrDir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => {
      const src = fs.readFileSync(path.join(adrDir, f), 'utf-8');
      const titleMatch = src.match(/^# (.+)/m);
      const dateMatch = src.match(/\*\*日期\*\*[：:]\s*([^\n]+)/);
      const statusMatch = src.match(/\*\*状态\*\*[：:]\s*([^\n]+)/);
      const idMatch = f.match(/ADR-(\d+)/);
      return {
        id: `ADR-${idMatch ? idMatch[1] : '?'}`,
        title: titleMatch ? titleMatch[1].replace(/ADR-\d+\s*·?\s*/, '').trim() : f,
        date: dateMatch ? dateMatch[1].trim() : '',
        status: statusMatch ? statusMatch[1].trim() : '',
        file: f,
      };
    });
}

interface EvalRun {
  runId: string;
  date: string;
  model: string;
  task: string;
  tier: string;
  reward: number | null;
  inputTokens: number | null;
  totalTokens: number | null;
  turns: number | null;
  costUsd: number | null;
  invalidRun: boolean;
  invalidReasons: string[];
}

function parseEvalRuns(): EvalRun[] {
  const runs: EvalRun[] = [];
  function scanDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const metaPath = path.join(dir, entry.name, 'metadata.json');
        if (fs.existsSync(metaPath)) {
          try {
            const m = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            const result = m.result ?? {};
            // Determine tier from runId or path
            const runId: string = m.runId ?? entry.name;
            let tier = 'other';
            if (runId.includes('tier-a')) tier = 'Tier A';
            else if (runId.includes('tier-b')) tier = 'Tier B';
            else if (runId.includes('cache-probe')) tier = 'Cache Probe';
            else if (runId.includes('comparison') || dir.includes('comparison')) tier = 'Comparison';
            runs.push({
              runId,
              date: (m.createdAt ?? '').slice(0, 10),
              model: m.model ?? m.provider ?? '',
              task: m.task ?? '',
              tier,
              reward: result.reward ?? null,
              inputTokens: result.inputTokens ?? null,
              totalTokens: result.totalTokens ?? null,
              turns: result.turns ?? null,
              costUsd: result.costUsd ?? null,
              invalidRun: result.invalidRun === true,
              invalidReasons: result.invalidReasons ?? [],
            });
          } catch { /* skip malformed */ }
        } else {
          scanDir(path.join(dir, entry.name));
        }
      }
    }
  }
  scanDir(EVALS);
  return runs.sort((a, b) => a.date.localeCompare(b.date));
}

// ─────────────────────────────────────────────
// HTML 生成
// ─────────────────────────────────────────────

function statusBadge(status: string): string {
  const s = status.toUpperCase();
  if (s.startsWith('CLOSED') || s.startsWith('FIXED') && !s.includes('待')) return `<span class="badge green">${status}</span>`;
  if (s.includes('OPEN')) return `<span class="badge red">${status}</span>`;
  if (s.includes('待')) return `<span class="badge yellow">${status}</span>`;
  return `<span class="badge grey">${status}</span>`;
}

function rewardBadge(reward: number | null, invalid: boolean): string {
  if (invalid) return `<span class="badge grey">invalid</span>`;
  if (reward === null) return `<span class="badge grey">—</span>`;
  if (reward >= 1) return `<span class="badge green">✓</span>`;
  if (reward > 0) return `<span class="badge yellow">${reward.toFixed(2)}</span>`;
  return `<span class="badge red">✗</span>`;
}

function fmt(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function fmtCost(n: number | null): string {
  if (n === null) return '—';
  return '$' + n.toFixed(4);
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHtml(
  timeline: TimelineEntry[],
  bugs: BugEntry[],
  adrs: AdrEntry[],
  runs: EvalRun[],
): string {
  const totalCost = runs.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const validRuns = runs.filter(r => !r.invalidRun && r.reward !== null);
  const passRate = validRuns.length
    ? ((validRuns.filter(r => (r.reward ?? 0) >= 1).length / validRuns.length) * 100).toFixed(0) + '%'
    : '—';
  const openBugs = bugs.filter(b => b.status.toUpperCase().includes('OPEN')).length;

  const timelineRows = [...timeline].reverse().map(e => `
    <tr>
      <td class="date">${escHtml(e.date)}</td>
      <td>${escHtml(e.event)}</td>
    </tr>`).join('');

  const bugRows = bugs.map(b => `
    <tr>
      <td><strong>${escHtml(b.id)}</strong></td>
      <td>${escHtml(b.title)}</td>
      <td>${escHtml(b.date)}</td>
      <td>${statusBadge(b.status)}</td>
      <td class="small">${escHtml(b.symptom)}</td>
    </tr>`).join('');

  const adrRows = adrs.map(a => `
    <tr>
      <td><strong>${escHtml(a.id)}</strong></td>
      <td>${escHtml(a.title)}</td>
      <td>${escHtml(a.date)}</td>
      <td>${statusBadge(a.status)}</td>
    </tr>`).join('');

  const runRows = runs.map(r => `
    <tr class="${r.invalidRun ? 'dim' : ''}">
      <td class="date">${escHtml(r.date)}</td>
      <td><span class="tier-badge tier-${r.tier.replace(/\s/g,'').toLowerCase()}">${escHtml(r.tier)}</span></td>
      <td>${escHtml(r.task)}</td>
      <td class="small">${escHtml(r.model.replace('anthropic/', ''))}</td>
      <td>${rewardBadge(r.reward, r.invalidRun)}</td>
      <td class="mono">${fmt(r.inputTokens)}</td>
      <td class="mono">${fmt(r.totalTokens)}</td>
      <td class="mono">${r.turns ?? '—'}</td>
      <td class="mono">${fmtCost(r.costUsd)}</td>
    </tr>`).join('');

  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>student-agent · 开发仪表盘</title>
<style>
  :root {
    --bg: #0d1117; --bg2: #161b22; --bg3: #21262d;
    --border: #30363d; --text: #e6edf3; --muted: #8b949e;
    --green: #3fb950; --red: #f85149; --yellow: #d29922; --blue: #58a6ff;
    --purple: #bc8cff;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 14px; }
  header { background: var(--bg2); border-bottom: 1px solid var(--border); padding: 16px 24px; display: flex; align-items: center; gap: 16px; }
  header h1 { font-size: 18px; font-weight: 600; }
  header .sub { color: var(--muted); font-size: 12px; margin-left: auto; }
  .stats { display: flex; gap: 12px; padding: 16px 24px; flex-wrap: wrap; }
  .stat { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; min-width: 130px; }
  .stat .val { font-size: 24px; font-weight: 700; }
  .stat .lbl { color: var(--muted); font-size: 11px; margin-top: 2px; }
  .tabs { display: flex; gap: 2px; padding: 0 24px; border-bottom: 1px solid var(--border); }
  .tab { padding: 10px 16px; cursor: pointer; border-bottom: 2px solid transparent; color: var(--muted); font-size: 13px; transition: color .15s; }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--blue); border-bottom-color: var(--blue); }
  .panel { display: none; padding: 24px; }
  .panel.active { display: block; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 8px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); border-bottom: 1px solid var(--border); }
  td { padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; line-height: 1.4; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--bg2); }
  tr.dim td { opacity: .45; }
  .date { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .small { font-size: 12px; color: var(--muted); max-width: 360px; }
  .mono { font-family: 'SF Mono', 'Consolas', monospace; font-size: 12px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .badge.green { background: #1f4a23; color: var(--green); }
  .badge.red { background: #3d1a18; color: var(--red); }
  .badge.yellow { background: #3d2e00; color: var(--yellow); }
  .badge.grey { background: var(--bg3); color: var(--muted); }
  .tier-badge { display: inline-block; padding: 1px 7px; border-radius: 4px; font-size: 11px; }
  .tier-tiera { background: #0d2a4a; color: var(--blue); }
  .tier-tierb { background: #1e1060; color: var(--purple); }
  .tier-cacheprobe { background: #1f3a1f; color: var(--green); }
  .tier-comparison { background: var(--bg3); color: var(--muted); }
  .tier-other { background: var(--bg3); color: var(--muted); }
  .scroll-wrap { overflow-x: auto; }
</style>
</head>
<body>
<header>
  <h1>student-agent</h1>
  <span>开发仪表盘</span>
  <span class="sub">生成于 ${now}　·　数据源：docs/ + evals/results/</span>
</header>

<div class="stats">
  <div class="stat"><div class="val">${runs.length}</div><div class="lbl">总 eval run</div></div>
  <div class="stat"><div class="val" style="color:var(--green)">${passRate}</div><div class="lbl">有效 run 通过率</div></div>
  <div class="stat"><div class="val">\$${totalCost.toFixed(2)}</div><div class="lbl">累计花费</div></div>
  <div class="stat"><div class="val" style="color:${openBugs > 0 ? 'var(--red)' : 'var(--green)'}">${openBugs}</div><div class="lbl">OPEN bug</div></div>
  <div class="stat"><div class="val">${adrs.length}</div><div class="lbl">ADR 决策</div></div>
  <div class="stat"><div class="val">${timeline.length}</div><div class="lbl">时间轴条目</div></div>
</div>

<div class="tabs">
  <div class="tab active" onclick="showTab('timeline')">时间轴</div>
  <div class="tab" onclick="showTab('runs')">Eval Runs <span style="color:var(--muted);font-size:11px">(${runs.length})</span></div>
  <div class="tab" onclick="showTab('bugs')">Bug 档案 <span style="color:var(--muted);font-size:11px">(${bugs.length})</span></div>
  <div class="tab" onclick="showTab('adrs')">决策 ADR <span style="color:var(--muted);font-size:11px">(${adrs.length})</span></div>
</div>

<div id="timeline" class="panel active">
  <div class="scroll-wrap">
  <table>
    <thead><tr><th>日期</th><th>事件</th></tr></thead>
    <tbody>${timelineRows}</tbody>
  </table>
  </div>
</div>

<div id="runs" class="panel">
  <div class="scroll-wrap">
  <table>
    <thead><tr><th>日期</th><th>档</th><th>任务</th><th>模型</th><th>结果</th><th>inputTokens</th><th>totalTokens</th><th>turns</th><th>cost</th></tr></thead>
    <tbody>${runRows}</tbody>
  </table>
  </div>
</div>

<div id="bugs" class="panel">
  <div class="scroll-wrap">
  <table>
    <thead><tr><th>ID</th><th>标题</th><th>时间</th><th>状态</th><th>症状</th></tr></thead>
    <tbody>${bugRows}</tbody>
  </table>
  </div>
</div>

<div id="adrs" class="panel">
  <div class="scroll-wrap">
  <table>
    <thead><tr><th>ID</th><th>标题</th><th>日期</th><th>状态</th></tr></thead>
    <tbody>${adrRows}</tbody>
  </table>
  </div>
</div>

<script>
function showTab(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  event.target.classList.add('active');
}
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────

const timeline = parseIndexTimeline();
const bugs = parseBuglog();
const adrs = parseAdrs();
const runs = parseEvalRuns();

const html = buildHtml(timeline, bugs, adrs, runs);
const outPath = path.join(DOCS, 'dashboard.html');
fs.writeFileSync(outPath, html, 'utf-8');

console.log(`✓ 生成完成：${outPath}`);
console.log(`  时间轴条目：${timeline.length}　Bug：${bugs.length}　ADR：${adrs.length}　Eval runs：${runs.length}`);
