import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { importLoCoBenchAgentTask } from './locobench-agent-importer.js';
import {
  summarizeOfficialLoCoBenchAgentScores,
  type OfficialLoCoBenchAgentRecordScore,
  type OfficialLoCoBenchAgentSummary,
} from './locobench-agent-official-scorer.js';
import { renderLoCoBenchAgentMarkdown, type LoCoBenchAgentMetricName } from './locobench-agent-scorer.js';
import {
  describeContextRuntimeRecordDiagnostics,
  runContextRuntimeEval,
  type ContextRuntimeEvalRecord,
  type ContextRuntimeEvalVariant,
} from './context-runtime-runner.js';
import {
  runClaudeCodeEval,
} from './claude-code-runner.js';
import type { EvalRunRecord } from './types.js';

export interface OfficialLoCoBenchAgentHarnessEvalOptions {
  dataDir: string;
  locobenchAgentRoot: string;
  pythonCommand?: string;
  scenarioIds?: string[];
  limit?: number;
  variants?: ContextRuntimeEvalVariant[];
  trials?: number;
  resultsDir?: string;
  keepSandboxes?: boolean;
  keepImportedTasks?: boolean;
  maxBudgetUsd?: number;
  runHarness?: typeof runContextRuntimeEval;
  includeClaudeCode?: boolean;
  claudeCommand?: string;
  claudeModel?: string;
  claudeMaxBudgetUsd?: number;
  claudeBare?: boolean;
  runClaudeCodeHarness?: typeof runClaudeCodeEval;
}

export type OfficialLoCoBenchAgentHarnessVariant = ContextRuntimeEvalVariant | 'claude_code';

type OfficialLoCoBenchAgentSourceRecord = EvalRunRecord & {
  variant: string;
};

export interface OfficialLoCoBenchAgentHarnessRecord {
  variant: OfficialLoCoBenchAgentHarnessVariant | string;
  taskId: string;
  scenarioId: string;
  trial: number;
  harnessRecord: OfficialLoCoBenchAgentSourceRecord;
  officialScore: OfficialLoCoBenchAgentRecordScore;
  officialSessionResult: Record<string, unknown>;
  diagnostics: string[];
}

export interface OfficialLoCoBenchAgentHarnessEvalResult {
  outputDir: string;
  records: OfficialLoCoBenchAgentHarnessRecord[];
  summaries: OfficialLoCoBenchAgentSummary[];
}

interface OfficialRunnerBridgeInput {
  evaluations: OfficialRunnerBridgeEvaluation[];
}

interface OfficialRunnerBridgeEvaluation {
  variant: OfficialLoCoBenchAgentHarnessVariant | string;
  taskId: string;
  scenarioId: string;
  trial: number;
  scenario: Record<string, unknown>;
  projectFiles: Record<string, string>;
  harnessRecord: OfficialLoCoBenchAgentSourceRecord;
}

interface OfficialRunnerBridgeOutput {
  records?: Array<{
    variant: ContextRuntimeEvalVariant;
    taskId: string;
    scenarioId: string;
    trial: number;
    officialScore: OfficialLoCoBenchAgentRecordScore;
    officialSessionResult: Record<string, unknown>;
  }>;
}

export async function runOfficialLoCoBenchAgentHarnessEval(
  options: OfficialLoCoBenchAgentHarnessEvalOptions,
): Promise<OfficialLoCoBenchAgentHarnessEvalResult> {
  const dataDir = resolve(options.dataDir);
  const scenarioIds = await selectScenarioIds(dataDir, options.scenarioIds, options.limit);
  const variants = options.variants ?? ['plain', 'context_runtime'];
  const trials = options.trials ?? 1;
  const runHarness = options.runHarness ?? runContextRuntimeEval;
  const runClaudeHarness = options.runClaudeCodeHarness ?? runClaudeCodeEval;
  const outputDir = await createOutputDir(options.resultsDir);
  const tasksRoot = await mkdtemp(join(tmpdir(), 'student-agent-locobench-official-tasks-'));

  const evaluations: OfficialRunnerBridgeEvaluation[] = [];
  try {
    for (const scenarioId of scenarioIds) {
      const imported = await importLoCoBenchAgentTask({
        dataDir,
        scenarioId,
        outputRoot: tasksRoot,
        taskId: `locobench-agent-${scenarioId}`,
        mode: 'task',
      });
      const scenario = await readScenario(dataDir, scenarioId);
      const projectFiles = await readProjectFiles(imported.projectDir);
      const harnessResult = await runHarness({
        tasksRoot,
        taskIds: [imported.taskId],
        variants,
        trials,
        keepSandboxes: options.keepSandboxes,
        maxBudgetUsd: options.maxBudgetUsd,
        resultsDir: join(outputDir, 'harness-runs'),
      });

      for (const harnessRecord of harnessResult.records) {
        evaluations.push({
          variant: harnessRecord.variant,
          taskId: harnessRecord.taskId,
          scenarioId: imported.scenarioId,
          trial: harnessRecord.trial,
          scenario,
          projectFiles,
          harnessRecord,
        });
      }

      if (options.includeClaudeCode) {
        const claudeResult = await runClaudeHarness({
          tasksRoot,
          taskIds: [imported.taskId],
          trials,
          keepSandboxes: options.keepSandboxes,
          resultsDir: join(outputDir, 'harness-runs', 'claude-code'),
          claudeCommand: options.claudeCommand,
          maxBudgetUsd: options.claudeMaxBudgetUsd ?? options.maxBudgetUsd,
          model: options.claudeModel,
          bare: options.claudeBare,
        });
        for (const harnessRecord of claudeResult.records) {
          evaluations.push({
            variant: harnessRecord.variant,
            taskId: harnessRecord.taskId,
            scenarioId: imported.scenarioId,
            trial: harnessRecord.trial,
            scenario,
            projectFiles,
            harnessRecord,
          });
        }
      }
    }

    const officialRecords = await runOfficialRunnerBridge({
      locobenchAgentRoot: options.locobenchAgentRoot,
      pythonCommand: options.pythonCommand ?? 'python3',
      payload: { evaluations },
    });

    const records: OfficialLoCoBenchAgentHarnessRecord[] = officialRecords.map((record) => {
      const harnessRecord = evaluations.find((item) =>
        item.variant === record.variant
        && item.taskId === record.taskId
        && item.trial === record.trial
        && item.scenarioId === record.scenarioId);
      if (!harnessRecord) {
        throw new Error(`Official runner returned unknown record: ${record.taskId}/${record.variant}/${record.trial}`);
      }
      return {
        variant: record.variant,
        taskId: record.taskId,
        scenarioId: record.scenarioId,
        trial: record.trial,
        harnessRecord: harnessRecord.harnessRecord,
        officialScore: record.officialScore,
        officialSessionResult: record.officialSessionResult,
        diagnostics: describeHarnessRecordDiagnostics(harnessRecord.harnessRecord),
      };
    });
    const summaries = summarizeOfficialLoCoBenchAgentScores(records.map((record) => record.officialScore));

    await writeOfficialHarnessReports({ outputDir, records, summaries });
    return { outputDir, records, summaries };
  } finally {
    if (!options.keepImportedTasks) {
      await rm(tasksRoot, { recursive: true, force: true });
    }
  }
}

function describeHarnessRecordDiagnostics(record: OfficialLoCoBenchAgentSourceRecord): string[] {
  if (record.variant === 'plain' || record.variant === 'context_runtime') {
    return describeContextRuntimeRecordDiagnostics(record as ContextRuntimeEvalRecord);
  }
  const diagnostics: string[] = [];
  if (record.trace.errorMessage) {
    diagnostics.push(`agent error: ${record.trace.errorMessage}`);
  }
  if (record.trace.taskState?.status && record.trace.taskState.status !== 'completed') {
    diagnostics.push(`task state: ${record.trace.taskState.status}`);
  }
  diagnostics.push(...record.score.behaviorFindings);
  return [...new Set(diagnostics)];
}

async function selectScenarioIds(dataDir: string, explicitIds?: string[], limit?: number): Promise<string[]> {
  if (explicitIds && explicitIds.length > 0) return explicitIds;
  const scenariosDir = join(dataDir, 'output', 'scenarios');
  const files = (await readdir(scenariosDir))
    .filter((file) => file.endsWith('.json'))
    .sort();
  const ids = files.map((file) => basename(file, '.json'));
  return limit === undefined ? ids : ids.slice(0, limit);
}

async function readScenario(dataDir: string, scenarioId: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(dataDir, 'output', 'scenarios', `${scenarioId}.json`), 'utf-8')) as Record<string, unknown>;
}

async function readProjectFiles(projectDir: string): Promise<Record<string, string>> {
  const files = await walkFiles(projectDir);
  const entries = await Promise.all(files
    .filter((file) => !file.endsWith('/project_metadata.json') && !file.endsWith('/dependency_graph.json'))
    .map(async (file) => [file, await readFile(join(projectDir, file), 'utf-8')] as const));
  return Object.fromEntries(entries);
}

async function walkFiles(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const next = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) return walkFiles(root, next);
    if (entry.isFile()) return [next];
    return [];
  }));
  return nested.flat().sort();
}

async function createOutputDir(resultsDir?: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  const outputDir = join(resultsDir ?? resolve(process.cwd(), 'evals/results/locobench-agent-official'), stamp);
  await mkdir(outputDir, { recursive: true });
  return outputDir;
}

async function runOfficialRunnerBridge(options: {
  locobenchAgentRoot: string;
  pythonCommand: string;
  payload: OfficialRunnerBridgeInput;
}): Promise<Required<OfficialRunnerBridgeOutput>['records']> {
  const result = await runProcess({
    command: options.pythonCommand,
    args: ['-c', OFFICIAL_RUNNER_BRIDGE_SCRIPT, options.locobenchAgentRoot],
    stdin: JSON.stringify(options.payload),
  });
  if (result.exitCode !== 0) {
    throw new Error([
      'Official LoCoBench-Agent runner bridge failed.',
      `exitCode=${result.exitCode}`,
      result.stderr.trim(),
      result.stdout.trim(),
    ].filter(Boolean).join('\n'));
  }
  const parsed = JSON.parse(result.stdout) as OfficialRunnerBridgeOutput;
  return Array.isArray(parsed.records) ? parsed.records : [];
}

function runProcess(options: {
  command: string;
  args: string[];
  stdin: string;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolveProcess) => {
    const child = spawn(options.command, options.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => resolveProcess({ exitCode: 1, stdout, stderr: err.message }));
    child.on('close', (code) => resolveProcess({ exitCode: code ?? 1, stdout, stderr }));
    child.stdin.end(options.stdin);
  });
}

async function writeOfficialHarnessReports(options: {
  outputDir: string;
  records: OfficialLoCoBenchAgentHarnessRecord[];
  summaries: OfficialLoCoBenchAgentSummary[];
}): Promise<void> {
  await mkdir(options.outputDir, { recursive: true });
  await writeFile(
    join(options.outputDir, 'records.json'),
    JSON.stringify({ records: options.records }, null, 2),
    'utf-8',
  );
  await writeFile(
    join(options.outputDir, 'summary.json'),
    JSON.stringify({ summaries: options.summaries }, null, 2),
    'utf-8',
  );
  await writeFile(
    join(options.outputDir, 'records.jsonl'),
    options.records.map((record) => JSON.stringify(record)).join('\n') + '\n',
    'utf-8',
  );
  await writeFile(
    join(options.outputDir, 'official-locobench-agent.md'),
    renderOfficialHarnessMarkdown(options.summaries, options.records),
    'utf-8',
  );
}

function renderOfficialHarnessMarkdown(
  summaries: OfficialLoCoBenchAgentSummary[],
  records: OfficialLoCoBenchAgentHarnessRecord[],
): string {
  return renderLoCoBenchAgentMarkdown({
    summaries,
    records: records.map((record) => ({
      source: 'locobench_agent_bias_free_final_9_adapter',
      scale: 'official_raw_0_to_1',
      variant: record.variant,
      taskId: record.scenarioId,
      trial: record.trial,
      metrics: Object.fromEntries(Object.entries(record.officialScore.metrics)
        .map(([name, metric]) => [name, metric.score])) as Record<LoCoBenchAgentMetricName, number>,
      lcba: record.officialScore.lcba,
      reference: {
        formula: 'overall = comprehension * 0.6 + efficiency * 0.4',
        officialMetrics: Object.keys(record.officialScore.metrics) as LoCoBenchAgentMetricName[],
        note: 'Runs student-agent harness on official LoCoBench-Agent scenarios, replays behavior through official AgentSession, then evaluates with official BiasFreEvaluator.',
      },
    })),
  }).replace('# LoCoBench-Agent LCBA Scores', '# Official LoCoBench-Agent Harness Eval');
}

const OFFICIAL_RUNNER_BRIDGE_SCRIPT = String.raw`
import asyncio
import json
import os
import sys
import types
from datetime import datetime

locobench_root = sys.argv[1]
locobench_pkg = types.ModuleType("locobench")
locobench_pkg.__path__ = [os.path.join(locobench_root, "locobench")]
sys.modules["locobench"] = locobench_pkg

for name in ["agents", "core", "evaluation", "generation", "tools"]:
    pkg = types.ModuleType(f"locobench.{name}")
    pkg.__path__ = [os.path.join(locobench_root, "locobench", name)]
    sys.modules[f"locobench.{name}"] = pkg

from locobench.agents.base_agent import BaseAgent, AgentMessage, AgentResponse, MessageRole, ToolCall
from locobench.core.agent_session import ConversationPhase
from locobench.core.task import TaskCategory, DifficultyLevel
from locobench.evaluation.agent_evaluator import AgentEvaluator, EvaluationConfig
from locobench.generation.interactive_scenario_generator import (
    InteractiveScenario,
    InteractionMode,
    ToolUsageMode,
    SuccessCriterion,
)

def get_field(obj, name, default=None):
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)

def enum_value(enum_cls, value, default):
    if isinstance(value, str):
        try:
            return enum_cls(value)
        except Exception:
            pass
    return default

def string_list(value):
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str)]
    return []

def make_phase(raw, index):
    raw = raw if isinstance(raw, dict) else {}
    return ConversationPhase(
        phase_id=str(raw.get("phase_id") or raw.get("id") or f"phase_{index + 1}"),
        name=str(raw.get("name") or raw.get("title") or f"Phase {index + 1}"),
        initial_prompt=str(raw.get("initial_prompt") or raw.get("prompt") or raw.get("description") or ""),
        expected_actions=string_list(raw.get("expected_actions")),
        success_conditions=string_list(raw.get("success_conditions")),
        max_turns_in_phase=int(raw.get("max_turns_in_phase") or raw.get("max_turns") or 3),
        dynamic_prompts=raw.get("dynamic_prompts") if isinstance(raw.get("dynamic_prompts"), dict) else {},
        human_intervention_triggers=string_list(raw.get("human_intervention_triggers")),
    )

def make_success_criterion(raw, index):
    raw = raw if isinstance(raw, dict) else {}
    return SuccessCriterion(
        criterion_id=str(raw.get("criterion_id") or raw.get("id") or f"criterion_{index + 1}"),
        description=str(raw.get("description") or raw.get("target_value") or raw),
        type=str(raw.get("type") or "outcome"),
        target_value=raw.get("target_value") or raw.get("description") or "",
        weight=float(raw.get("weight") or 1.0),
        required=bool(raw.get("required", True)),
    )

def make_scenario(item):
    raw = item["scenario"]
    phases_raw = raw.get("conversation_phases") if isinstance(raw.get("conversation_phases"), list) else []
    phases = [make_phase(phase, index) for index, phase in enumerate(phases_raw)]
    if not phases:
        phases = [ConversationPhase(
            phase_id="main",
            name="Main task",
            initial_prompt=str(raw.get("description") or raw.get("title") or "Complete the task."),
            expected_actions=[],
            success_conditions=[],
            max_turns_in_phase=3,
        )]
    criteria_raw = raw.get("global_success_criteria") if isinstance(raw.get("global_success_criteria"), list) else []
    criteria = [make_success_criterion(criterion, index) for index, criterion in enumerate(criteria_raw)]
    context_files = string_list(raw.get("context_files")) or list(item.get("projectFiles", {}).keys())
    available_tools = string_list(raw.get("available_tools")) or ["file_system", "search", "ide_simulator", "compiler"]
    return InteractiveScenario(
        scenario_id=str(raw.get("scenario_id") or raw.get("id") or item["scenarioId"]),
        title=str(raw.get("title") or item["scenarioId"]),
        description=str(raw.get("description") or ""),
        category=enum_value(TaskCategory, raw.get("task_category") or raw.get("category"), TaskCategory.CODE_COMPREHENSION),
        difficulty=enum_value(DifficultyLevel, raw.get("difficulty"), DifficultyLevel.MEDIUM),
        initial_context={
            "project_files": [{"path": path, "content": content} for path, content in item.get("projectFiles", {}).items()],
            "scenario": raw,
        },
        context_files=context_files,
        working_directory=str(raw.get("working_directory") or item["scenarioId"]),
        conversation_phases=phases,
        global_success_criteria=criteria,
        available_tools=available_tools,
        interaction_mode=enum_value(InteractionMode, raw.get("interaction_mode"), InteractionMode.AUTONOMOUS),
        tool_usage_mode=enum_value(ToolUsageMode, raw.get("tool_usage_mode"), ToolUsageMode.UNRESTRICTED),
        max_turns=int(raw.get("max_turns") or 10),
        max_duration_minutes=int(raw.get("max_duration_minutes") or 15),
        context_window_tokens=int(raw.get("context_window_tokens") or 128000),
        expected_outcomes=string_list(raw.get("expected_outcomes")),
        evaluation_focus=string_list(raw.get("evaluation_focus")),
    )

def tool_name_for(function_name):
    fn = function_name.lower()
    if "search" in fn:
        return "search"
    if "compile" in fn or "test" in fn or "run" in fn:
        return "compiler"
    if "symbol" in fn or "definition" in fn:
        return "ide_simulator"
    return "file_system"

def function_name_for(call):
    name = str(call.get("name") or "").lower()
    args = call.get("args") if isinstance(call.get("args"), dict) else {}
    if "write" in name or "edit" in name or "patch" in name:
        return "write_file"
    if "read" in name or "open" in name:
        return "read_file"
    if "search" in name or "rg" in name or "grep" in name:
        return "search_text"
    if "bash" in name or "exec" in name or "shell" in name:
        command = str(args.get("cmd") or args.get("command") or "")
        if any(token in command for token in ["test", "vitest", "tsc", "npm run", "pytest"]):
            return "run_tests"
        if any(token in command for token in ["grep", "rg ", "find ", "ls ", "cat "]):
            return "search_text"
        return "execute_command"
    return name or "agent_action"

def path_from_args(args):
    if not isinstance(args, dict):
        return None
    for key in ["path", "file_path", "filepath", "filename"]:
        value = args.get(key)
        if isinstance(value, str) and value:
            return value
    return None

def build_tool_calls(record):
    calls = []
    seen_write_paths = set()
    for index, raw_call in enumerate(record.get("trace", {}).get("toolCalls", []) or []):
        if not isinstance(raw_call, dict):
            continue
        args = raw_call.get("args") if isinstance(raw_call.get("args"), dict) else {}
        fn = function_name_for(raw_call)
        params = dict(args)
        path = path_from_args(args)
        if path:
            params.setdefault("path", path)
        if fn == "write_file" and path:
            seen_write_paths.add(path)
            content = record.get("modifiedFiles", {}).get(path)
            if isinstance(content, str):
                params["content"] = content
        calls.append(ToolCall(
            call_id=str(raw_call.get("id") or f"trace_{index + 1}"),
            tool_name=tool_name_for(fn),
            function_name=fn,
            parameters=params,
            timestamp=datetime.now(),
        ))
    for index, (path, content) in enumerate((record.get("modifiedFiles") or {}).items()):
        if path in seen_write_paths:
            continue
        calls.append(ToolCall(
            call_id=f"modified_{index + 1}",
            tool_name="file_system",
            function_name="write_file",
            parameters={"path": path, "content": content},
            timestamp=datetime.now(),
        ))
    return calls

def metric_to_json(metric):
    return {
        "score": float(get_field(metric, "score", 0.0) or 0.0),
        "confidence": float(get_field(metric, "confidence", 0.0) or 0.0),
        "details": get_field(metric, "details", {}) or {},
        "biasIndicators": get_field(metric, "bias_indicators", {}) or {},
    }

class ReplayStudentAgent(BaseAgent):
    def __init__(self, item):
        super().__init__(name=f"student_agent_{item['variant']}", config={})
        self.item = item
        self.record = item["harnessRecord"]
        self.replayed_turns = 0

    async def initialize_session(self, scenario_context, available_tools=None):
        self.available_tools_count = len(available_tools or [])
        return True

    async def process_turn(self, message, available_tools=None, context=None):
        self.replayed_turns += 1
        tool_calls = build_tool_calls(self.record)
        trace = self.record.get("trace", {})
        token_usage = trace.get("tokenUsage", {})
        total_tokens = int(token_usage.get("totalTokens") or 0)
        total_cost = float((token_usage.get("costUsd") or {}).get("total") or 0.0)
        if self.replayed_turns > 1:
            total_tokens = 0
            total_cost = 0.0
        content = str(trace.get("finalOutput") or "Student-agent harness run completed.")
        message_obj = AgentMessage(
            role=MessageRole.ASSISTANT,
            content=content,
            tool_calls=tool_calls,
            context_tokens=total_tokens,
            metadata={"replayed_student_agent_harness": True, "variant": self.item["variant"]},
        )
        self.add_message_to_history(message_obj)
        self.total_cost += total_cost
        return AgentResponse(
            message=message_obj,
            tool_calls=tool_calls,
            reasoning="Replayed from a real student-agent harness run.",
            confidence=1.0,
            processing_time=float((trace.get("durationMs") or 0) / 1000),
            tokens_used=total_tokens,
            metadata={
                "replayed_student_agent_harness": True,
                "tool_call_count": len(tool_calls),
            },
        )

    async def finalize_session(self):
        return {
            "replayed_turns": self.replayed_turns,
            "total_tokens_used": self.total_tokens_used,
            "total_cost": self.total_cost,
        }

async def main():
    payload = json.loads(sys.stdin.read())
    output = []
    config = EvaluationConfig(
        require_minimum_turns=1,
        require_tool_usage=False,
        validate_session_completion=False,
        enable_semantic_search=False,
        enable_enhanced_summarization=False,
        initial_context_mode="minimal",
        use_bias_free_evaluator=True,
        enable_human_validation=False,
    )
    for item in payload.get("evaluations", []):
        evaluator = AgentEvaluator(config)
        scenario = make_scenario(item)
        agent = ReplayStudentAgent(item)
        result = await evaluator.evaluate_agent(
            agent,
            scenario,
            session_id=f"student_agent_{item['variant']}_{item['scenarioId']}_{item['trial']}",
        )
        result_dict = result.to_dict()
        metrics = result_dict.get("metric_results", []) or []
        metric_map = {}
        for metric in metrics:
            if isinstance(metric, dict) and metric.get("metric_name"):
                metric_map[metric["metric_name"]] = {
                    "score": float(metric.get("score") or 0.0),
                    "confidence": float(metric.get("confidence") or 0.0),
                    "details": metric.get("details") or {},
                    "biasIndicators": metric.get("bias_indicators") or {},
                }
        comprehension = float(result_dict.get("lcba_comprehension") or 0.0)
        efficiency = float(result_dict.get("lcba_efficiency") or 0.0)
        overall = float(result_dict.get("overall_score") or (comprehension * 0.6 + efficiency * 0.4))
        official_score = {
            "source": "locobench_agent_official_bias_free_evaluator",
            "variant": item.get("variant", "unknown"),
            "taskId": item.get("taskId", "unknown"),
            "trial": item.get("trial", 0),
            "metrics": metric_map,
            "lcba": {
                "comprehensionScore": round(comprehension, 6),
                "efficiencyScore": round(efficiency, 6),
                "overallScore": round(overall, 6),
                "overallScore5": round(overall * 5 if overall <= 1.0 else overall, 6),
                "confidence": 1.0,
            },
            "metadata": {
                "officialRunner": "AgentEvaluator",
                "scenarioId": item.get("scenarioId"),
                "sessionId": result_dict.get("session_id"),
            },
        }
        output.append({
            "variant": item.get("variant", "unknown"),
            "taskId": item.get("taskId", "unknown"),
            "scenarioId": item.get("scenarioId", "unknown"),
            "trial": item.get("trial", 0),
            "officialScore": official_score,
            "officialSessionResult": {
                "conversation_history": result_dict.get("conversation_history", []),
                "tool_usage_log": result_dict.get("tool_usage_log", []),
                "modified_files": result_dict.get("modified_files", {}),
                "session_status": result_dict.get("session_status"),
                "completed_phases": result_dict.get("completed_phases"),
                "total_phases": result_dict.get("total_phases"),
                "total_turns": result_dict.get("total_turns"),
                "session_duration": result_dict.get("session_duration"),
                "scenario_context": result_dict.get("scenario_context", {}),
            },
        })
    print(json.dumps({"records": output}))

asyncio.run(main())
`;
