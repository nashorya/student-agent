const REPORT_URL = '../results/latest/eval-report.json';

const state = {
  report: null,
};

const el = {
  generatedAt: document.querySelector('#generatedAt'),
  reloadButton: document.querySelector('#reloadButton'),
  emptyState: document.querySelector('#emptyState'),
  summaryGrid: document.querySelector('#summaryGrid'),
  resultsView: document.querySelector('#resultsView'),
  catalogView: document.querySelector('#catalogView'),
};

el.reloadButton.addEventListener('click', () => {
  loadReport();
});

loadReport();

async function loadReport() {
  try {
    const response = await fetch(`${REPORT_URL}?t=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.report = await response.json();
    el.emptyState.classList.add('hidden');
    renderReport(state.report);
  } catch (error) {
    state.report = null;
    renderMissingReport(error);
  }
}

function renderReport(report) {
  el.generatedAt.textContent = `生成时间 ${formatDate(report.generatedAt)}`;
  renderSummary(report);
  renderResults(report);
  renderCatalog(report);
}

function renderMissingReport(error) {
  el.generatedAt.textContent = '报告未加载';
  el.summaryGrid.replaceChildren();
  el.resultsView.replaceChildren();
  el.catalogView.replaceChildren();
  el.emptyState.classList.remove('hidden');
  el.emptyState.innerHTML = `
    <h2>没有找到 eval 报告</h2>
    <p class="muted">先生成最新 JSON 报告，再从仓库根目录启动一个本地静态服务器。</p>
    <code>npx tsx scripts/eval-webui-report.ts
python3 -m http.server 4173
http://localhost:4173/evals/webui/</code>
    <p class="muted">加载错误：${escapeHtml(error?.message ?? '未知错误')}</p>
  `;
}

function renderSummary(report) {
  const cards = [
    ['Baseline 任务', report.summary.baselineTaskCount],
    ['草稿规格', report.summary.draftSpecCount],
    ['上下文运行时 eval', report.summary.contextRuntimeEvalCount],
    ['Trace Grader', report.summary.hasTraceGrader ? '可用' : '缺失'],
    ['Baseline 结果', statusLabel(report.summary.latestBaselineStatus)],
    ['Ablation 结果', statusLabel(report.summary.latestAblationStatus)],
    ['Context Runtime 结果', statusLabel(report.summary.latestContextRuntimeStatus)],
  ];

  el.summaryGrid.replaceChildren(...cards.map(([label, value]) => {
    const card = document.createElement('article');
    card.className = 'summary-card';
    card.innerHTML = `
      <p class="muted">${escapeHtml(label)}</p>
      <div class="value">${escapeHtml(String(value))}</div>
    `;
    return card;
  }));
}

function renderResults(report) {
  const nodes = [];
  nodes.push(renderBaselineResult(report.results.latestBaseline));
  nodes.push(renderContextRuntimeResult(report.results.latestContextRuntime));
  nodes.push(renderAblationResult(report.results.latestAblation));
  nodes.push(renderRuntimeStatus('上下文运行时', report.results.contextRuntime));
  nodes.push(renderRuntimeStatus('Trace Grader', report.results.traceGrader));
  el.resultsView.replaceChildren(...nodes);
}

function renderBaselineResult(result) {
  const card = document.createElement('article');
  card.className = 'result-card';
  if (!result) {
    card.innerHTML = `
      <h3>Baseline</h3>
      <p>没有在 evals/results 中找到 baseline 结果 JSON。</p>
    `;
    return card;
  }

  const rows = result.records.map((record) => `
    <div class="result-row">
      <div>
        <h3>${escapeHtml(record.taskId)}</h3>
        <p>${escapeHtml(record.mode)} · 正确性 ${formatNumber(record.correctnessScore)} · 行为分 ${formatNumber(record.behaviorScore)}</p>
      </div>
      <span class="pill ${record.outcome === 'passed' ? 'ok' : 'fail'}">${escapeHtml(statusLabel(record.outcome))}</span>
    </div>
  `).join('');

  card.innerHTML = `
    <div class="section-heading">
      <div>
        <p class="eyebrow">Baseline</p>
        <h2>${escapeHtml(result.path)}</h2>
      </div>
      <span class="pill ${result.failedCount > 0 ? 'fail' : 'ok'}">${result.passedCount}/${result.recordCount} 通过</span>
    </div>
    <div class="metric-grid">
      ${metricBox('平均正确性', result.averageCorrectness)}
      ${metricBox('平均行为分', result.averageBehavior)}
      ${metricBox('失败任务数', result.failedCount)}
      ${metricBox('记录数', result.recordCount)}
    </div>
    <div class="table">${rows}</div>
  `;
  return card;
}

function renderContextRuntimeResult(result) {
  const card = document.createElement('article');
  card.className = 'result-card';
  if (!result) {
    card.innerHTML = `
      <h3>Context Runtime</h3>
      <p>没有在 evals/results/context-runtime 中找到结果目录。</p>
    `;
    return card;
  }

  const rows = result.summaries.map((item) => `
    <div class="result-row">
      <div>
        <h3>${escapeHtml(item.variant)}</h3>
        <p>通过率 ${formatPercent(item.passRate)} · 行为分 ${formatNumber(item.averageBehavior)} · token ${formatNumber(item.totalTokens)}</p>
      </div>
      <div class="meta-line">
        <span class="pill info">$${formatMoney(item.totalCostUsd)}</span>
        <span class="pill">每次 $${formatMoney(item.costPerRunUsd)}</span>
        <span class="pill">${item.costPerPassedTaskUsd === null ? '无通过成本' : `每通过 $${formatMoney(item.costPerPassedTaskUsd)}`}</span>
      </div>
    </div>
  `).join('');

  card.innerHTML = `
    <div class="section-heading">
      <div>
        <p class="eyebrow">Context Runtime</p>
        <h2>${escapeHtml(result.outputDir)}</h2>
      </div>
      <span class="pill info">${result.summaryCount} 个变体</span>
    </div>
    <div class="table">${rows}</div>
  `;
  return card;
}

function renderAblationResult(result) {
  const card = document.createElement('article');
  card.className = 'result-card';
  if (!result) {
    card.innerHTML = `
      <h3>Ablation</h3>
      <p>没有在 evals/results/ablation 中找到 ablation 结果目录。</p>
    `;
    return card;
  }

  const rows = result.metricsByConfig.map((item) => `
    <div class="result-row">
      <div>
        <h3>${escapeHtml(item.config)}</h3>
        <p>${item.runs} 次运行</p>
      </div>
      <div class="meta-line">${Object.entries(item.metrics ?? {}).map(([name, value]) =>
        `<span class="pill info">${escapeHtml(name)} ${formatNumber(value)}</span>`
      ).join('')}</div>
    </div>
  `).join('');

  card.innerHTML = `
    <div class="section-heading">
      <div>
        <p class="eyebrow">Ablation</p>
        <h2>${escapeHtml(result.outputDir)}</h2>
      </div>
      <span class="pill info">${escapeHtml(modeLabel(result.mode))}</span>
    </div>
    <div class="table">${rows}</div>
  `;
  return card;
}

function renderRuntimeStatus(title, result) {
  const card = document.createElement('article');
  card.className = 'result-card';
  const ok = result.status === 'standalone_ready' || result.status === 'test_files_detected';
  card.innerHTML = `
    <div class="result-row">
      <div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(result.command)}</p>
      </div>
      <span class="pill ${ok ? 'ok' : 'warn'}">${escapeHtml(statusLabel(result.status))}</span>
    </div>
  `;
  return card;
}

function renderCatalog(report) {
  const sections = [
    ['Baseline 任务', report.catalog.baselineTasks],
    ['草稿规格', report.catalog.draftSpecs],
    ['Ablation 清单', report.catalog.ablationManifest ? [report.catalog.ablationManifest] : []],
    ['上下文运行时 eval', report.catalog.contextRuntimeEvals],
    ['Trace grader', report.catalog.traceGrader ? [report.catalog.traceGrader] : []],
  ];

  el.catalogView.replaceChildren(...sections.map(([title, items]) => {
    const section = document.createElement('section');
    section.className = 'catalog-section';
    section.innerHTML = `
      <div class="catalog-section-title">
        <h3>${escapeHtml(title)}</h3>
        <span>${items.length}</span>
      </div>
      ${items.length === 0 ? '<p class="muted">未检测到。</p>' : items.map(renderCatalogCard).join('')}
    `;
    return section;
  }));
}

function renderCatalogCard(item) {
  const tags = [
    kindLabel(item.kind),
    modeLabel(item.mode),
    item.component,
    item.category,
    item.evalKind,
    statusLabel(item.status),
    ...(item.tags ?? []),
  ].filter(Boolean);

  const metricTags = (item.metrics ?? []).map((metric) => `<span class="pill info">${escapeHtml(metric)}</span>`).join('');
  const countTags = [
    typeof item.configCount === 'number' ? `配置 ${item.configCount}` : null,
    typeof item.metricCount === 'number' ? `指标 ${item.metricCount}` : null,
    typeof item.taskCount === 'number' ? `任务 ${item.taskCount}` : null,
  ].filter(Boolean).map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join('');

  return `
    <article class="catalog-card">
      <div class="metric-row">
        <h3>${escapeHtml(item.title ?? item.id)}</h3>
        <span class="pill">${escapeHtml(item.id)}</span>
      </div>
      <p>${escapeHtml(item.description ?? '')}</p>
      <div class="tag-row">${dedupe(tags).map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join('')}</div>
      ${metricTags || countTags ? `<div class="tag-row">${metricTags}${countTags}</div>` : ''}
      ${item.passCondition ? `<p><strong>通过条件：</strong>${escapeHtml(item.passCondition)}</p>` : ''}
      ${item.command ? `<p class="muted">${escapeHtml(item.command)}</p>` : ''}
      <p class="muted">${escapeHtml(item.path)}</p>
    </article>
  `;
}

function metricBox(label, value) {
  return `
    <div class="metric-box">
      <span class="muted">${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(formatNumber(value)))}</strong>
    </div>
  `;
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function formatNumber(value) {
  return typeof value === 'number' ? Number(value.toFixed(4)).toString() : value;
}

function formatMoney(value) {
  return typeof value === 'number' ? value.toFixed(4) : value;
}

function formatPercent(value) {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : value;
}

function formatDate(value) {
  if (!value) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function statusLabel(status) {
  const labels = {
    pass: '通过',
    fail: '失败',
    unknown: '未知',
    available: '可用',
    missing: '缺失',
    passed: '通过',
    failed: '失败',
    standalone_ready: '可单独运行',
    test_files_detected: '已检测到测试文件',
  };
  return labels[status] ?? status ?? '';
}

function kindLabel(kind) {
  const labels = {
    baseline_task: 'baseline 任务',
    draft_spec: '草稿规格',
    ablation_manifest: 'ablation 清单',
    context_runtime_eval: '上下文运行时 eval',
    trace_grader: 'trace grader',
  };
  return labels[kind] ?? kind ?? '';
}

function modeLabel(mode) {
  const labels = {
    direct: '直接执行',
    task: '任务流',
    dry_run: '空跑',
    unknown: '未知模式',
  };
  return labels[mode] ?? mode ?? '';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#039;');
}
