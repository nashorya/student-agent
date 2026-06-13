import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReflectAgent } from '../reflect-agent.js';
import { PreferenceCandidatesManager } from '../../memory/candidates/manager.js';
import { PreferencesManager } from '../../memory/preferences/manager.js';
import { WriteQueue } from '../../core/write-queue.js';
import { BoundedBreaker } from '../bounded-breaker.js';
import { BreakerLogManager } from '../breaker-log-manager.js';
import { LessonsManager } from '../../memory/lessons/manager.js';
import { appendSignal } from '../../memory/signals/index.js';
import { KnacksManager } from '../../memory/knacks/index.js';

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
    LessonsManager.resetInstance();
    KnacksManager.resetInstance();
    WriteQueue.resetInstance();
    candidatesMgr = PreferenceCandidatesManager.getInstance(tmpDir);
    preferencesMgr = PreferencesManager.getInstance(tmpDir);
    agent = new ReflectAgent(candidatesMgr, preferencesMgr);
  });

  afterEach(async () => {
    PreferenceCandidatesManager.resetInstance();
    PreferencesManager.resetInstance();
    LessonsManager.resetInstance();
    KnacksManager.resetInstance();
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
    expect(prefs.some((p) => p.apply_caution === true)).toBe(true);
  });

  it('候选升级后不会重复提升为 preference', async () => {
    const diff = makeDiff('app.ts', [
      '-  console.log("a")',
      '-  debugger',
    ]);

    await agent.run({
      taskId: 'task_dup1',
      sessionRef: 'session_dup1',
      taskDescription: '清理代码',
      gitDiff: diff,
      totalTaskCount: 50,
    });

    await agent.run({
      taskId: 'task_dup2',
      sessionRef: 'session_dup2',
      taskDescription: '继续清理',
      gitDiff: diff,
      totalTaskCount: 50,
    });

    const result3 = await agent.run({
      taskId: 'task_dup3',
      sessionRef: 'session_dup3',
      taskDescription: '继续清理',
      gitDiff: diff,
      totalTaskCount: 50,
    });

    expect(result3.promoted).toHaveLength(0);

    const prefs = await preferencesMgr.getAll();
    expect(prefs.filter((p) => p.rule.includes('调试输出'))).toHaveLength(1);

    const candidates = await candidatesMgr.getAll();
    expect(candidates.some((c) => c.pattern.includes('调试输出') && c.status === 'promoted')).toBe(true);
  });

  it('Breaker 低置信只记录报告，不阻止信任状态机升级', async () => {
    agent = new ReflectAgent(
      candidatesMgr,
      preferencesMgr,
      new BoundedBreaker({
        reviewer: {
          review: async () => ({
            confidenceLevel: 'low',
            knownFailureContext: ['mock low confidence'],
            unknownRiskZones: ['mock risk'],
          }),
        },
      }),
    );
    const diff = makeDiff('app.ts', [
      '-  console.log("a")',
      '-  debugger',
    ]);

    await agent.run({
      taskId: 'task_low1',
      sessionRef: 'session_low1',
      taskDescription: '清理代码',
      gitDiff: diff,
      totalTaskCount: 50,
    });
    const result2 = await agent.run({
      taskId: 'task_low2',
      sessionRef: 'session_low2',
      taskDescription: '继续清理',
      gitDiff: diff,
      totalTaskCount: 50,
    });

    expect(result2.promoted.length).toBeGreaterThan(0);
    const prefs = await preferencesMgr.getAll();
    expect(prefs).toHaveLength(1);
    expect(prefs[0].provenance.source_type).toBe('reflect-agent');
    const candidates = await candidatesMgr.getAll();
    expect(candidates.some((c) => c.breaker_report?.confidence_level === 'low')).toBe(true);
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

  it('Bounded Breaker 禁用时仍按信任状态机升级且不写 breaker report', async () => {
    agent = new ReflectAgent(candidatesMgr, preferencesMgr, null);
    const diff = makeDiff('app.ts', [
      '-  console.log("a")',
      '-  debugger',
    ]);

    await agent.run({
      taskId: 'task_no_breaker1',
      sessionRef: 'session_no_breaker1',
      taskDescription: '清理代码',
      gitDiff: diff,
      totalTaskCount: 50,
    });
    const result2 = await agent.run({
      taskId: 'task_no_breaker2',
      sessionRef: 'session_no_breaker2',
      taskDescription: '继续清理',
      gitDiff: diff,
      totalTaskCount: 50,
    });

    expect(result2.promoted.length).toBeGreaterThan(0);
    const candidates = await candidatesMgr.getAll();
    expect(candidates.every((candidate) => candidate.breaker_report === null)).toBe(true);
  });

  it('Breaker 日志写入失败时不阻断升级流程', async () => {
    const breakerLogManager = {
      append: async () => {
        throw new Error('disk full');
      },
    } as unknown as BreakerLogManager;
    agent = new ReflectAgent(
      candidatesMgr,
      preferencesMgr,
      new BoundedBreaker(),
      breakerLogManager,
    );
    const diff = makeDiff('app.ts', [
      '-  console.log("a")',
      '-  debugger',
    ]);

    await agent.run({
      taskId: 'task_log_fail_1',
      sessionRef: 'session_log_fail_1',
      taskDescription: '清理代码',
      gitDiff: diff,
      totalTaskCount: 50,
    });
    const result2 = await agent.run({
      taskId: 'task_log_fail_2',
      sessionRef: 'session_log_fail_2',
      taskDescription: '继续清理',
      gitDiff: diff,
      totalTaskCount: 50,
    });

    expect(result2.promoted.length).toBeGreaterThan(0);
    expect(await preferencesMgr.getAll()).toHaveLength(1);
  });

  it('architecture 候选满足阈值后进入用户确认，不自动写 preferences', async () => {
    await candidatesMgr.observe({
      pattern: '架构规则需要确认',
      scope: 'architecture',
      taskId: 'task_arch1',
      sessionRef: 'session_arch1',
      triggerContext: 'test',
    });
    await candidatesMgr.observe({
      pattern: '架构规则需要确认',
      scope: 'architecture',
      taskId: 'task_arch2',
      sessionRef: 'session_arch2',
      triggerContext: 'test',
    });
    await candidatesMgr.observe({
      pattern: '架构规则需要确认',
      scope: 'architecture',
      taskId: 'task_arch3',
      sessionRef: 'session_arch3',
      triggerContext: 'test',
    });

    const result = await agent.run({
      taskId: 'task_arch_run',
      sessionRef: 'session_arch_run',
      taskDescription: '检查架构规则',
      gitDiff: '',
      totalTaskCount: 50,
    });

    expect(result.promoted).toHaveLength(0);
    expect(await preferencesMgr.getAll()).toHaveLength(0);
    const candidate = await candidatesMgr.findByPattern('架构规则需要确认');
    expect(candidate?.status).toBe('pending_user_confirmation');
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

  it('将没有成功验证配对的 lesson 路由到 ephemeral', async () => {
    const lessonsMgr = LessonsManager.getInstance(tmpDir);
    await appendSignal({
      id: 'sig_reflect_1',
      kind: 'tool_error',
      severity: 'medium',
      summary: 'oldText must match exactly',
      toolName: 'edit',
      toolCallId: 'call_1',
      evidenceRef: 'call_1',
      createdAt: '2026-01-01T00:00:00.000Z',
    }, tmpDir);
    agent = new ReflectAgent(
      candidatesMgr,
      preferencesMgr,
      null,
      undefined,
      lessonsMgr,
    );

    const result = await agent.run({
      taskId: 'task_lesson',
      sessionRef: 'session_lesson',
      taskDescription: '修复编辑失败',
      gitDiff: '',
      totalTaskCount: 50,
    });

    expect(result.lessonsExtracted).toBe(1);
    expect(await lessonsMgr.getAll()).toHaveLength(0);
    const ephemeral = await lessonsMgr.getEphemeral();
    expect(ephemeral).toHaveLength(1);
    expect(ephemeral[0]).toMatchObject({
      sourceSignalId: 'sig_reflect_1',
      lesson: 'Treat tool error as a retry pattern: oldText must match exactly',
      quality: 'low',
    });
  });

  it('重复 signal 会把 observed lesson 自动升格为 knack', async () => {
    const lessonsMgr = LessonsManager.getInstance(tmpDir);
    const knacksMgr = KnacksManager.getInstance(tmpDir);
    await appendSignal({
      id: 'sig_repeat_1',
      kind: 'tool_error',
      severity: 'medium',
      summary: 'oldText must match exactly',
      toolName: 'edit',
      toolCallId: 'call_1',
      createdAt: '2026-01-01T00:00:00.000Z',
    }, tmpDir);
    await appendSignal({
      id: 'sig_repeat_2',
      kind: 'tool_error',
      severity: 'medium',
      summary: 'oldText must match exactly',
      toolName: 'edit',
      toolCallId: 'call_2',
      createdAt: '2026-01-02T00:00:00.000Z',
    }, tmpDir);
    agent = new ReflectAgent(
      candidatesMgr,
      preferencesMgr,
      null,
      undefined,
      lessonsMgr,
      knacksMgr,
    );

    const result = await agent.run({
      taskId: 'task_knack',
      sessionRef: 'session_knack',
      taskDescription: '修复重复编辑失败',
      gitDiff: '',
      totalTaskCount: 50,
      lessonVerificationEvidence: [{
        toolCallId: 'call_verify',
        toolName: 'bash',
        exitCode: 0,
        completedAt: '2026-01-03T00:00:00.000Z',
      }],
    });

    expect(result.lessonsExtracted).toBe(2);
    expect(result.knacksPromoted).toBe(2);
    const lessons = await lessonsMgr.getAll();
    expect(lessons.map((lesson) => lesson.status)).toEqual(['promoted', 'promoted']);
    const knacks = await knacksMgr.getAll();
    expect(knacks).toHaveLength(2);
    expect(knacks.every((knack) => knack.id.startsWith('knack_'))).toBe(true);
  });
});
