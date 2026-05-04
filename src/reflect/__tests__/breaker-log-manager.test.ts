import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WriteQueue } from '../../core/write-queue.js';
import { BreakerLogManager } from '../breaker-log-manager.js';

describe('BreakerLogManager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'breaker-log-test-'));
    WriteQueue.resetInstance();
  });

  afterEach(async () => {
    WriteQueue.resetInstance();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('append 写入独立 breaker log 文件', async () => {
    const manager = new BreakerLogManager(tmpDir);
    await manager.append({
      task_id: 'task_1',
      candidate_id: 'cand_1',
      report: {
        id: 'breaker_1',
        confidence_level: 'high',
        breakers_applied: ['extreme-value-test'],
        known_failure_context: [],
        unknown_risk_zones: [],
        recommendation: 'promote',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    });

    const files = await readdir(join(tmpDir, 'breaker-logs'));
    expect(files).toHaveLength(1);
    const raw = await readFile(join(tmpDir, 'breaker-logs', files[0]), 'utf-8');
    expect(JSON.parse(raw)).toMatchObject({
      task_id: 'task_1',
      candidate_id: 'cand_1',
    });
  });
});
