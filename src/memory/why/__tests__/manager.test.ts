import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WriteQueue } from '../../../core/write-queue.js';
import { PlanRevisionManager } from '../../plan-revisions/manager.js';
import { PreferencesManager } from '../../preferences/manager.js';
import { WhyManager } from '../manager.js';

describe('WhyManager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'why-test-'));
    PlanRevisionManager.resetInstance();
    PreferencesManager.resetInstance();
    WriteQueue.resetInstance();
  });

  afterEach(async () => {
    PlanRevisionManager.resetInstance();
    PreferencesManager.resetInstance();
    WriteQueue.resetInstance();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('explains direct preference provenance with trace', async () => {
    await PreferencesManager.getInstance(tmpDir).addExplicit({
      rule: 'Prefer small functions',
      scope: 'code-style',
      taskId: 'task_1',
      sessionRef: 'session_1',
    });

    const entries = await new WhyManager(tmpDir).explain('small', { trace: true });

    expect(entries[0]).toMatchObject({
      source: 'preference',
      summary: 'Prefer small functions',
    });
    expect(entries[0].trace).toContain('task_id=task_1');
  });

  it('explains plan revision evidence with trace', async () => {
    await PlanRevisionManager.getInstance(tmpDir).append({
      taskId: 'task_2',
      sessionRef: 'session_2',
      agentPlanSummary: '原计划：先做架构补全',
      userRevisionSummary: '先修 TUI 输入可靠性',
      diffType: 'priority_change',
      reasonInferred: '用户调整了计划优先级。',
      outcome: 'observed',
      trustStatus: 'unverified',
      sourceType: 'automatic-detection',
    });

    const entries = await new WhyManager(tmpDir).explain('TUI', { trace: true });

    expect(entries[0]).toMatchObject({
      source: 'plan_revision',
      summary: 'priority_change: 先修 TUI 输入可靠性',
    });
    expect(entries[0].trace).toContain('trust_status=unverified');
    expect(entries[0].trace).toContain('task_id=task_2');
  });
});
