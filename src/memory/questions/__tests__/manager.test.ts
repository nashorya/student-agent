import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QuestionsManager } from '../manager.js';
import type { Question } from '../types.js';

function makeQuestion(id: string, errorType = 'tool', errorSubtype = 'timeout'): Question {
  return {
    id,
    error_type: errorType,
    error_subtype: errorSubtype,
    context: 'test context',
    attempts: [{ strategy: '降级重试', result: '失败', reason: 'test reason' }],
    status: 'unverified',
    hit_count: 1,
    last_hit: new Date().toISOString(),
    provenance: {
      source_type: 'machine-inferred',
      task_id: 'task_test',
      session_ref: 'session_test',
      trust_status: 'pending',
    },
  };
}

describe('QuestionsManager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'questions-test-'));
    QuestionsManager.resetInstance();
  });

  afterEach(async () => {
    QuestionsManager.resetInstance();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('append 新 question → getAll 返回该条目', async () => {
    const mgr = QuestionsManager.getInstance(tmpDir);
    const q = makeQuestion('q_001');
    await mgr.append(q);
    const all = await mgr.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('q_001');
  });

  it('append 重复 id → 不新增，更新 hit_count 和 last_hit', async () => {
    const mgr = QuestionsManager.getInstance(tmpDir);
    const q = makeQuestion('q_002');
    await mgr.append(q);
    const before = await mgr.getAll();
    const originalLastHit = before[0].last_hit;

    await new Promise((r) => setTimeout(r, 10));
    await mgr.append(q);
    const after = await mgr.getAll();
    expect(after).toHaveLength(1);
    expect(after[0].hit_count).toBe(2);
    expect(after[0].last_hit).not.toBe(originalLastHit);
  });

  it('findByError 匹配 → 返回正确条目', async () => {
    const mgr = QuestionsManager.getInstance(tmpDir);
    await mgr.append(makeQuestion('q_003', 'tool', 'selector-not-found'));
    await mgr.append(makeQuestion('q_004', 'environment', 'network-unreachable'));
    const results = await mgr.findByError('tool', 'selector-not-found');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('q_003');
  });

  it('findByError 不匹配 → 返回空数组', async () => {
    const mgr = QuestionsManager.getInstance(tmpDir);
    await mgr.append(makeQuestion('q_005', 'tool', 'timeout'));
    const results = await mgr.findByError('model', 'json-parse');
    expect(results).toHaveLength(0);
  });

  it('文件不存在时 append → 自动创建文件并写入', async () => {
    const nonExistentDir = join(tmpDir, 'nested', 'memory');
    const mgr = QuestionsManager.getInstance(nonExistentDir);
    const q = makeQuestion('q_006');
    await mgr.append(q);
    const all = await mgr.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('q_006');
  });
});
