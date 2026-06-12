import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importLoCoBenchAgentTask } from '../locobench-agent-importer.js';
import { loadEvalTask } from '../task-loader.js';

describe('LoCoBench-Agent importer', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'locobench-agent-importer-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('imports a LoCoBench-Agent scenario as a student-agent eval task', async () => {
    const dataDir = join(tmpDir, 'data');
    const outputRoot = join(tmpDir, 'tasks');
    const scenarioId = 'typescript_billing_medium_001_feature_implementation_hard_01';
    const projectId = 'typescript_billing_medium_001';
    const projectDir = join(dataDir, 'generated', projectId);
    await mkdir(join(dataDir, 'output', 'scenarios'), { recursive: true });
    await mkdir(join(projectDir, 'src'), { recursive: true });

    await writeFile(join(dataDir, 'output', 'scenarios', `${scenarioId}.json`), JSON.stringify({
      id: scenarioId,
      title: 'Implement renewal reporting',
      description: 'Update billing code and report generation across files.',
      task_category: 'feature_implementation',
      difficulty: 'hard',
      context_files: ['src/billing.ts', 'src/report.ts'],
      conversation_phases: [
        {
          phase_id: 'explore',
          name: 'Explore',
          initial_prompt: 'Read billing files and understand the data flow.',
          expected_actions: ['read_file', 'search_code'],
          success_conditions: ['understanding'],
        },
      ],
      global_success_criteria: [{
        criterion_id: 'report',
        description: 'Report output is generated from billing data.',
      }],
      expected_outcomes: ['Billing report works'],
      evaluation_focus: ['cross-file consistency'],
    }), 'utf-8');
    await writeFile(join(projectDir, 'project_metadata.json'), JSON.stringify({
      specification: {
        name: 'Billing Project',
        language: 'typescript',
        domain: 'billing',
        complexity: 'medium',
      },
      files: [
        { path: 'src/billing.ts', type: 'source' },
        { path: 'src/report.ts', type: 'source' },
      ],
    }), 'utf-8');
    await writeFile(join(projectDir, 'src', 'billing.ts'), 'export const billing = 1;\n', 'utf-8');
    await writeFile(join(projectDir, 'src', 'report.ts'), 'export const report = 1;\n', 'utf-8');

    const imported = await importLoCoBenchAgentTask({
      dataDir,
      scenarioId,
      outputRoot,
      taskId: 'locobench-agent-smoke',
    });

    expect(imported).toMatchObject({
      taskId: 'locobench-agent-smoke',
      scenarioId,
      projectId,
      expectedFiles: ['src/billing.ts', 'src/report.ts'],
    });
    await expect(readFile(join(imported.taskDir, 'environment', 'src', 'billing.ts'), 'utf-8'))
      .resolves.toContain('billing');

    const task = await loadEvalTask(imported.taskDir);
    expect(task).toMatchObject({
      id: 'locobench-agent-smoke',
      title: 'Implement renewal reporting',
      mode: 'task',
      expectedFiles: ['src/billing.ts', 'src/report.ts'],
    });

    const instruction = await readFile(task.instructionPath, 'utf-8');
    expect(instruction).toContain('LoCoBench-Agent Scenario');
    expect(instruction).toContain('Scenario ID: typescript_billing_medium_001_feature_implementation_hard_01');
    expect(instruction).toContain('## Conversation Phases');
    expect(instruction).toContain('Report output is generated from billing data.');
    expect(instruction).toContain('smoke verifier');

    const testScript = await readFile(task.testScriptPath, 'utf-8');
    expect(testScript).toContain('expected file missing: src/billing.ts');
    expect(testScript).toContain('LoCoBench-Agent smoke verifier passed');
  });
});
