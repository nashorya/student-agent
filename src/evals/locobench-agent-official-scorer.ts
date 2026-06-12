import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  buildLoCoBenchAgentSessionResult,
  renderLoCoBenchAgentMarkdown,
  type LoCoBenchAgentMetricName,
  type LoCoBenchAgentSessionResult,
} from './locobench-agent-scorer.js';
import type { EvalRunRecord } from './types.js';

export interface OfficialLoCoBenchAgentMetricResult {
  score: number;
  confidence: number;
  details: Record<string, unknown>;
  biasIndicators: Record<string, unknown>;
}

export interface OfficialLoCoBenchAgentRecordScore {
  source: 'locobench_agent_official_bias_free_evaluator';
  variant: string;
  taskId: string;
  trial: number;
  metrics: Record<string, OfficialLoCoBenchAgentMetricResult>;
  lcba: {
    comprehensionScore: number;
    efficiencyScore: number;
    overallScore: number;
    overallScore5: number;
    confidence: number;
  };
  metadata: Record<string, unknown>;
}

export interface OfficialLoCoBenchAgentSummary {
  variant: string;
  runs: number;
  averageComprehensionScore: number;
  averageEfficiencyScore: number;
  averageOverallScore: number;
  averageOverallScore5: number;
}

export interface OfficialLoCoBenchAgentScoreReport {
  records: OfficialLoCoBenchAgentRecordScore[];
  summaries: OfficialLoCoBenchAgentSummary[];
}

interface OfficialBridgeInput {
  evaluations: OfficialBridgeEvaluation[];
}

interface OfficialBridgeEvaluation {
  variant: string;
  taskId: string;
  trial: number;
  scenario: Record<string, unknown>;
  solutionCode: Record<string, string>;
  sessionResult: LoCoBenchAgentSessionResult;
}

type VariantRecord = EvalRunRecord & { variant?: string };

export async function scoreOfficialLoCoBenchAgentRecordsFile(options: {
  inputPath: string;
  locobenchAgentRoot: string;
  outputDir?: string;
  pythonCommand?: string;
}): Promise<OfficialLoCoBenchAgentScoreReport> {
  const raw = await readFile(options.inputPath, 'utf-8');
  const parsed = JSON.parse(raw) as { records?: VariantRecord[] };
  const sourceRecords = Array.isArray(parsed.records) ? parsed.records : [];
  const payload: OfficialBridgeInput = {
    evaluations: sourceRecords.map(recordToOfficialEvaluation),
  };
  const records = await runOfficialBridge({
    payload,
    locobenchAgentRoot: options.locobenchAgentRoot,
    pythonCommand: options.pythonCommand ?? 'python3',
  });
  const summaries = summarizeOfficialLoCoBenchAgentScores(records);
  const report = { records, summaries };
  const outputDir = options.outputDir ?? dirname(options.inputPath);
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, 'locobench-agent-official-scores.json'),
    JSON.stringify(report, null, 2),
    'utf-8',
  );
  await writeFile(
    join(outputDir, 'locobench-agent-official-scores.md'),
    renderOfficialMarkdown(report),
    'utf-8',
  );
  return report;
}

export function summarizeOfficialLoCoBenchAgentScores(
  records: OfficialLoCoBenchAgentRecordScore[],
): OfficialLoCoBenchAgentSummary[] {
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

function recordToOfficialEvaluation(record: VariantRecord): OfficialBridgeEvaluation {
  const sessionResult = buildLoCoBenchAgentSessionResult(record);
  return {
    variant: record.variant ?? 'unknown',
    taskId: record.taskId,
    trial: record.trial,
    scenario: {
      scenario_id: record.taskId,
      id: record.taskId,
      title: record.title,
      task_category: 'student_agent_import',
      description: record.trace.instruction,
    },
    solutionCode: sessionResult.modified_files,
    sessionResult,
  };
}

async function runOfficialBridge(options: {
  payload: OfficialBridgeInput;
  locobenchAgentRoot: string;
  pythonCommand: string;
}): Promise<OfficialLoCoBenchAgentRecordScore[]> {
  const result = await runProcess({
    command: options.pythonCommand,
    args: ['-c', OFFICIAL_BRIDGE_SCRIPT, options.locobenchAgentRoot],
    stdin: JSON.stringify(options.payload),
  });
  if (result.exitCode !== 0) {
    throw new Error([
      'Official LoCoBench-Agent scorer failed.',
      `exitCode=${result.exitCode}`,
      result.stderr.trim(),
      result.stdout.trim(),
    ].filter(Boolean).join('\n'));
  }
  const parsed = JSON.parse(result.stdout) as { records?: OfficialLoCoBenchAgentRecordScore[] };
  return Array.isArray(parsed.records) ? parsed.records : [];
}

function renderOfficialMarkdown(report: OfficialLoCoBenchAgentScoreReport): string {
  return renderLoCoBenchAgentMarkdown({
    summaries: report.summaries,
    records: report.records.map((record) => ({
      source: 'locobench_agent_bias_free_final_9_adapter',
      scale: 'official_raw_0_to_1',
      variant: record.variant,
      taskId: record.taskId,
      trial: record.trial,
      metrics: Object.fromEntries(Object.entries(record.metrics)
        .map(([name, result]) => [name, result.score])) as Record<LoCoBenchAgentMetricName, number>,
      lcba: record.lcba,
      reference: {
        formula: 'overall = comprehension * 0.6 + efficiency * 0.4',
        officialMetrics: Object.keys(record.metrics) as LoCoBenchAgentMetricName[],
        note: 'Rendered from the official LoCoBench-Agent BiasFreEvaluator Python bridge.',
      },
    })),
  }).replace('# LoCoBench-Agent LCBA Scores', '# Official LoCoBench-Agent LCBA Scores');
}

function runProcess(options: {
  command: string;
  args: string[];
  stdin: string;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(options.command, options.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      resolve({ exitCode: 1, stdout, stderr: err.message });
    });
    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
    child.stdin.end(options.stdin);
  });
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

const OFFICIAL_BRIDGE_SCRIPT = String.raw`
import asyncio
import json
import os
import sys
import types

locobench_root = sys.argv[1]
locobench_pkg = types.ModuleType("locobench")
locobench_pkg.__path__ = [os.path.join(locobench_root, "locobench")]
sys.modules["locobench"] = locobench_pkg

evaluation_pkg = types.ModuleType("locobench.evaluation")
evaluation_pkg.__path__ = [os.path.join(locobench_root, "locobench", "evaluation")]
sys.modules["locobench.evaluation"] = evaluation_pkg

core_pkg = types.ModuleType("locobench.core")
core_pkg.__path__ = [os.path.join(locobench_root, "locobench", "core")]
sys.modules["locobench.core"] = core_pkg

from locobench.evaluation.bias_free_evaluator import BiasFreEvaluator

def get_field(obj, name, default=None):
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)

def metric_to_json(metric):
    return {
        "score": float(get_field(metric, "score", 0.0) or 0.0),
        "confidence": float(get_field(metric, "confidence", 0.0) or 0.0),
        "details": get_field(metric, "details", {}) or {},
        "biasIndicators": get_field(metric, "bias_indicators", {}) or {},
    }

async def main():
    payload = json.loads(sys.stdin.read())
    evaluator = BiasFreEvaluator(enable_human_validation=False)
    output = []
    for item in payload.get("evaluations", []):
        result = await evaluator.evaluate_agent_performance(
            item["scenario"],
            item["solutionCode"],
            item["sessionResult"],
        )
        lcba = get_field(result, "lcba_scores")
        metrics = get_field(result, "metric_results", {}) or {}
        overall = float(get_field(lcba, "overall_score", 0.0) or 0.0)
        output.append({
            "source": "locobench_agent_official_bias_free_evaluator",
            "variant": item.get("variant", "unknown"),
            "taskId": item.get("taskId", "unknown"),
            "trial": item.get("trial", 0),
            "metrics": {name: metric_to_json(metric) for name, metric in metrics.items()},
            "lcba": {
                "comprehensionScore": round(float(get_field(lcba, "comprehension_score", 0.0) or 0.0), 6),
                "efficiencyScore": round(float(get_field(lcba, "efficiency_score", 0.0) or 0.0), 6),
                "overallScore": round(overall, 6),
                "overallScore5": round(overall * 5 if overall <= 1.0 else overall, 6),
                "confidence": round(float(get_field(lcba, "confidence", 0.0) or 0.0), 6),
            },
            "metadata": get_field(result, "evaluation_metadata", {}) or {},
        })
    print(json.dumps({"records": output}))

asyncio.run(main())
`;
