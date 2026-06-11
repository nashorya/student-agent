import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { EvalRunRecord, ToolTraceEntry } from './types.js';

export const LOCOBENCH_AGENT_COMPREHENSION_METRICS = [
  'multi_session_memory_retention',
  'cross_file_consistency',
  'execution_success_rate',
  'dependency_traversal',
  'solution_usability',
] as const;

export const LOCOBENCH_AGENT_EFFICIENCY_METRICS = [
  'runtime_efficiency',
  'memory_efficiency',
  'information_coverage',
  'long_range_dependency_resolution',
] as const;

export const LOCOBENCH_AGENT_FINAL_METRICS = [
  ...LOCOBENCH_AGENT_COMPREHENSION_METRICS,
  ...LOCOBENCH_AGENT_EFFICIENCY_METRICS,
] as const;

export type LoCoBenchAgentMetricName = typeof LOCOBENCH_AGENT_FINAL_METRICS[number];

export interface LoCoBenchAgentToolLogEntry {
  tool_call: {
    function_name: string;
    parameters: Record<string, unknown>;
  };
  is_error: boolean;
}

export interface LoCoBenchAgentSessionResult {
  status: string;
  session_status: string;
  task_description: string;
  conversation_history: Array<{ role: 'user' | 'assistant'; content: string }>;
  tool_usage_log: LoCoBenchAgentToolLogEntry[];
  modified_files: Record<string, string>;
  error_rate: number;
  duration_ms: number;
}

export interface LoCoBenchAgentRecordScore {
  source: 'locobench_agent_bias_free_final_9_adapter';
  scale: 'official_raw_0_to_1';
  variant: string;
  taskId: string;
  trial: number;
  metrics: Record<LoCoBenchAgentMetricName, number>;
  lcba: {
    comprehensionScore: number;
    efficiencyScore: number;
    overallScore: number;
    overallScore5: number;
    confidence: number;
  };
  reference: {
    formula: 'overall = comprehension * 0.6 + efficiency * 0.4';
    officialMetrics: readonly LoCoBenchAgentMetricName[];
    note: string;
  };
}

export interface LoCoBenchAgentSummary {
  variant: string;
  runs: number;
  averageComprehensionScore: number;
  averageEfficiencyScore: number;
  averageOverallScore: number;
  averageOverallScore5: number;
}

export interface LoCoBenchAgentScoreReport {
  records: LoCoBenchAgentRecordScore[];
  summaries: LoCoBenchAgentSummary[];
}

type VariantRecord = EvalRunRecord & { variant?: string };

export function buildLoCoBenchAgentSessionResult(
  record: VariantRecord,
): LoCoBenchAgentSessionResult {
  const totalToolCalls = record.trace.toolCalls.length;
  const failedToolCalls = record.trace.toolCalls.filter((call) => call.isError).length;
  const status = record.score.correctnessScore >= 1 ? 'completed' : 'failed';
  return {
    status,
    session_status: status,
    task_description: record.trace.instruction,
    conversation_history: [
      { role: 'user', content: record.trace.instruction },
      { role: 'assistant', content: record.trace.finalOutput },
    ],
    tool_usage_log: record.trace.toolCalls.map(toolCallToLoCoBenchEntry),
    modified_files: Object.keys(record.modifiedFiles ?? {}).length > 0
      ? record.modifiedFiles
      : Object.fromEntries(record.changedFiles.map((file) => [file, ''])),
    error_rate: totalToolCalls === 0 ? 0 : failedToolCalls / totalToolCalls,
    duration_ms: record.trace.durationMs,
  };
}

export function scoreLoCoBenchAgentRecord(record: VariantRecord): LoCoBenchAgentRecordScore {
  const session = buildLoCoBenchAgentSessionResult(record);
  const metrics: Record<LoCoBenchAgentMetricName, number> = {
    multi_session_memory_retention: calculateMultiSessionMemoryRetention(session),
    cross_file_consistency: calculateCrossFileConsistency(session),
    execution_success_rate: calculateExecutionSuccessRate(session),
    dependency_traversal: calculateDependencyTraversal(session),
    solution_usability: calculateSolutionUsability(session),
    runtime_efficiency: calculateRuntimeEfficiency(session),
    memory_efficiency: calculateMemoryEfficiency(session),
    information_coverage: calculateInformationCoverage(session),
    long_range_dependency_resolution: calculateLongRangeDependencyResolution(session),
  };
  const comprehensionScore = round(mean(LOCOBENCH_AGENT_COMPREHENSION_METRICS.map((name) => metrics[name])));
  const efficiencyScore = round(mean(LOCOBENCH_AGENT_EFFICIENCY_METRICS.map((name) => metrics[name])));
  const overallScore = round(comprehensionScore * 0.6 + efficiencyScore * 0.4);
  return {
    source: 'locobench_agent_bias_free_final_9_adapter',
    scale: 'official_raw_0_to_1',
    variant: record.variant ?? 'unknown',
    taskId: record.taskId,
    trial: record.trial,
    metrics,
    lcba: {
      comprehensionScore,
      efficiencyScore,
      overallScore,
      overallScore5: round(overallScore * 5),
      confidence: 0.875,
    },
    reference: {
      formula: 'overall = comprehension * 0.6 + efficiency * 0.4',
      officialMetrics: LOCOBENCH_AGENT_FINAL_METRICS,
      note: 'Implements the LoCoBench-Agent BiasFreEvaluator final-9 metric names and LCBA aggregation locally from student-agent eval traces.',
    },
  };
}

export function summarizeLoCoBenchAgentScores(
  records: LoCoBenchAgentRecordScore[],
): LoCoBenchAgentSummary[] {
  const variants = [...new Set(records.map((record) => record.variant))].sort();
  return variants.map((variant) => {
    const scoped = records.filter((record) => record.variant === variant);
    return {
      variant,
      runs: scoped.length,
      averageComprehensionScore: round(mean(scoped.map((record) => record.lcba.comprehensionScore))),
      averageEfficiencyScore: round(mean(scoped.map((record) => record.lcba.efficiencyScore))),
      averageOverallScore: round(mean(scoped.map((record) => record.lcba.overallScore))),
      averageOverallScore5: round(mean(scoped.map((record) => record.lcba.overallScore5))),
    };
  });
}

export async function scoreLoCoBenchAgentRecordsFile(options: {
  inputPath: string;
  outputDir?: string;
}): Promise<LoCoBenchAgentScoreReport> {
  const raw = await readFile(options.inputPath, 'utf-8');
  const parsed = JSON.parse(raw) as { records?: VariantRecord[] };
  const sourceRecords = Array.isArray(parsed.records) ? parsed.records : [];
  const records = sourceRecords.map(scoreLoCoBenchAgentRecord);
  const summaries = summarizeLoCoBenchAgentScores(records);
  const report = { records, summaries };
  const outputDir = options.outputDir ?? dirname(options.inputPath);
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, 'locobench-agent-scores.json'),
    JSON.stringify(report, null, 2),
    'utf-8',
  );
  await writeFile(
    join(outputDir, 'locobench-agent-scores.md'),
    renderLoCoBenchAgentMarkdown(report),
    'utf-8',
  );
  return report;
}

export function renderLoCoBenchAgentMarkdown(report: LoCoBenchAgentScoreReport): string {
  const lines = [
    '# LoCoBench-Agent LCBA Scores',
    '',
    'Scale: official raw 0-1, with `overallScore5` provided as a 0-5 display conversion.',
    '',
    '| Variant | Runs | Comprehension | Efficiency | Overall | Overall / 5 |',
    '|---|---:|---:|---:|---:|---:|',
  ];
  for (const summary of report.summaries) {
    lines.push([
      `| ${summary.variant}`,
      String(summary.runs),
      summary.averageComprehensionScore.toFixed(4),
      summary.averageEfficiencyScore.toFixed(4),
      summary.averageOverallScore.toFixed(4),
      summary.averageOverallScore5.toFixed(4),
    ].join(' | ') + ' |');
  }
  lines.push('', '## Per Record', '');
  lines.push('| Variant | Task | Trial | Overall | Comprehension | Efficiency |');
  lines.push('|---|---|---:|---:|---:|---:|');
  for (const record of report.records) {
    lines.push([
      `| ${record.variant}`,
      record.taskId,
      String(record.trial),
      record.lcba.overallScore.toFixed(4),
      record.lcba.comprehensionScore.toFixed(4),
      record.lcba.efficiencyScore.toFixed(4),
    ].join(' | ') + ' |');
  }
  lines.push('');
  return lines.join('\n');
}

function toolCallToLoCoBenchEntry(call: ToolTraceEntry): LoCoBenchAgentToolLogEntry {
  return {
    tool_call: {
      function_name: toLoCoBenchFunctionName(call),
      parameters: extractParameters(call),
    },
    is_error: call.isError === true,
  };
}

function toLoCoBenchFunctionName(call: ToolTraceEntry): string {
  const name = call.name.toLowerCase();
  if (name.includes('read')) return 'read_file';
  if (name.includes('write')) return 'write_file';
  if (name.includes('edit') || name.includes('patch')) return 'edit_file';
  if (name.includes('bash')) {
    const command = extractCommand(call.args).toLowerCase();
    if (/\bgrep\b/u.test(command)) return 'grep';
    if (/\b(?:ls|find)\b/u.test(command)) return 'list_directory';
    if (/\b(?:cat|head|tail)\b/u.test(command)) return 'read_file';
    return 'run_command';
  }
  return name.replace(/^student_/u, '');
}

function extractParameters(call: ToolTraceEntry): Record<string, unknown> {
  const path = extractPath(call);
  if (path) return { path };
  if (isRecord(call.args)) return call.args;
  return {};
}

function calculateExecutionSuccessRate(session: LoCoBenchAgentSessionResult): number {
  const tools = session.tool_usage_log;
  if (tools.length === 0) return 0.5;
  const uniqueTypes = new Set(tools.map((tool) => tool.tool_call.function_name));
  return round(clamp(uniqueTypes.size / (Math.log(tools.length + 1) + 1), 0.2, 1));
}

function calculateMultiSessionMemoryRetention(session: LoCoBenchAgentSessionResult): number {
  const conversation = session.conversation_history;
  if (conversation.length < 3) return 1;
  const referenceWords = ['previously', 'earlier', 'before', 'as mentioned', 'as discussed', 'recall', 'remember', 'we did', 'we discussed'];
  const assistantMessages = conversation.filter((turn) => turn.role === 'assistant');
  const references = assistantMessages.filter((turn) =>
    referenceWords.some((word) => turn.content.toLowerCase().includes(word))).length;
  const referenceConsistency = assistantMessages.length === 0
    ? 0.5
    : Math.min(1, references / Math.max(Math.floor(assistantMessages.length / 3), 1));
  return round(clamp(referenceConsistency * 0.5 + 0.5, 0.3, 1));
}

function calculateCrossFileConsistency(session: LoCoBenchAgentSessionResult): number {
  const files = Object.values(session.modified_files);
  if (files.length < 2) return 1;
  const sizes = files.map((content) => content.split('\n').length);
  const avg = mean(sizes);
  const variance = mean(sizes.map((size) => (size - avg) ** 2));
  const coherence = avg > 0 ? Math.max(0.3, 1 - (Math.sqrt(variance) / avg) / 2) : 0.5;
  return round(clamp(coherence, 0.3, 1));
}

function calculateDependencyTraversal(session: LoCoBenchAgentSessionResult): number {
  const files = Object.values(session.modified_files);
  if (files.length === 0) return 0.7;
  const functions = new Set<string>();
  for (const content of files) {
    for (const match of content.matchAll(/\b(?:function|def)\s+([A-Za-z_$][\w$]*)\s*\(|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gu)) {
      functions.add(match[1] ?? match[2]);
    }
  }
  const scores = files.map((content) => {
    const lines = content.split('\n');
    const importLines = lines.filter((line) => /^\s*(?:import|from|const\s+\w+\s*=\s*require)/u.test(line));
    const importScore = importLines.length === 0 ? 1 : importLines.filter((line) =>
      /^(?:\s*import\s+.+\s+from\s+|\s*import\s+|\s*from\s+[\w.]+\s+import\s+|\s*const\s+\w+\s*=\s*require\()/u.test(line)).length / importLines.length;
    const calls = [...content.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/gu)].map((match) => match[1]);
    const validCalls = calls.filter((call) =>
      functions.has(call) || ['print', 'len', 'str', 'int', 'float', 'list', 'dict', 'set', 'console', 'require'].includes(call)).length;
    const referenceScore = calls.length === 0 ? 1 : validCalls / calls.length;
    const topLines = lines.slice(0, Math.min(10, lines.length));
    const importsInTop = topLines.filter((line) => /^\s*(?:import|from|const\s+\w+\s*=\s*require)/u.test(line)).length;
    const orderScore = importLines.length === 0 ? 1 : importsInTop / importLines.length;
    return importScore * 0.4 + referenceScore * 0.35 + orderScore * 0.25;
  });
  return round(clamp(mean(scores), 0.3, 1));
}

function calculateSolutionUsability(session: LoCoBenchAgentSessionResult): number {
  const files = Object.values(session.modified_files);
  if (files.length === 0) return 0.7;
  const scores = files.map((content) => {
    const lines = content.split('\n');
    const codeLines = lines.filter((line) => line.trim() && !line.trim().startsWith('//') && !line.trim().startsWith('#'));
    const functionCount = (content.match(/\b(?:function|def)\s+\w+\s*\(|=>/gu) ?? []).length;
    const tryBlocks = (content.match(/\btry\b/gu) ?? []).length;
    const catchBlocks = (content.match(/\b(?:catch|except)\b/gu) ?? []).length;
    const maintainability = clamp(0.7 + (tryBlocks > 0 ? Math.min(catchBlocks / tryBlocks, 1) * 0.15 : 0) + (functionCount >= 3 ? 0.15 : functionCount > 0 ? 0.05 : 0), 0, 1);
    const longLines = codeLines.filter((line) => line.length > 100).length;
    const lineLengthScore = codeLines.length === 0 ? 1 : 1 - (longLines / codeLines.length) * 0.5;
    const avgLinesPerFunction = functionCount > 0 ? codeLines.length / functionCount : codeLines.length;
    const functionLengthScore = functionCount === 0 ? 0.7 : avgLinesPerFunction <= 30 ? 1 : Math.max(0.4, 1 - (avgLinesPerFunction - 30) / 100);
    const readability = (lineLengthScore + functionLengthScore) / 2;
    const antiPatterns = (content.match(/\b(?:global\s+|eval\(|exec\()/gu) ?? []).length;
    const practicality = antiPatterns > 0 ? 0.7 * (1 - Math.min(antiPatterns * 0.1, 0.3)) : 0.85;
    return maintainability * 0.4 + readability * 0.35 + practicality * 0.25;
  });
  return round(clamp(mean(scores), 0.3, 1));
}

function calculateRuntimeEfficiency(session: LoCoBenchAgentSessionResult): number {
  const files = Object.values(session.modified_files);
  if (files.length === 0) return 0.65;
  let raw = 1 - session.error_rate * 0.3;
  if (session.duration_ms > 120_000) raw -= 0.1;
  if (session.duration_ms > 300_000) raw -= 0.2;
  return round(rescaleEfficiency(clamp(raw, 0, 1), 'runtime_efficiency'));
}

function calculateMemoryEfficiency(session: LoCoBenchAgentSessionResult): number {
  const files = Object.values(session.modified_files);
  if (files.length === 0) return 0.65;
  const heavyPatterns = files.reduce((sum, content) =>
    sum + count(content, '.readlines()') + count(content, 'list('), 0);
  const efficientPatterns = files.reduce((sum, content) =>
    sum + count(content, 'yield ') + count(content, 'itertools'), 0);
  const raw = heavyPatterns === 0 ? 1 : clamp(0.5 + efficientPatterns / heavyPatterns * 0.5, 0, 1);
  return round(rescaleEfficiency(raw, 'memory_efficiency'));
}

function calculateInformationCoverage(session: LoCoBenchAgentSessionResult): number {
  const modified = new Set(Object.keys(session.modified_files));
  if (modified.size === 0) return 0.65;
  const accessed = new Set(session.tool_usage_log
    .filter(isReadOperation)
    .map(extractFileFromToolLog)
    .filter((path): path is string => Boolean(path) && path !== '.'));
  const relevantAccessed = [...accessed].filter((file) => modified.has(file)).length;
  return round(rescaleEfficiency(relevantAccessed / modified.size, 'information_coverage'));
}

function calculateLongRangeDependencyResolution(session: LoCoBenchAgentSessionResult): number {
  const modified = Object.keys(session.modified_files);
  if (modified.length === 0) return 0.65;
  const firstRead = new Map<string, number>();
  const firstWrite = new Map<string, number>();
  session.tool_usage_log.forEach((entry, index) => {
    const path = extractFileFromToolLog(entry);
    if (!path) return;
    if (isReadOperation(entry) && !firstRead.has(path)) firstRead.set(path, index);
    if (isWriteOperation(entry) && !firstWrite.has(path)) firstWrite.set(path, index);
  });
  const proper = modified.filter((file) => {
    const read = firstRead.get(file);
    const write = firstWrite.get(file);
    return read !== undefined && write !== undefined && read < write;
  }).length;
  return round(rescaleEfficiency(proper / modified.length, 'long_range_dependency_resolution'));
}

function rescaleEfficiency(rawScore: number, metricName: string): number {
  const rawRanges: Record<string, [number, number]> = {
    runtime_efficiency: [0.7, 1],
    memory_efficiency: [0.7, 1],
    information_coverage: [0, 0.3],
    long_range_dependency_resolution: [0, 0.3],
  };
  const [rawMin, rawMax] = rawRanges[metricName] ?? [0, 1];
  const clipped = clamp(rawScore, rawMin, rawMax);
  const normalized = rawMax === rawMin ? 0.5 : (clipped - rawMin) / (rawMax - rawMin);
  return clamp(0.4 + normalized * 0.5, 0.4, 0.9);
}

function isReadOperation(entry: LoCoBenchAgentToolLogEntry): boolean {
  const name = entry.tool_call.function_name.toLowerCase();
  return ['read_file', 'list_directory', 'list_dir', 'glob_file_search', 'grep', 'search'].some((op) => name.includes(op));
}

function isWriteOperation(entry: LoCoBenchAgentToolLogEntry): boolean {
  const name = entry.tool_call.function_name.toLowerCase();
  return ['write_file', 'edit_file', 'create_file', 'apply_patch'].some((op) => name.includes(op));
}

function extractFileFromToolLog(entry: LoCoBenchAgentToolLogEntry): string | undefined {
  const params = entry.tool_call.parameters;
  const raw = params.path ?? params.target_file ?? params.file_path ?? params.file ?? params.pattern;
  return typeof raw === 'string' ? normalizePath(raw) : undefined;
}

function extractPath(call: ToolTraceEntry): string | undefined {
  if (isRecord(call.args)) {
    const raw = call.args.path ?? call.args.file_path ?? call.args.filepath ?? call.args.filename ?? call.args.file;
    if (typeof raw === 'string') return normalizePath(raw);
  }
  const command = extractCommand(call.args);
  const match = command.match(/(?:cat|grep|head|tail|ls|find)\s+(?:-[^\s]+\s+)*([^\s"']+)/u);
  return match ? normalizePath(match[1]) : undefined;
}

function extractCommand(args: unknown): string {
  if (typeof args === 'string') return args;
  if (!isRecord(args)) return '';
  const command = args.command ?? args.cmd ?? args.script ?? args.shell;
  return typeof command === 'string' ? command : '';
}

function normalizePath(path: string): string {
  return path.replace(/^\.\/+/, '').replace(/\\/gu, '/');
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
