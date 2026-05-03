import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PreferencesManager } from '../manager.js';
import { WriteQueue } from '../../../core/write-queue.js';
import type { PreferencesFile } from '../types.js';

describe('PreferencesManager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'prefs-test-'));
    PreferencesManager.resetInstance();
    WriteQueue.resetInstance();
  });

  afterEach(async () => {
    PreferencesManager.resetInstance();
    WriteQueue.resetInstance();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── 基础读写 ──────────────────────────────────

  it('空文件时 getAll 返回空数组', async () => {
    const mgr = PreferencesManager.getInstance(tmpDir);
    const all = await mgr.getAll();
    expect(all).toEqual([]);
  });

  it('空文件时 getHeader 返回 null', async () => {
    const mgr = PreferencesManager.getInstance(tmpDir);
    const header = await mgr.getHeader();
    expect(header).toBeNull();
  });

  // ── 显式通道 ──────────────────────────────────

  it('addExplicit 写入后 getAll 可检索', async () => {
    const mgr = PreferencesManager.getInstance(tmpDir);
    await mgr.addExplicit({
      rule: '不要加行内注释',
      scope: 'code-style',
      taskId: 'task_001',
      sessionRef: 'session_001',
    });

    const all = await mgr.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].rule).toBe('不要加行内注释');
    expect(all[0].scope).toBe('code-style');
    expect(all[0].provenance.source_type).toBe('user-explicit');
  });

  it('addExplicit 设置 version = 1 和 change 摘要', async () => {
    const mgr = PreferencesManager.getInstance(tmpDir);
    await mgr.addExplicit({
      rule: '用 map 不要用 for',
      scope: 'code-style',
      taskId: 'task_002',
      sessionRef: 'session_002',
    });

    const header = await mgr.getHeader();
    expect(header).not.toBeNull();
    expect(header!.version).toBe(1);
    expect(header!.change).toContain('code-style');
    expect(header!.change).toContain('显式指令');
  });

  it('多次 addExplicit 后 version 递增', async () => {
    const mgr = PreferencesManager.getInstance(tmpDir);
    await mgr.addExplicit({
      rule: '规则一',
      scope: 'code-style',
      taskId: 'task_003',
      sessionRef: 'session_003',
    });
    await mgr.addExplicit({
      rule: '规则二',
      scope: 'tool-preference',
      taskId: 'task_004',
      sessionRef: 'session_004',
    });

    const header = await mgr.getHeader();
    expect(header!.version).toBe(2);

    const all = await mgr.getAll();
    expect(all).toHaveLength(2);
  });

  // ── 隐式通道 ──────────────────────────────────

  it('promoteFromCandidate 正确记录 provenance 和 apply_caution', async () => {
    const mgr = PreferencesManager.getInstance(tmpDir);
    await mgr.promoteFromCandidate({
      rule: '用户不喜欢行内注释',
      scope: 'code-style',
      provenance: {
        source_type: 'reflect-agent',
        task_id: 'task_010',
        session_ref: 'session_010',
        created_at: new Date().toISOString(),
      },
      applyCaution: true,
    });

    const all = await mgr.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].provenance.source_type).toBe('reflect-agent');
    expect(all[0].apply_caution).toBe(true);
  });

  // ── getByScope ────────────────────────────────

  it('getByScope 只返回匹配 scope 的条目', async () => {
    const mgr = PreferencesManager.getInstance(tmpDir);
    await mgr.addExplicit({
      rule: '代码风格规则',
      scope: 'code-style',
      taskId: 'task_020',
      sessionRef: 'session_020',
    });
    await mgr.addExplicit({
      rule: '工具偏好规则',
      scope: 'tool-preference',
      taskId: 'task_021',
      sessionRef: 'session_021',
    });

    const codeStyle = await mgr.getByScope('code-style');
    expect(codeStyle).toHaveLength(1);
    expect(codeStyle[0].rule).toBe('代码风格规则');

    const arch = await mgr.getByScope('architecture');
    expect(arch).toHaveLength(0);
  });

  // ── 版本快照 ──────────────────────────────────

  it('第二次写入时创建版本快照', async () => {
    const mgr = PreferencesManager.getInstance(tmpDir);

    // 第一次写入：无快照（没有旧文件可备份）
    await mgr.addExplicit({
      rule: '规则 v1',
      scope: 'code-style',
      taskId: 'task_030',
      sessionRef: 'session_030',
    });

    const historyDir = join(tmpDir, 'preferences-history');
    let historyFiles: string[] = [];
    try {
      historyFiles = await readdir(historyDir);
    } catch {
      // 目录不存在是正常的
    }
    expect(historyFiles).toHaveLength(0);

    // 第二次写入：应该产生 v1 的快照
    await mgr.addExplicit({
      rule: '规则 v2',
      scope: 'tool-preference',
      taskId: 'task_031',
      sessionRef: 'session_031',
    });

    historyFiles = await readdir(historyDir);
    expect(historyFiles).toHaveLength(1);
    expect(historyFiles[0]).toMatch(/^v1_/);

    // 验证快照内容是 v1 的数据
    const snapshotRaw = await readFile(join(historyDir, historyFiles[0]), 'utf-8');
    const snapshot = JSON.parse(snapshotRaw) as PreferencesFile;
    expect(snapshot.header.version).toBe(1);
    expect(snapshot.preferences).toHaveLength(1);
    expect(snapshot.preferences[0].rule).toBe('规则 v1');
  });

  // ── 并发安全 ──────────────────────────────────

  it('并发写入通过 WriteQueue 串行化，数据不丢失', async () => {
    const mgr = PreferencesManager.getInstance(tmpDir);

    // 同时发起 5 个写入
    const promises = Array.from({ length: 5 }, (_, i) =>
      mgr.addExplicit({
        rule: `并发规则 ${i}`,
        scope: 'code-style',
        taskId: `task_concurrent_${i}`,
        sessionRef: `session_concurrent_${i}`,
      }),
    );

    await Promise.all(promises);

    const all = await mgr.getAll();
    expect(all).toHaveLength(5);

    const header = await mgr.getHeader();
    expect(header!.version).toBe(5);
  });

  // ── 首次写入 ──────────────────────────────────

  it('嵌套目录不存在时自动创建', async () => {
    const nestedDir = join(tmpDir, 'nested', 'deep', 'memory');
    const mgr = PreferencesManager.getInstance(nestedDir);
    await mgr.addExplicit({
      rule: '深层目录规则',
      scope: 'communication',
      taskId: 'task_nested',
      sessionRef: 'session_nested',
    });

    const all = await mgr.getAll();
    expect(all).toHaveLength(1);
  });
});
