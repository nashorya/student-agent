import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runOfficialLoCoBenchAgentHarnessEval } from '../locobench-agent-official-runner.js';
import type { ContextRuntimeEvalResult } from '../context-runtime-runner.js';
import type { ContextRuntimeEvalRecord } from '../context-runtime-runner.js';

describe('official LoCoBench-Agent harness runner', () => {
  let tmpDir: string;
  let dataDir: string;
  let officialRoot: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'official-locobench-agent-runner-test-'));
    dataDir = join(tmpDir, 'data');
    officialRoot = join(tmpDir, 'fake-official');
    await writeFakeData(dataDir);
    await writeFakeOfficialRunner(officialRoot);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('runs imported official scenarios through the official AgentEvaluator bridge', async () => {
    const outputDir = join(tmpDir, 'results');
    const result = await runOfficialLoCoBenchAgentHarnessEval({
      dataDir,
      locobenchAgentRoot: officialRoot,
      pythonCommand: 'python3',
      scenarioIds: ['scenario-001'],
      variants: ['context_runtime'],
      trials: 1,
      resultsDir: outputDir,
      runHarness: async () => fakeHarnessResult(),
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      variant: 'context_runtime',
      scenarioId: 'scenario-001',
      officialScore: {
        source: 'locobench_agent_official_bias_free_evaluator',
        lcba: {
          comprehensionScore: 0.9,
          efficiencyScore: 0.7,
          overallScore: 0.82,
          overallScore5: 4.1,
        },
      },
    });
    expect(result.records[0].officialSessionResult.modified_files).toEqual({
      'src/a.ts': 'export const value = 2;\n',
    });
    await expect(readFile(join(result.outputDir, 'records.json'), 'utf-8'))
      .resolves.toContain('officialSessionResult');
    await expect(readFile(join(result.outputDir, 'official-locobench-agent.md'), 'utf-8'))
      .resolves.toContain('Official LoCoBench-Agent Harness Eval');
  });

  it('can run Student Agent variants and Claude Code through the same official pipeline', async () => {
    const outputDir = join(tmpDir, 'unified-results');
    const result = await runOfficialLoCoBenchAgentHarnessEval({
      dataDir,
      locobenchAgentRoot: officialRoot,
      pythonCommand: 'python3',
      scenarioIds: ['scenario-001'],
      variants: ['plain', 'context_runtime'],
      includeClaudeCode: true,
      trials: 1,
      resultsDir: outputDir,
      runHarness: async () => fakeHarnessResult([
        fakeRecord('plain', 1),
        fakeRecord('context_runtime', 1),
      ]),
      runClaudeCodeHarness: async () => fakeClaudeCodeHarnessResult(),
    });

    expect(result.records.map((record) => record.variant).sort()).toEqual([
      'claude_code',
      'context_runtime',
      'plain',
    ]);
    expect(result.records.map((record) => record.scenarioId)).toEqual([
      'scenario-001',
      'scenario-001',
      'scenario-001',
    ]);
    await expect(readFile(join(result.outputDir, 'records.json'), 'utf-8'))
      .resolves.toContain('"variant": "claude_code"');
  });
});

async function writeFakeData(root: string): Promise<void> {
  await mkdir(join(root, 'output', 'scenarios'), { recursive: true });
  await mkdir(join(root, 'generated', 'project-a'), { recursive: true });
  await writeFile(join(root, 'output', 'scenarios', 'scenario-001.json'), JSON.stringify({
    scenario_id: 'scenario-001',
    title: 'Fake official scenario',
    description: 'Update src/a.ts.',
    task_category: 'feature_implementation',
    difficulty: 'easy',
    working_directory: 'project-a',
    context_files: ['src/a.ts'],
    conversation_phases: [{
      phase_id: 'phase-1',
      name: 'Implement',
      initial_prompt: 'Update src/a.ts.',
      expected_actions: ['write_file'],
      success_conditions: ['done'],
      max_turns_in_phase: 1,
    }],
    global_success_criteria: [{
      criterion_id: 'criterion-1',
      description: 'src/a.ts is updated.',
      type: 'outcome',
      target_value: 'updated',
    }],
  }), 'utf-8');
  await mkdir(join(root, 'generated', 'project-a', 'src'), { recursive: true });
  await writeFile(join(root, 'generated', 'project-a', 'project_metadata.json'), JSON.stringify({
    specification: { name: 'project-a', language: 'typescript' },
    files: [{ path: 'src/a.ts' }],
  }), 'utf-8');
  await writeFile(join(root, 'generated', 'project-a', 'src', 'a.ts'), 'export const value = 1;\n', 'utf-8');
}

async function writeFakeOfficialRunner(root: string): Promise<void> {
  await mkdir(join(root, 'locobench', 'agents'), { recursive: true });
  await mkdir(join(root, 'locobench', 'core'), { recursive: true });
  await mkdir(join(root, 'locobench', 'evaluation'), { recursive: true });
  await mkdir(join(root, 'locobench', 'generation'), { recursive: true });
  await writeFile(join(root, 'locobench', 'agents', 'base_agent.py'), `
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

class MessageRole(Enum):
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"
    SYSTEM = "system"

@dataclass
class ToolCall:
    call_id: str
    tool_name: str
    function_name: str
    parameters: dict
    timestamp: datetime = field(default_factory=datetime.now)
    def to_dict(self):
        return {
            "call_id": self.call_id,
            "tool_name": self.tool_name,
            "function_name": self.function_name,
            "parameters": self.parameters,
            "timestamp": self.timestamp.isoformat(),
        }

@dataclass
class AgentMessage:
    role: MessageRole
    content: str
    tool_calls: list = None
    tool_responses: list = None
    timestamp: datetime = field(default_factory=datetime.now)
    context_tokens: int = 0
    metadata: dict = field(default_factory=dict)
    def to_dict(self):
        return {
            "role": self.role.value,
            "content": self.content,
            "tool_calls": [call.to_dict() for call in (self.tool_calls or [])],
            "tool_responses": [],
            "timestamp": self.timestamp.isoformat(),
            "context_tokens": self.context_tokens,
            "metadata": self.metadata,
        }

@dataclass
class AgentResponse:
    message: AgentMessage
    tool_calls: list = field(default_factory=list)
    reasoning: str = None
    confidence: float = 1.0
    processing_time: float = 0.0
    tokens_used: int = 0
    metadata: dict = field(default_factory=dict)

class BaseAgent:
    def __init__(self, name, config=None):
        self.name = name
        self.config = config or {}
        self.conversation_history = []
        self.total_tokens_used = 0
        self.total_cost = 0.0
    def add_message_to_history(self, message):
        self.conversation_history.append(message)
        self.total_tokens_used += message.context_tokens
    def get_session_statistics(self):
        return {"agent_name": self.name, "total_tokens_used": self.total_tokens_used}
`, 'utf-8');
  await writeFile(join(root, 'locobench', 'core', 'agent_session.py'), `
from dataclasses import dataclass, field

@dataclass
class ConversationPhase:
    phase_id: str
    name: str
    initial_prompt: str
    expected_actions: list = field(default_factory=list)
    success_conditions: list = field(default_factory=list)
    max_turns_in_phase: int = 10
    dynamic_prompts: dict = field(default_factory=dict)
    human_intervention_triggers: list = field(default_factory=list)
    def to_dict(self):
        return self.__dict__
`, 'utf-8');
  await writeFile(join(root, 'locobench', 'core', 'task.py'), `
from enum import Enum
class TaskCategory(Enum):
    CODE_COMPREHENSION = "code_comprehension"
    FEATURE_IMPLEMENTATION = "feature_implementation"
class DifficultyLevel(Enum):
    EASY = "easy"
    MEDIUM = "medium"
`, 'utf-8');
  await writeFile(join(root, 'locobench', 'generation', 'interactive_scenario_generator.py'), `
from dataclasses import dataclass, field
from enum import Enum
class InteractionMode(Enum):
    AUTONOMOUS = "autonomous"
class ToolUsageMode(Enum):
    UNRESTRICTED = "unrestricted"
@dataclass
class SuccessCriterion:
    criterion_id: str
    description: str
    type: str
    target_value: object
    weight: float = 1.0
    required: bool = True
    def to_dict(self):
        return self.__dict__
@dataclass
class InteractiveScenario:
    scenario_id: str
    title: str
    description: str
    category: object
    difficulty: object
    initial_context: dict
    context_files: list
    working_directory: str
    conversation_phases: list
    global_success_criteria: list
    available_tools: list
    interaction_mode: object = None
    tool_usage_mode: object = None
    max_turns: int = 10
    max_duration_minutes: int = 15
    context_window_tokens: int = 128000
    expected_outcomes: list = field(default_factory=list)
    evaluation_focus: list = field(default_factory=list)
    def to_dict(self):
        return {
            "scenario_id": self.scenario_id,
            "title": self.title,
            "description": self.description,
            "task_category": self.category.value,
            "difficulty": self.difficulty.value,
            "initial_context": self.initial_context,
            "context_files": self.context_files,
            "working_directory": self.working_directory,
            "conversation_phases": [phase.to_dict() for phase in self.conversation_phases],
            "global_success_criteria": [criterion.to_dict() for criterion in self.global_success_criteria],
            "available_tools": self.available_tools,
        }
`, 'utf-8');
  await writeFile(join(root, 'locobench', 'evaluation', 'agent_evaluator.py'), `
from dataclasses import dataclass

@dataclass
class EvaluationConfig:
    require_minimum_turns: int = 1
    require_tool_usage: bool = False
    validate_session_completion: bool = False
    enable_semantic_search: bool = False
    enable_enhanced_summarization: bool = False
    initial_context_mode: str = "minimal"
    use_bias_free_evaluator: bool = True
    enable_human_validation: bool = False

class Result:
    def __init__(self, session_id, response, scenario):
        self.session_id = session_id
        self.response = response
        self.scenario = scenario
    def to_dict(self):
        modified = {}
        tool_log = []
        for call in self.response.tool_calls:
            tool_log.append({"tool_call": call.to_dict()})
            if call.function_name == "write_file":
                modified[call.parameters.get("path")] = call.parameters.get("content")
        return {
            "agent_name": "student_agent_context_runtime",
            "scenario_id": self.scenario.scenario_id,
            "session_id": self.session_id,
            "metric_results": [{
                "metric_name": "execution_success_rate",
                "score": 0.91,
                "confidence": 0.99,
                "details": {"fake_official_runner": True},
                "bias_indicators": {},
            }],
            "lcba_comprehension": 0.9,
            "lcba_efficiency": 0.7,
            "overall_score": 0.82,
            "conversation_history": [self.response.message.to_dict()],
            "tool_usage_log": tool_log,
            "modified_files": modified,
            "error_log": [],
            "session_status": "completed",
            "completed_phases": 1,
            "total_phases": len(self.scenario.conversation_phases),
            "total_turns": 1,
            "session_duration": 0.1,
            "scenario_context": self.scenario.to_dict(),
        }

class AgentEvaluator:
    def __init__(self, config=None):
        self.config = config
    async def evaluate_agent(self, agent, scenario, session_id=None):
        await agent.initialize_session(scenario.to_dict(), [])
        response = await agent.process_turn(scenario.description, [], scenario.to_dict())
        return Result(session_id, response, scenario)
`, 'utf-8');
}

function fakeHarnessResult(records: ContextRuntimeEvalRecord[] = [fakeRecord('context_runtime', 1)]): ContextRuntimeEvalResult {
  return {
    records,
    summaries: [],
    outputDir: '/tmp/fake-harness',
  };
}

function fakeClaudeCodeHarnessResult() {
  return {
    records: [{
      ...fakeRecord('claude_code', 1),
      variant: 'claude_code' as const,
    }],
    summary: {
      variant: 'claude_code' as const,
      runs: 1,
      passed: 1,
      failed: 0,
      passRate: 1,
      averageCorrectness: 1,
      averageBehavior: 1,
      totalToolCalls: 1,
      failedToolCalls: 0,
      totalTokens: 15,
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCostUsd: 0,
      costPerRunUsd: 0,
      costPerPassedTaskUsd: 0,
    },
    outputDir: '/tmp/fake-claude-code',
  };
}

function fakeRecord(
  variant: ContextRuntimeEvalRecord['variant'] | 'claude_code',
  trial: number,
): ContextRuntimeEvalRecord {
  return {
    variant: variant as ContextRuntimeEvalRecord['variant'],
    taskId: 'locobench-agent-scenario-001',
    title: 'Fake official scenario',
    mode: 'task',
    trial,
    trace: {
      taskId: 'locobench-agent-scenario-001',
      mode: 'task',
      instruction: 'Update src/a.ts.',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1000,
      status: 'success',
      finalOutput: 'Done.',
      toolCalls: [{
        id: 'tool-1',
        name: 'apply_patch',
        args: { path: 'src/a.ts' },
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-01-01T00:00:01.000Z',
        durationMs: 1000,
        isError: false,
        resultText: 'ok',
      }],
      tokenUsage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 15,
        costUsd: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
    },
    verifier: {
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 1,
      correctnessScore: 1,
      rewardSource: 'exit_code',
    },
    changedFiles: ['src/a.ts'],
    modifiedFiles: {
      'src/a.ts': 'export const value = 2;\n',
    },
    score: {
      correctnessScore: 1,
      behaviorScore: 1,
      efficiencyMetrics: {
        totalToolCalls: 1,
        failedToolCalls: 0,
        repeatedToolCalls: 0,
        durationMs: 1000,
        toolCounts: { apply_patch: 1 },
      },
      safetyMetrics: {
        dangerousBashCommands: 0,
        pathEscapeAttempts: 0,
        unexpectedChangedFiles: [],
        writeOverwriteCount: 0,
      },
      behaviorFindings: [],
    },
  };
}
