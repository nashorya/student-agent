import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { parseTaskToml } from './task-loader.js';

export interface EvalWebuiReportOptions {
  rootDir?: string;
  outputPath?: string;
  generatedAt?: string;
}

export interface EvalCatalogItem {
  id: string;
  title: string;
  kind: 'baseline_task' | 'draft_spec' | 'ablation_manifest' | 'context_runtime_eval' | 'trace_grader';
  description: string;
  command?: string;
  path: string;
  tags?: string[];
  component?: string;
  category?: string;
  evalKind?: string;
  target?: string;
  mode?: string;
  metrics?: string[];
  passCondition?: string;
  status?: string;
}

export interface EvalWebuiBaselineRecord {
  taskId: string;
  title: string;
  mode: string;
  outcome: 'passed' | 'failed';
  correctnessScore: number;
  behaviorScore: number;
  totalToolCalls: number;
  failedToolCalls: number;
}

export interface EvalWebuiContextRuntimeSummary {
  variant: string;
  runs: number;
  passed: number;
  failed: number;
  passRate: number;
  averageCorrectness: number;
  averageBehavior: number;
  totalToolCalls: number;
  failedToolCalls: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCostUsd: number;
  costPerRunUsd: number;
  costPerPassedTaskUsd: number | null;
}

export interface EvalWebuiReport {
  generatedAt: string;
  summary: {
    baselineTaskCount: number;
    draftSpecCount: number;
    contextRuntimeEvalCount: number;
    hasTraceGrader: boolean;
    latestBaselineStatus: 'pass' | 'fail' | 'unknown';
    latestAblationStatus: 'available' | 'missing';
    latestContextRuntimeStatus: 'available' | 'missing';
  };
  catalog: {
    baselineTasks: EvalCatalogItem[];
    draftSpecs: EvalCatalogItem[];
    ablationManifest: null | (EvalCatalogItem & {
      configCount: number;
      metricCount: number;
      taskCount: number;
    });
    contextRuntimeEvals: EvalCatalogItem[];
    traceGrader: null | EvalCatalogItem;
  };
  results: {
    latestBaseline: null | {
      path: string;
      generatedAt: string | null;
      recordCount: number;
      passedCount: number;
      failedCount: number;
      averageCorrectness: number;
      averageBehavior: number;
      records: EvalWebuiBaselineRecord[];
    };
    latestAblation: null | {
      outputDir: string;
      mode: string;
      configCount: number;
      metricsByConfig: Array<{
        config: string;
        runs: number;
        metrics: Record<string, number>;
      }>;
    };
    latestContextRuntime: null | {
      outputDir: string;
      summaryCount: number;
      summaries: EvalWebuiContextRuntimeSummary[];
    };
    contextRuntime: {
      status: 'test_files_detected' | 'missing';
      evalCount: number;
      command: string;
    };
    traceGrader: {
      status: 'standalone_ready' | 'missing';
      command: string;
    };
  };
}

export async function buildEvalWebuiReport(
  options: EvalWebuiReportOptions = {},
): Promise<EvalWebuiReport> {
  const rootDir = options.rootDir ?? process.cwd();
  const [
    baselineTasks,
    draftSpecs,
    ablationManifest,
    contextRuntimeEvals,
    traceGrader,
    latestBaseline,
    latestAblation,
    latestContextRuntime,
  ] = await Promise.all([
    loadBaselineTasks(rootDir),
    loadDraftSpecs(rootDir),
    loadAblationManifest(rootDir),
    loadContextRuntimeEvals(rootDir),
    loadTraceGrader(rootDir),
    loadLatestBaselineResult(rootDir),
    loadLatestAblationResult(rootDir),
    loadLatestContextRuntimeResult(rootDir),
  ]);

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    summary: {
      baselineTaskCount: baselineTasks.length,
      draftSpecCount: draftSpecs.length,
      contextRuntimeEvalCount: contextRuntimeEvals.length,
      hasTraceGrader: Boolean(traceGrader),
      latestBaselineStatus: latestBaseline
        ? latestBaseline.failedCount > 0 ? 'fail' : 'pass'
        : 'unknown',
      latestAblationStatus: latestAblation ? 'available' : 'missing',
      latestContextRuntimeStatus: latestContextRuntime ? 'available' : 'missing',
    },
    catalog: {
      baselineTasks,
      draftSpecs,
      ablationManifest,
      contextRuntimeEvals,
      traceGrader,
    },
    results: {
      latestBaseline,
      latestAblation,
      latestContextRuntime,
      contextRuntime: {
        status: contextRuntimeEvals.length > 0 ? 'test_files_detected' : 'missing',
        evalCount: contextRuntimeEvals.length,
        command: 'npx vitest run src/evals/context-runtime',
      },
      traceGrader: {
        status: traceGrader ? 'standalone_ready' : 'missing',
        command: 'npx vitest run src/evals/trace-grader/__tests__/trace-grader.test.ts',
      },
    },
  };
}

export async function writeEvalWebuiReport(
  options: EvalWebuiReportOptions = {},
): Promise<string> {
  const rootDir = options.rootDir ?? process.cwd();
  const outputPath = options.outputPath ?? join(rootDir, 'evals', 'results', 'latest', 'eval-report.json');
  const report = await buildEvalWebuiReport(options);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  return outputPath;
}

async function loadBaselineTasks(rootDir: string): Promise<EvalCatalogItem[]> {
  const tasksRoot = join(rootDir, 'evals', 'tasks');
  const entries = await readDirectory(tasksRoot);
  const items = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      const taskDir = join(tasksRoot, entry.name);
      const tomlPath = join(taskDir, 'task.toml');
      const raw = await readOptionalText(tomlPath);
      if (!raw) return null;
      const parsed = parseTaskToml(raw);
      const id = stringValue(parsed.id) ?? entry.name;
      const title = stringValue(parsed.title) ?? id;
      const mode = stringValue(parsed.mode) ?? 'direct';
      const tags = stringArrayValue(parsed.tags);
      return {
        id,
        title,
        kind: 'baseline_task' as const,
        description: `Baseline 评测任务，用于在 ${modeLabel(mode)} 模式下检查 agent 是否能完成指定代码任务。`,
        command: `npm run eval:baseline -- --task ${id}`,
        path: relativePath(rootDir, tomlPath),
        tags,
        mode,
      };
    }));
  return items.filter(isPresent).sort(byId);
}

async function loadDraftSpecs(rootDir: string): Promise<EvalCatalogItem[]> {
  const draftsRoot = join(rootDir, 'evals', 'drafts');
  const specPaths = await findFiles(draftsRoot, 'spec.json');
  const specs = await Promise.all(specPaths.map(async (path) => {
    const parsed = await readOptionalJson<Record<string, unknown>>(path);
    if (!parsed) return null;
    const id = stringValue(parsed.id) ?? path.split('/').at(-2) ?? 'draft';
    const component = stringValue(parsed.component);
    const category = stringValue(parsed.category);
    const evalKind = stringValue(parsed.evalKind);
    const target = stringValue(parsed.target);
    const metrics = stringArrayValue(parsed.metrics);
    return {
      id,
      title: id,
      kind: 'draft_spec' as const,
      description: draftSpecDescription({
        component,
        category,
        evalKind,
        target,
        metrics,
      }),
      path: relativePath(rootDir, path),
      tags: [component, category, evalKind].filter(isPresent),
      component,
      category,
      evalKind,
      target,
      metrics,
      passCondition: stringValue(parsed.passCondition),
    };
  }));
  return specs.filter(isPresent).sort(byId);
}

async function loadAblationManifest(
  rootDir: string,
): Promise<EvalWebuiReport['catalog']['ablationManifest']> {
  const manifestPath = join(rootDir, 'evals', 'ablation', 'benchmark-manifest.json');
  const manifest = await readOptionalJson<{
    id?: string;
    description?: string;
    configs?: unknown[];
    metrics?: Array<{ name?: string }>;
    tasks?: unknown[];
  }>(manifestPath);
  if (!manifest) return null;
  return {
    id: manifest.id ?? 'ablation-manifest',
    title: manifest.id ?? 'Ablation 清单',
    kind: 'ablation_manifest',
    description: '组件消融评测清单，用来比较 baseline、单组件启用、全组件启用时的指标差异。',
    command: 'npx tsx scripts/eval-ablation-runner.ts',
    path: relativePath(rootDir, manifestPath),
    metrics: (manifest.metrics ?? []).flatMap((metric) =>
      typeof metric.name === 'string' ? [metric.name] : [],
    ),
    configCount: manifest.configs?.length ?? 0,
    metricCount: manifest.metrics?.length ?? 0,
    taskCount: manifest.tasks?.length ?? 0,
  };
}

async function loadContextRuntimeEvals(rootDir: string): Promise<EvalCatalogItem[]> {
  const evalRoot = join(rootDir, 'src', 'evals', 'context-runtime');
  const files = await findFiles(evalRoot, '.eval.test.ts');
  return files.map((path) => {
    const file = path.split('/').at(-1) ?? '';
    const id = file.replace(/\.eval\.test\.ts$/u, '');
    return {
      id,
      title: titleize(id),
      kind: 'context_runtime_eval' as const,
      description: contextRuntimeDescription(id),
      command: `npx vitest run ${relativePath(rootDir, path)}`,
      path: relativePath(rootDir, path),
      tags: ['context-runtime'],
    };
  }).sort(byId);
}

async function loadTraceGrader(rootDir: string): Promise<EvalCatalogItem | null> {
  const testPath = join(rootDir, 'src', 'evals', 'trace-grader', '__tests__', 'trace-grader.test.ts');
  if (!await fileExists(testPath)) return null;
  return {
    id: 'trace-grader-v0',
    title: 'Trace Grader v0',
    kind: 'trace_grader',
    description: '确定性 trace 检查器，用来识别工具调用、文件写入、验证命令和虚假成功等风险。',
    command: 'npx vitest run src/evals/trace-grader/__tests__/trace-grader.test.ts',
    path: relativePath(rootDir, testPath),
    tags: ['trace', 'anti-cheating'],
    status: 'standalone_ready',
  };
}

async function loadLatestBaselineResult(
  rootDir: string,
): Promise<EvalWebuiReport['results']['latestBaseline']> {
  const resultsRoot = join(rootDir, 'evals', 'results');
  const files = (await readDirectory(resultsRoot))
    .filter((entry) => entry.isFile() && /^baseline-.+\.json$/u.test(entry.name))
    .map((entry) => join(resultsRoot, entry.name))
    .sort();
  const latest = files.at(-1);
  if (!latest) return null;
  const parsed = await readOptionalJson<{ records?: unknown[] }>(latest);
  const records = (parsed?.records ?? []).map(normalizeBaselineRecord);
  const recordCount = records.length;
  const passedCount = records.filter((record) => record.outcome === 'passed').length;
  return {
    path: relativePath(rootDir, latest),
    generatedAt: timestampFromBaselineFile(latest),
    recordCount,
    passedCount,
    failedCount: recordCount - passedCount,
    averageCorrectness: average(records.map((record) => record.correctnessScore)),
    averageBehavior: average(records.map((record) => record.behaviorScore)),
    records,
  };
}

async function loadLatestAblationResult(
  rootDir: string,
): Promise<EvalWebuiReport['results']['latestAblation']> {
  const ablationRoot = join(rootDir, 'evals', 'results', 'ablation');
  const dirs = (await readDirectory(ablationRoot))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(ablationRoot, entry.name))
    .sort();
  const latest = dirs.at(-1);
  if (!latest) return null;
  const metrics = await readOptionalJson<{
    metricsByConfig?: Array<{ config: string; runs: number; metrics: Record<string, number> }>;
  }>(join(latest, 'metrics-by-config.json'));
  const config = await readOptionalJson<{ mode?: string }>(join(latest, 'config.json'));
  const metricsByConfig = metrics?.metricsByConfig ?? [];
  return {
    outputDir: relativePath(rootDir, latest),
    mode: config?.mode ?? 'unknown',
    configCount: metricsByConfig.length,
    metricsByConfig,
  };
}

async function loadLatestContextRuntimeResult(
  rootDir: string,
): Promise<EvalWebuiReport['results']['latestContextRuntime']> {
  const resultsRoot = join(rootDir, 'evals', 'results', 'context-runtime');
  const dirs = (await readDirectory(resultsRoot))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(resultsRoot, entry.name))
    .sort();
  const latest = dirs.at(-1);
  if (!latest) return null;
  const summary = await readOptionalJson<{
    summaries?: EvalWebuiContextRuntimeSummary[];
  }>(join(latest, 'summary.json'));
  const summaries = summary?.summaries ?? [];
  return {
    outputDir: relativePath(rootDir, latest),
    summaryCount: summaries.length,
    summaries,
  };
}

function normalizeBaselineRecord(raw: unknown): EvalWebuiBaselineRecord {
  const record = isRecord(raw) ? raw : {};
  const score = isRecord(record.score) ? record.score : {};
  const efficiency = isRecord(score.efficiencyMetrics) ? score.efficiencyMetrics : {};
  const correctnessScore = numberValue(score.correctnessScore);
  const behaviorScore = numberValue(score.behaviorScore);
  return {
    taskId: stringValue(record.taskId) ?? 'unknown',
    title: stringValue(record.title) ?? stringValue(record.taskId) ?? 'unknown',
    mode: stringValue(record.mode) ?? 'unknown',
    outcome: correctnessScore >= 1 ? 'passed' : 'failed',
    correctnessScore,
    behaviorScore,
    totalToolCalls: numberValue(efficiency.totalToolCalls),
    failedToolCalls: numberValue(efficiency.failedToolCalls),
  };
}

async function findFiles(root: string, suffix: string): Promise<string[]> {
  const entries = await readDirectory(root);
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return findFiles(path, suffix);
    return entry.isFile() && entry.name.endsWith(suffix) ? [path] : [];
  }));
  return files.flat().sort();
}

async function readDirectory(path: string): Promise<Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return [];
    throw err;
  }
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return null;
    throw err;
  }
}

async function readOptionalJson<T>(path: string): Promise<T | null> {
  const raw = await readOptionalText(path);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function fileExists(path: string): Promise<boolean> {
  return (await readOptionalText(path)) !== null;
}

function timestampFromBaselineFile(path: string): string | null {
  const match = /baseline-(.+)\.json$/u.exec(path);
  return match?.[1] ?? null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function relativePath(rootDir: string, path: string): string {
  return relative(resolve(rootDir), resolve(path)).replace(/\\/gu, '/');
}

function titleize(id: string): string {
  return id.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function draftSpecDescription(input: {
  component?: string;
  category?: string;
  evalKind?: string;
  target?: string;
  metrics: string[];
}): string {
  const component = componentLabel(input.component);
  const category = categoryLabel(input.category);
  const evalKind = evalKindLabel(input.evalKind);
  const target = targetLabel(input.target);
  const metrics = input.metrics.length > 0
    ? `关注指标：${input.metrics.join('、')}。`
    : '暂未声明指标。';
  return `${component}的${category}${evalKind}草稿规格，用来评测${target}行为是否符合预期。${metrics}`;
}

function componentLabel(component?: string): string {
  const labels: Record<string, string> = {
    hashline: 'Hashline',
    toolguard: 'ToolGuard',
    'signal-pipeline': 'Signal Pipeline',
    signal_pipeline: 'Signal Pipeline',
    contextbuilder: 'ContextBuilder',
    component_ablation: '组件消融',
  };
  return component ? labels[component] ?? component : '未指定组件';
}

function categoryLabel(category?: string): string {
  const labels: Record<string, string> = {
    safety: '安全性',
    correctness: '正确性',
    regression: '回归',
    integration: '集成',
  };
  return category ? labels[category] ?? category : '通用';
}

function evalKindLabel(evalKind?: string): string {
  const labels: Record<string, string> = {
    deterministic: '确定性',
  };
  return evalKind ? labels[evalKind] ?? evalKind : '';
}

function targetLabel(target?: string): string {
  const labels: Record<string, string> = {
    component: '组件级',
    harness: '评测框架',
  };
  return target ? labels[target] ?? target : '目标';
}

function modeLabel(mode: string): string {
  const labels: Record<string, string> = {
    direct: '直接执行',
    task: '任务流',
  };
  return labels[mode] ?? mode;
}

function contextRuntimeDescription(id: string): string {
  const descriptions: Record<string, string> = {
    'tier-selection': '检查 L1 三档预算选择，以及 heavy/minimal 触发条件的不变量。',
    'recall-ranking': '检查 RecallRouter 的六维打分、排序，以及被拒绝假设的降权逻辑。',
    'task-ledger-safety': '检查 TaskLedger 是否作为 pinned context 渲染，并保持 rejection 安全规则。',
    'context-rebuild-invariant': '检查 L1 prompt 是否每轮从当前 stores 重新构建，而不是继承上一轮 prompt。',
    'wm-snapshot-run-archive': '检查 WorkingMemorySnapshot 是否写入 Run Archive，并能用于历史召回。',
    'context-inspector': '检查 /context Inspector 是否只读输出结构化诊断信息。',
    'trace-grader-smoke': '检查 Trace Grader 的反作弊 smoke 用例。',
  };
  return descriptions[id] ?? 'Context Runtime 集成评测。';
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
