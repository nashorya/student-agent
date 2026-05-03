import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PreferenceCandidatesManager } from '../manager.js';
import { WriteQueue } from '../../../core/write-queue.js';
import type { PreferenceCandidate } from '../types.js';

function defaultObserveParams(pattern: string, scope: PreferenceCandidate['scope'] = 'code-style') {
  return {
    pattern,
    scope,
    taskId: `task_${Date.now()}`,
    sessionRef: `session_${Date.now()}`,
    triggerContext: '测试上下文',
  };
}

describe('PreferenceCandidatesManager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'candidates-test-'));
    PreferenceCandidatesManager.resetInstance();
    WriteQueue.resetInstance();
  });

  afterEach(async () => {
    PreferenceCandidatesManager.resetInstance();
    WriteQueue.resetInstance();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── 基础读写 ──────────────────────────────────

  it('空文件时 getAll 返回空数组', async () => {
    const mgr = PreferenceCandidatesManager.getInstance(tmpDir);
    expect(await mgr.getAll()).toEqual([]);
  });

  // ── observe() ─────────────────────────────────

  it('首次 observe 创建新候选', async () => {
    const mgr = PreferenceCandidatesManager.getInstance(tmpDir);
    await mgr.observe(defaultObserveParams('用户删除了行内注释'));

    const all = await mgr.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].pattern).toBe('用户删除了行内注释');
    expect(all[0].observations).toBe(1);
    expect(all[0].contradictions).toBe(0);
    expect(all[0].status).toBe('observed');
    expect(all[0].provenance[0].trust_status).toBe('unverified');
  });

  it('重复 observe 同一 pattern 更新观察次数', async () => {
    const mgr = PreferenceCandidatesManager.getInstance(tmpDir);
    await mgr.observe(defaultObserveParams('偏好 map'));
    await mgr.observe(defaultObserveParams('偏好 map'));

    const all = await mgr.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].observations).toBe(2);
  });

  it('不同 pattern 的 observe 创建不同候选', async () => {
    const mgr = PreferenceCandidatesManager.getInstance(tmpDir);
    await mgr.observe(defaultObserveParams('模式A'));
    await mgr.observe(defaultObserveParams('模式B'));

    expect(await mgr.getAll()).toHaveLength(2);
  });

  // ── 信任状态流转 ──────────────────────────────

  it('观察 ≥2 次后信任状态升级为 re-observed', async () => {
    const mgr = PreferenceCandidatesManager.getInstance(tmpDir);
    await mgr.observe(defaultObserveParams('删除注释'));
    await mgr.observe(defaultObserveParams('删除注释'));

    const candidate = await mgr.findByPattern('删除注释');
    expect(candidate).not.toBeNull();
    const lastProv = candidate!.provenance[candidate!.provenance.length - 1];
    expect(lastProv.trust_status).toBe('re-observed');
  });

  // ── recordContradiction() ─────────────────────

  it('recordContradiction 增加矛盾计数', async () => {
    const mgr = PreferenceCandidatesManager.getInstance(tmpDir);
    await mgr.observe(defaultObserveParams('某模式'));

    const before = (await mgr.getAll())[0];
    await mgr.recordContradiction(before.id);

    const after = await mgr.findById(before.id);
    expect(after!.contradictions).toBe(1);
  });

  // ── checkUpgradeEligibility() ─────────────────

  it('code-style 观察 ≥2 次满足升级条件', () => {
    const mgr = PreferenceCandidatesManager.getInstance(tmpDir);
    const candidate: PreferenceCandidate = {
      id: 'pref_cand_test',
      pattern: 'test',
      scope: 'code-style',
      observations: 2,
      first_observed: new Date().toISOString(),
      last_observed: new Date().toISOString(),
      contradictions: 0,
      status: 'observed',
      trigger_context: '',
      breaker_report: null,
      provenance: [{ source_type: 'reflect-agent', task_id: 't1', session_ref: 's1', trust_status: 're-observed' }],
    };

    const result = mgr.checkUpgradeEligibility(candidate, 50);
    expect(result.eligible).toBe(true);
  });

  it('冷启动保护：taskCount < 20 时阈值提升为 4', () => {
    const mgr = PreferenceCandidatesManager.getInstance(tmpDir);
    const candidate: PreferenceCandidate = {
      id: 'pref_cand_cold',
      pattern: 'cold test',
      scope: 'code-style',
      observations: 2,
      first_observed: new Date().toISOString(),
      last_observed: new Date().toISOString(),
      contradictions: 0,
      status: 'observed',
      trigger_context: '',
      breaker_report: null,
      provenance: [{ source_type: 'reflect-agent', task_id: 't1', session_ref: 's1', trust_status: 're-observed' }],
    };

    // taskCount = 10 < 20，冷启动保护激活，阈值 = max(2, 4) = 4
    const result = mgr.checkUpgradeEligibility(candidate, 10);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('冷启动保护：是');
  });

  it('architecture scope 需要 trust ≥ re-observed', () => {
    const mgr = PreferenceCandidatesManager.getInstance(tmpDir);
    const candidate: PreferenceCandidate = {
      id: 'pref_cand_arch',
      pattern: 'arch test',
      scope: 'architecture',
      observations: 3,
      first_observed: new Date().toISOString(),
      last_observed: new Date().toISOString(),
      contradictions: 0,
      status: 'observed',
      trigger_context: '',
      breaker_report: null,
      provenance: [{ source_type: 'reflect-agent', task_id: 't1', session_ref: 's1', trust_status: 'unverified' }],
    };

    const result = mgr.checkUpgradeEligibility(candidate, 50);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('architecture');
  });

  it('contested 状态不可升级', () => {
    const mgr = PreferenceCandidatesManager.getInstance(tmpDir);
    const candidate: PreferenceCandidate = {
      id: 'pref_cand_contested',
      pattern: 'contested test',
      scope: 'code-style',
      observations: 5,
      first_observed: new Date().toISOString(),
      last_observed: new Date().toISOString(),
      contradictions: 1,
      status: 'observed',
      trigger_context: '',
      breaker_report: null,
      provenance: [{ source_type: 'reflect-agent', task_id: 't1', session_ref: 's1', trust_status: 'contested' }],
    };

    const result = mgr.checkUpgradeEligibility(candidate, 50);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('矛盾');
  });

  // ── cleanup() ─────────────────────────────────

  it('cleanup 丢弃 contradictions ≥ observations 的候选', async () => {
    const mgr = PreferenceCandidatesManager.getInstance(tmpDir);
    await mgr.observe(defaultObserveParams('会被丢弃'));

    const all = await mgr.getAll();
    // 手动让 contradictions ≥ observations
    await mgr.recordContradiction(all[0].id);

    const stats = await mgr.cleanup();
    expect(stats.discarded).toBe(1);
    expect(await mgr.getAll()).toHaveLength(0);
  });

  it('cleanup 不影响正常候选', async () => {
    const mgr = PreferenceCandidatesManager.getInstance(tmpDir);
    await mgr.observe(defaultObserveParams('正常候选'));

    const stats = await mgr.cleanup();
    expect(stats.discarded).toBe(0);
    expect(stats.archived).toBe(0);
    expect(stats.deleted).toBe(0);
    expect(await mgr.getAll()).toHaveLength(1);
  });

  // ── 并发安全 ──────────────────────────────────

  it('并发 observe 不丢失数据', async () => {
    const mgr = PreferenceCandidatesManager.getInstance(tmpDir);

    const promises = Array.from({ length: 5 }, (_, i) =>
      mgr.observe(defaultObserveParams(`并发模式${i}`)),
    );
    await Promise.all(promises);

    const all = await mgr.getAll();
    expect(all).toHaveLength(5);
  });
});
