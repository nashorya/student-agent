import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { WriteQueue } from '../../../core/write-queue.js';
import { PlanRevisionManager } from '../manager.js';

describe('PlanRevisionManager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'plan-revisions-test-'));
    PlanRevisionManager.resetInstance();
    WriteQueue.resetInstance();
  });

  afterEach(async () => {
    PlanRevisionManager.resetInstance();
    WriteQueue.resetInstance();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('reads empty file as empty revisions', async () => {
    await expect(PlanRevisionManager.getInstance(tmpDir).getAll()).resolves.toEqual([]);
  });

  it('appends and searches plan revisions', async () => {
    const manager = PlanRevisionManager.getInstance(tmpDir);
    const saved = await manager.append(makeRevisionInput({ userRevisionSummary: '先修输入队列' }));

    expect(saved.id).toMatch(/^plan_revision_/);
    await expect(manager.search('输入队列')).resolves.toHaveLength(1);
  });

  it('dedupes by task and summaries, then marks as reobserved', async () => {
    const manager = PlanRevisionManager.getInstance(tmpDir);
    const first = await manager.append(makeRevisionInput({ userRevisionSummary: '只做低风险修复' }));
    const second = await manager.append(makeRevisionInput({ userRevisionSummary: '只做低风险修复' }));

    expect(second.id).toBe(first.id);
    expect(second.observations).toBe(2);
    expect(second.trust_status).toBe('reobserved');
    await expect(manager.getAll()).resolves.toHaveLength(1);
  });

  it('getRecent excludes contested revisions', async () => {
    const manager = PlanRevisionManager.getInstance(tmpDir);
    const saved = await manager.append(makeRevisionInput({ userRevisionSummary: '不要重构' }));
    await manager.markContested(saved.id);

    await expect(manager.getRecent()).resolves.toEqual([]);
  });

  it('supports memory mode', async () => {
    PlanRevisionManager.resetInstance();
    const manager = PlanRevisionManager.getInstance(':memory:');
    await manager.append(makeRevisionInput({ userRevisionSummary: '验收标准改成测试通过' }));

    await expect(manager.getAll()).resolves.toHaveLength(1);
  });
});

function makeRevisionInput(overrides: Partial<Parameters<PlanRevisionManager['append']>[0]> = {}): Parameters<PlanRevisionManager['append']>[0] {
  return {
    taskId: 'task_1',
    sessionRef: 'session_1',
    agentPlanSummary: '任务: Phase 1 改 UI | Phase 2 测试',
    userRevisionSummary: '先做 Phase 1',
    diffType: 'priority_change',
    reasonInferred: '用户调整了优先级。',
    outcome: 'observed',
    trustStatus: 'unverified',
    sourceType: 'automatic-detection',
    ...overrides,
  };
}
