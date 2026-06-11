import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const TASK_CATEGORIES = [
  'architectural_understanding',
  'bug_investigation',
  'code_comprehension',
  'cross_file_refactoring',
  'feature_implementation',
  'integration_testing',
  'multi_session_development',
  'security_analysis',
];

export interface ImportLoCoBenchAgentTaskOptions {
  dataDir: string;
  scenarioId?: string;
  scenarioFile?: string;
  outputRoot?: string;
  taskId?: string;
  mode?: 'direct' | 'task';
}

export interface ImportedLoCoBenchAgentTask {
  taskId: string;
  taskDir: string;
  scenarioId: string;
  projectId: string;
  projectDir: string;
  expectedFiles: string[];
}

interface LoCoBenchAgentScenario {
  id?: unknown;
  scenario_id?: unknown;
  title?: unknown;
  description?: unknown;
  task_category?: unknown;
  category?: unknown;
  difficulty?: unknown;
  context_files?: unknown;
  working_directory?: unknown;
  conversation_phases?: unknown;
  global_success_criteria?: unknown;
  expected_outcomes?: unknown;
  evaluation_focus?: unknown;
}

interface ProjectMetadata {
  files?: unknown;
  specification?: {
    name?: unknown;
    language?: unknown;
    domain?: unknown;
    complexity?: unknown;
  };
}

export async function importLoCoBenchAgentTask(
  options: ImportLoCoBenchAgentTaskOptions,
): Promise<ImportedLoCoBenchAgentTask> {
  const dataDir = resolve(options.dataDir);
  const scenarioPath = options.scenarioFile
    ? resolve(options.scenarioFile)
    : await resolveScenarioPath(dataDir, options.scenarioId);
  const scenario = await readJson<LoCoBenchAgentScenario>(scenarioPath);
  const scenarioId = readScenarioId(scenario, scenarioPath);
  const projectId = extractProjectId(scenarioId, scenario);
  const projectDir = await resolveProjectDir(dataDir, projectId);
  const metadata = await readJson<ProjectMetadata>(join(projectDir, 'project_metadata.json'));
  const expectedFiles = selectExpectedFiles(scenario, metadata);
  const taskId = normalizeTaskId(options.taskId ?? `locobench-agent-${scenarioId}`);
  const taskDir = resolve(options.outputRoot ?? 'evals/tasks', taskId);

  await mkdir(taskDir, { recursive: true });
  await cp(projectDir, join(taskDir, 'environment'), { recursive: true, force: true });
  await mkdir(join(taskDir, 'tests'), { recursive: true });

  await Promise.all([
    writeFile(join(taskDir, 'task.toml'), renderTaskToml({
      taskId,
      scenario,
      expectedFiles,
      mode: options.mode ?? 'task',
    }), 'utf-8'),
    writeFile(join(taskDir, 'instruction.md'), renderInstruction({
      scenario,
      scenarioId,
      projectId,
      metadata,
    }), 'utf-8'),
    writeFile(join(taskDir, 'tests/test.sh'), renderSmokeVerifier(expectedFiles), 'utf-8'),
  ]);

  return {
    taskId,
    taskDir,
    scenarioId,
    projectId,
    projectDir,
    expectedFiles,
  };
}

async function resolveScenarioPath(dataDir: string, scenarioId?: string): Promise<string> {
  const scenariosDir = join(dataDir, 'output', 'scenarios');
  if (scenarioId) return join(scenariosDir, `${scenarioId}.json`);

  const files = (await readdir(scenariosDir))
    .filter((file) => file.endsWith('.json'))
    .sort();
  if (files.length === 0) {
    throw new Error(`No LoCoBench-Agent scenarios found in ${scenariosDir}`);
  }
  return join(scenariosDir, files[0]);
}

async function resolveProjectDir(dataDir: string, projectId: string): Promise<string> {
  const generatedDir = join(dataDir, 'generated');
  const exact = join(generatedDir, projectId);
  if (await isDirectory(exact)) return exact;

  const entries = await readdir(generatedDir, { withFileTypes: true });
  const match = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .find((name) => name.startsWith(`${projectId}_`));
  if (!match) {
    throw new Error(`LoCoBench-Agent project not found for ${projectId} in ${generatedDir}`);
  }
  return join(generatedDir, match);
}

function readScenarioId(scenario: LoCoBenchAgentScenario, scenarioPath: string): string {
  const id = firstString(scenario.scenario_id, scenario.id);
  return id || basename(scenarioPath, '.json');
}

function extractProjectId(scenarioId: string, scenario: LoCoBenchAgentScenario): string {
  const workingDirectory = firstString(scenario.working_directory);
  if (workingDirectory) return workingDirectory;

  for (const category of TASK_CATEGORIES) {
    const marker = `_${category}_`;
    const index = scenarioId.indexOf(marker);
    if (index > 0) return scenarioId.slice(0, index);
  }

  const parts = scenarioId.split('_');
  if (parts.length >= 4) return parts.slice(0, 4).join('_');
  throw new Error(`Cannot infer LoCoBench-Agent project id from scenario id: ${scenarioId}`);
}

function selectExpectedFiles(
  scenario: LoCoBenchAgentScenario,
  metadata: ProjectMetadata,
): string[] {
  const contextFiles = stringArray(scenario.context_files);
  if (contextFiles.length > 0) return contextFiles.slice(0, 20);

  const files = Array.isArray(metadata.files) ? metadata.files : [];
  return files
    .flatMap((file) => isRecord(file) && typeof file.path === 'string' ? [file.path] : [])
    .slice(0, 20);
}

function renderTaskToml(options: {
  taskId: string;
  scenario: LoCoBenchAgentScenario;
  expectedFiles: string[];
  mode: 'direct' | 'task';
}): string {
  const title = escapeTomlString(firstString(options.scenario.title) ?? options.taskId);
  const tags = [
    'locobench-agent',
    firstString(options.scenario.task_category, options.scenario.category),
    firstString(options.scenario.difficulty),
  ].filter((tag): tag is string => Boolean(tag));
  return [
    `id = "${escapeTomlString(options.taskId)}"`,
    `title = "${title}"`,
    `mode = "${options.mode}"`,
    `tags = [${tags.map((tag) => `"${escapeTomlString(tag)}"`).join(', ')}]`,
    'timeout_seconds = 900',
    `expected_files = [${options.expectedFiles.map((file) => `"${escapeTomlString(file)}"`).join(', ')}]`,
    '',
  ].join('\n');
}

function renderInstruction(options: {
  scenario: LoCoBenchAgentScenario;
  scenarioId: string;
  projectId: string;
  metadata: ProjectMetadata;
}): string {
  const scenario = options.scenario;
  const metadata = options.metadata;
  const phases = Array.isArray(scenario.conversation_phases)
    ? scenario.conversation_phases
    : [];
  const criteria = Array.isArray(scenario.global_success_criteria)
    ? scenario.global_success_criteria
    : [];
  const outcomes = stringArray(scenario.expected_outcomes);
  const focus = stringArray(scenario.evaluation_focus);

  const lines = [
    '# LoCoBench-Agent Scenario',
    '',
    `Scenario ID: ${options.scenarioId}`,
    `Project ID: ${options.projectId}`,
    `Project: ${firstString(metadata.specification?.name) ?? options.projectId}`,
    `Language: ${firstString(metadata.specification?.language) ?? 'unknown'}`,
    `Domain: ${firstString(metadata.specification?.domain) ?? 'unknown'}`,
    `Complexity: ${firstString(metadata.specification?.complexity) ?? 'unknown'}`,
    `Category: ${firstString(scenario.task_category, scenario.category) ?? 'unknown'}`,
    `Difficulty: ${firstString(scenario.difficulty) ?? 'unknown'}`,
    '',
    '## Task',
    '',
    firstString(scenario.title) ?? 'Untitled scenario',
    '',
    firstString(scenario.description) ?? 'Complete the scenario using the repository files.',
    '',
    '## Agent Requirements',
    '',
    '- Work autonomously. Do not ask the user for confirmation.',
    '- Inspect the repository before editing.',
    '- Prefer targeted reads/searches over broad file dumps.',
    '- Modify only files needed for the scenario.',
    '- Validate your work when the project provides an executable check.',
    '- In task mode, emit PHASE_DONE after each phase you complete.',
  ];

  if (phases.length > 0) {
    lines.push('', '## Conversation Phases', '');
    phases.forEach((phase, index) => {
      if (!isRecord(phase)) return;
      lines.push(
        `### Phase ${index + 1}: ${firstString(phase.name) ?? firstString(phase.phase_id) ?? 'phase'}`,
        '',
        firstString(phase.initial_prompt) ?? '',
        '',
        `Expected actions: ${stringArray(phase.expected_actions).join(', ') || 'not specified'}`,
        `Success conditions: ${stringArray(phase.success_conditions).join(', ') || 'not specified'}`,
        '',
      );
    });
  }

  if (criteria.length > 0) {
    lines.push('', '## Success Criteria', '');
    criteria.forEach((criterion) => {
      if (!isRecord(criterion)) return;
      lines.push(`- ${firstString(criterion.description) ?? JSON.stringify(criterion)}`);
    });
  }

  if (outcomes.length > 0) {
    lines.push('', '## Expected Outcomes', '', ...outcomes.map((outcome) => `- ${outcome}`));
  }

  if (focus.length > 0) {
    lines.push('', '## Evaluation Focus', '', ...focus.map((item) => `- ${item}`));
  }

  lines.push(
    '',
    '## Verifier Note',
    '',
    'This imported task uses a smoke verifier because LoCoBench-Agent official scoring is session/metric based rather than a fixed test.sh oracle. Use correctness here as a run-completion signal, and compare behavior/token/tool/schema metrics across variants.',
    '',
  );

  return lines.join('\n');
}

function renderSmokeVerifier(expectedFiles: string[]): string {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'cd "$SANDBOX_DIR"',
    '',
    ...expectedFiles.map((file) => [
      `if [ ! -f "${shellEscapeDoubleQuoted(file)}" ]; then`,
      `  echo "FAIL: expected file missing: ${shellEscapeDoubleQuoted(file)}"`,
      '  exit 1',
      'fi',
    ].join('\n')),
    '',
    'printf "1\\n" > "$REWARD_FILE"',
    'echo "PASS: LoCoBench-Agent smoke verifier passed"',
    '',
  ].join('\n');
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf-8')) as T;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function normalizeTaskId(id: string): string {
  const normalized = id
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 120);
  if (!normalized) throw new Error(`Invalid task id: ${id}`);
  return normalized;
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}

function shellEscapeDoubleQuoted(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"').replace(/\$/gu, '\\$').replace(/`/gu, '\\`');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
