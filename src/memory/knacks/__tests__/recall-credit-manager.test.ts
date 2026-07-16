import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WriteQueue } from '../../../core/write-queue.js';
import { RecallCreditManager } from '../recall-credit-manager.js';

describe('RecallCreditManager', () => {
  let memoryDir: string;

  beforeEach(async () => {
    memoryDir = await mkdtemp(join(tmpdir(), 'recall-credit-'));
    WriteQueue.resetInstance();
    await mkdir(memoryDir, { recursive: true });
    await writeFile(join(memoryDir, 'knacks.jsonl'), `${JSON.stringify({
      id: 'knack_6938',
      status: 'validated',
      reuseCount: 2,
      lastSucceededTask: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    })}\n`, 'utf8');
  });

  afterEach(async () => {
    WriteQueue.resetInstance();
    await rm(memoryDir, { recursive: true, force: true });
  });

  it('credits valid cited knacks once after verification succeeds', async () => {
    const manager = new RecallCreditManager({ memoryDir });
    const input = {
      taskId: 'astropy__astropy-6938',
      runId: 'run_1',
      verificationStatus: 'passed' as const,
      verificationRef: 'harness:6938',
      usedRecallIds: ['knack_6938'],
    };

    expect(await manager.apply(input)).toMatchObject({ creditedIds: ['knack_6938'] });
    expect(await manager.apply(input)).toMatchObject({ creditedIds: [], duplicateIds: ['knack_6938'] });

    const knack = JSON.parse((await readFile(join(memoryDir, 'knacks.jsonl'), 'utf8')).trim());
    expect(knack).toMatchObject({
      reuseCount: 3,
      lastSucceededTask: 'astropy__astropy-6938',
    });
  });

  it('does not credit pending or failed verification', async () => {
    const manager = new RecallCreditManager({ memoryDir });
    for (const verificationStatus of ['pending', 'failed'] as const) {
      const result = await manager.apply({
        taskId: 'task_1',
        runId: `run_${verificationStatus}`,
        verificationStatus,
        verificationRef: `verifier:${verificationStatus}`,
        usedRecallIds: ['knack_6938'],
      });
      expect(result.creditedIds).toEqual([]);
    }

    const knack = JSON.parse((await readFile(join(memoryDir, 'knacks.jsonl'), 'utf8')).trim());
    expect(knack.reuseCount).toBe(2);
  });
});
