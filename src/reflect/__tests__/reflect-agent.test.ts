import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReflectAgent } from '../reflect-agent.js';
import { PreferenceCandidatesManager } from '../../memory/candidates/manager.js';
import { PreferencesManager } from '../../memory/preferences/manager.js';
import { WriteQueue } from '../../core/write-queue.js';

/** 生成包含 N 个 hunk 的 diff */
function makeDiff(filePath: string, hunks: string[]): string {
  const header = `diff --git a/${filePath} b/${filePath}\nindex abc..def 100644\n--- a/${filePath}\n+++ b/${filePath}\n`;
  return header + hunks.map((h) => `@@ -1,10 +1,10 @@\n${h}`).join('\n');
}

describe('ReflectAgent', () => {
  let tmpDir: string;
  let candidatesMgr: PreferenceCandidatesManager;
  let preferencesMgr: PreferencesManager;
  let agent: ReflectAgent;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'reflect-test-'));
    PreferenceCandidatesManager.resetInstance();
    PreferencesManager.resetInstance();
    WriteQueue.resetInstance();
    candidatesMgr = PreferenceCandidatesManager.getInstance(tmpDir);
    preferencesMgr = PreferencesManager.getInstance(tmpDir);
    agent = new ReflectAgent(candidatesMgr, preferencesMgr);
  });

  afterEach(async () => {
    PreferenceCandidatesManager.resetInstance();
    PreferencesManager.resetInstance();
    WriteQueue.resetInstance();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('提取模式并写入候选池', async () => {
    const diff = makeDiff('app.ts', [
      '-  console.log("debug1")',
      '-  console.log("debug2")',
    ]);

    const result = await agent.run({
      taskId: 'task_001',
      sessionRef: 'session_001',
      taskDescription: '清理调试代码',
      gitDiff: diff,
      totalTaskCount: 50,
    });

    expect(result.patternsExtracted).toBeGreaterThan(0);
    const candidates = await candidatesMgr.getAll();
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((c) => c.pattern.includes('调试输出'))).toBe(true);
  });

  it('多次运行后满足阈值则升级到 preferences', async () => {
    const diff = makeDiff('app.ts', [
      '-  console.log("a")',
      '-  debugger',
    ]);

    // 运行两次以达到 code-style 的 ≥2 观察阈值
    await agent.run({
      taskId: 'task_r1',
      sessionRef: 'session_r1',
      taskDescription: '清理代码',
      gitDiff: diff,
      totalTaskCount: 50,
    });

    const result2 = await agent.run({
      taskId: 'task_r2',
      sessionRef: 'session_r2',
      taskDescription: '继续清理',
      gitDiff: diff,
      totalTaskCount: 50,
    });

    expect(result2.promoted.length).toBeGreaterThan(0);

    const prefs = await preferencesMgr.getAll();
    expect(prefs.some((p) => p.rule.includes('调试输出'))).toBe(true);
  });

  it('冷启动保护下不提前升级', async () => {
    const diff = makeDiff('app.ts', [
      '-  console.log("a")',
      '-  debugger',
    ]);

    // 运行两次，但 totalTaskCount < 20（冷启动保护，阈值升至 4）
    await agent.run({
      taskId: 'task_cold1',
      sessionRef: 'session_cold1',
      taskDescription: '清理',
      gitDiff: diff,
      totalTaskCount: 5,
    });

    const result2 = await agent.run({
      taskId: 'task_cold2',
      sessionRef: 'session_cold2',
      taskDescription: '清理',
      gitDiff: diff,
      totalTaskCount: 6,
    });

    expect(result2.promoted).toHaveLength(0);
    const prefs = await preferencesMgr.getAll();
    expect(prefs).toHaveLength(0);
  });

  it('空 diff 不产生模式', async () => {
    const result = await agent.run({
      taskId: 'task_empty',
      sessionRef: 'session_empty',
      taskDescription: '查看代码',
      gitDiff: '',
      totalTaskCount: 50,
    });

    // D1 可能会从 taskDescription 提取语言偏好
    const candidates = await candidatesMgr.getAll();
    // 只可能有 D1 语言偏好（如果有的话），不会有代码风格候选
    const codeStyleCandidates = candidates.filter((c) => c.scope === 'code-style');
    expect(codeStyleCandidates).toHaveLength(0);
  });

  it('cleanup 在每次运行后执行', async () => {
    const result = await agent.run({
      taskId: 'task_cleanup',
      sessionRef: 'session_cleanup',
      taskDescription: 'test',
      gitDiff: '',
      totalTaskCount: 50,
    });

    // cleanup 返回统计信息
    expect(result.cleanupStats).toBeDefined();
    expect(typeof result.cleanupStats.discarded).toBe('number');
  });
});
