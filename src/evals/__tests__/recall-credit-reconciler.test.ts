import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WriteQueue } from '../../core/write-queue.js';
import { RunArchiveWriter } from '../../memory/run-archive/index.js';
import {
  categorizeRecallAttribution,
  reconcileSweBenchRecallCredits,
} from '../recall-credit-reconciler.js';
import type { SweBenchPatchProducerRecord } from '../swebench-patch-producer.js';

describe('recall credit reconciliation', () => {
  let memoryDir: string;

  beforeEach(async () => {
    memoryDir = await mkdtemp(join(tmpdir(), 'recall-reconcile-'));
    WriteQueue.resetInstance();
    await mkdir(memoryDir, { recursive: true });
    await writeFile(join(memoryDir, 'knacks.jsonl'), `${JSON.stringify({
      id: 'knack_12907',
      status: 'validated',
      reuseCount: 0,
      updatedAt: '2026-01-01T00:00:00.000Z',
    })}\n`, 'utf8');
    await new RunArchiveWriter({ memoryDir }).finalizeRun('run_12907', {
      taskId: 'task_12907',
      status: 'success',
      finalSummary: 'Patch produced',
      verificationStatus: 'pending',
    });
  });

  afterEach(async () => {
    WriteQueue.resetInstance();
    await rm(memoryDir, { recursive: true, force: true });
  });

  it('credits only resolved SWE-bench records and is idempotent', async () => {
    const records = [record('astropy__astropy-12907')];
    const first = await reconcileSweBenchRecallCredits({
      records,
      resolvedIds: ['astropy__astropy-12907'],
      memoryDir,
      verificationRef: 'harness:report',
    });
    const second = await reconcileSweBenchRecallCredits({
      records,
      resolvedIds: ['astropy__astropy-12907'],
      memoryDir,
      verificationRef: 'harness:report',
    });

    expect(first.records[0].attribution).toMatchObject({
      category: 'cited_and_verified',
      creditedIds: ['knack_12907'],
    });
    expect(second.records[0].attribution).toMatchObject({
      creditedIds: [],
      duplicateIds: ['knack_12907'],
    });
    const knack = JSON.parse((await readFile(join(memoryDir, 'knacks.jsonl'), 'utf8')).trim());
    expect(knack.reuseCount).toBe(1);
    const outcome = JSON.parse(await readFile(join(memoryDir, 'runs/run_12907/outcome.json'), 'utf8'));
    expect(outcome).toMatchObject({
      verificationStatus: 'passed',
      verificationEvidenceRef: 'harness:report:astropy__astropy-12907',
    });
  });

  it('classifies the four final audit outcomes plus pending', () => {
    expect(categorizeRecallAttribution({ injectedIds: [], usedIds: [], verificationStatus: 'failed' }))
      .toBe('not_injected');
    expect(categorizeRecallAttribution({ injectedIds: ['k'], usedIds: [], verificationStatus: 'passed' }))
      .toBe('injected_not_cited');
    expect(categorizeRecallAttribution({ injectedIds: ['k'], usedIds: ['k'], verificationStatus: 'pending' }))
      .toBe('cited_verifier_pending');
    expect(categorizeRecallAttribution({ injectedIds: ['k'], usedIds: ['k'], verificationStatus: 'failed' }))
      .toBe('cited_verifier_failed');
    expect(categorizeRecallAttribution({ injectedIds: ['k'], usedIds: ['k'], verificationStatus: 'passed' }))
      .toBe('cited_and_verified');
  });
});

function record(instanceId: string): SweBenchPatchProducerRecord {
  return {
    instanceId,
    agent: 'student-agent',
    modelNameOrPath: 'test-model',
    status: 'success',
    prediction: { instance_id: instanceId, model_name_or_path: 'test-model', model_patch: 'diff' },
    patchAnalysis: { patchBytes: 4, diffFiles: 1, emptyPatch: false, suspiciousPatch: false },
    emptyPatch: false,
    suspiciousPatch: false,
    durationMs: 1,
    trace: {
      taskId: instanceId,
      mode: 'direct',
      instruction: 'fix',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1000,
      status: 'success',
      finalOutput: 'done',
      toolCalls: [],
      tokenUsage: {
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0,
        costUsd: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      learningRun: { taskId: 'task_12907', runId: 'run_12907' },
      recallAudit: {
        injected_recall_ids: ['knack_12907'],
        cited_recall_ids: ['knack_12907'],
        used_recall_ids: ['knack_12907'],
        invalid_recall_ids: [],
        citation_events: [],
        utilization_rate: 1,
      },
    },
  };
}
