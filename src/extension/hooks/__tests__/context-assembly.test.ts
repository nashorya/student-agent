import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WriteQueue } from '../../../core/write-queue.js';
import { PreferenceCandidatesManager } from '../../../memory/candidates/manager.js';
import { PlanRevisionManager } from '../../../memory/plan-revisions/manager.js';
import { PreferencesManager } from '../../../memory/preferences/manager.js';
import { ProjectKbManager } from '../../../memory/project-kb/manager.js';
import { QuestionsManager } from '../../../memory/questions/manager.js';
import { TaskLedgerManager } from '../../../memory/tasks/task-ledger-manager.js';
import { TasksManager } from '../../../memory/tasks/manager.js';
import { createContextAssemblyHook } from '../context-assembly.js';

describe('createContextAssemblyHook', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'context-assembly-test-'));
    resetManagers();
  });

  afterEach(async () => {
    resetManagers();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns legacy memory output when useNewPipeline is false', async () => {
    await writeProjectRules(tmpDir, 'Always use rg before broad reads.');

    const prompt = await createContextAssemblyHook({
      memoryDir: tmpDir,
      useNewPipeline: false,
    })();

    expect(prompt).toContain('Student Agent 记忆上下文');
    expect(prompt).toContain('Project Rules');
    expect(prompt).toContain('Always use rg before broad reads.');
    expect(prompt).toContain('文件修改规则');
    expect(prompt).toContain('文件探索规则');
  });

  it('includes hardcoded sections and goal context in new pipeline mode', async () => {
    await writeProjectRules(tmpDir, 'Respect repository conventions.');
    await TasksManager.getInstance(tmpDir).createTask('Context assembly task', ['Build context'], {
      workflowStatus: 'executing',
      workingMemory: {
        goal: 'Assemble L1 prompt from working memory',
        phase: 'executing',
        currentStep: 'Render goal section',
        todos: [{
          id: 'todo_1',
          content: 'Wire RecallRouter and ContextBuilder',
          status: 'pending',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
      },
    });

    const prompt = await createContextAssemblyHook({
      memoryDir: tmpDir,
      useNewPipeline: true,
    })();

    expect(prompt).toContain('Project Rules');
    expect(prompt).toContain('Respect repository conventions.');
    expect(prompt).toContain('文件修改规则');
    expect(prompt).toContain('Context Assembly');
    expect(prompt).toContain('Tier: standard');
    expect(prompt).toContain('### taskSpec');
    expect(prompt).toContain('Goal: Assemble L1 prompt from working memory');
    expect(prompt).toContain('### workingMemory');
  });

  it('includes task ledger facts, rejections, and questions in new pipeline mode', async () => {
    const task = await TasksManager.getInstance(tmpDir).createTask('Ledger context task', ['Build context'], {
      workflowStatus: 'executing',
      workingMemory: {
        goal: 'Assemble prompt with task ledger',
        phase: 'executing',
        currentStep: 'Render ledger section',
      },
    });
    const ledger = new TaskLedgerManager(tmpDir, task.id);
    await ledger.addFact({
      content: 'Use knacks naming',
      source: 'user',
      confidence: 'confirmed',
    });
    await ledger.addRejection({
      assumption: 'Rename knacks back to strategy genes',
      reason: 'User requested knacks naming',
      source: 'explicit',
      severity: 'hard',
    });
    await ledger.addQuestion({
      question: 'Should Turn Intake populate ledger automatically?',
      context: 'Not part of this MVP',
    });

    const prompt = await createContextAssemblyHook({
      memoryDir: tmpDir,
      useNewPipeline: true,
    })();

    expect(prompt).toContain('### taskLedger');
    expect(prompt).toContain('## Task Ledger');
    expect(prompt).toContain('- [confirmed] Use knacks naming (source: user)');
    expect(prompt).toContain('### Rejected Assumptions — DO NOT revisit these assumptions');
    expect(prompt).toContain('- [HARD] Rename knacks back to strategy genes -- reason: User requested knacks naming');
    expect(prompt).toContain('- Should Turn Intake populate ledger automatically? (context: Not part of this MVP)');
  });

  it('falls back to hardcoded sections plus preferences when no active task exists', async () => {
    await PreferencesManager.getInstance(tmpDir).addExplicit({
      rule: 'Prefer concise Chinese answers',
      scope: 'communication',
      taskId: 'task_1',
      sessionRef: 'session_1',
    });

    const prompt = await createContextAssemblyHook({
      memoryDir: tmpDir,
      useNewPipeline: true,
    })();

    expect(prompt).toContain('文件修改规则');
    expect(prompt).toContain('User Preferences');
    expect(prompt).toContain('Prefer concise Chinese answers');
    expect(prompt).not.toContain('Context Assembly');
  });
});

async function writeProjectRules(memoryDir: string, content: string): Promise<void> {
  await mkdir(memoryDir, { recursive: true });
  await writeFile(join(memoryDir, 'project-rules.md'), content, 'utf-8');
}

function resetManagers(): void {
  PreferenceCandidatesManager.resetInstance();
  PlanRevisionManager.resetInstance();
  PreferencesManager.resetInstance();
  ProjectKbManager.resetInstance();
  QuestionsManager.resetInstance();
  TasksManager.resetInstance();
  WriteQueue.resetInstance();
}
