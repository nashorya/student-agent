import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { WriteQueue } from '../../../core/write-queue.js';
import { PreferenceCandidatesManager } from '../../../memory/candidates/manager.js';
import { DesignMemoryManager } from '../../../memory/design/manager.js';
import { PlanRevisionManager } from '../../../memory/plan-revisions/manager.js';
import { PreferencesManager } from '../../../memory/preferences/manager.js';
import { ProjectKbManager } from '../../../memory/project-kb/manager.js';
import { QuestionsManager } from '../../../memory/questions/manager.js';
import { createMemoryHook } from '../memory.js';

describe('createMemoryHook plan revisions', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'memory-hook-test-'));
    resetManagers();
  });

  afterEach(async () => {
    resetManagers();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('injects recent non-contested plan revision evidence as low priority context', async () => {
    const manager = PlanRevisionManager.getInstance(tmpDir);
    await manager.append({
      taskId: 'task_1',
      sessionRef: 'session_1',
      agentPlanSummary: '原计划：先做架构补全',
      userRevisionSummary: '先修 TUI 输入可靠性',
      diffType: 'priority_change',
      reasonInferred: '用户调整了计划优先级。',
      outcome: 'observed',
      trustStatus: 'unverified',
      sourceType: 'automatic-detection',
    });

    const prompt = await createMemoryHook(tmpDir)();

    expect(prompt).toContain('Planning Preference Evidence');
    expect(prompt).toContain('参考而非硬规则');
    expect(prompt).toContain('先修 TUI 输入可靠性');
  });

  it('injects built-in design study skill guidance even without active profile', async () => {
    const prompt = await createMemoryHook(tmpDir)();

    expect(prompt).toContain('Built-in Design Study Skill');
    expect(prompt).toContain('/design study <url>');
    expect(prompt).toContain('/design confirm <candidate-id>');
    expect(prompt).toContain('/design critique');
  });

  it('injects file modification rules to reduce exact edit failures', async () => {
    const prompt = await createMemoryHook(tmpDir)();

    expect(prompt).toContain('文件修改规则');
    expect(prompt).toContain('oldText must match exactly');
    expect(prompt).toContain('优先用 apply_patch/patch 风格修改');
  });
});

function resetManagers(): void {
  PreferenceCandidatesManager.resetInstance();
  DesignMemoryManager.resetInstance();
  PlanRevisionManager.resetInstance();
  PreferencesManager.resetInstance();
  ProjectKbManager.resetInstance();
  QuestionsManager.resetInstance();
  WriteQueue.resetInstance();
}
