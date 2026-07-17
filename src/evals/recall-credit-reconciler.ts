import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { RecallCreditManager, type RecallCreditResult } from '../memory/knacks/index.js';
import type { RecallCitationAudit } from '../memory/recall/citation.js';
import { RunArchiveWriter } from '../memory/run-archive/index.js';
import type { SweBenchPatchProducerRecord } from './swebench-patch-producer.js';

export type RecallAttributionCategory =
  | 'not_injected'
  | 'injected_not_cited'
  | 'cited_verifier_pending'
  | 'cited_verifier_failed'
  | 'cited_and_verified';

export interface RecallAttributionResult extends RecallCreditResult {
  category: RecallAttributionCategory;
  verificationStatus: 'pending' | 'passed' | 'failed';
  verificationRef: string;
  injectedIds: string[];
  usedIds: string[];
}

export async function reconcileRecallCredit(input: {
  memoryDir: string;
  taskId: string;
  runId: string;
  audit?: RecallCitationAudit;
  verificationStatus: 'pending' | 'passed' | 'failed';
  verificationRef: string;
  dryRun?: boolean;
}): Promise<RecallAttributionResult> {
  const injectedIds = input.audit?.injected_recall_ids ?? [];
  const usedIds = input.audit?.used_recall_ids ?? [];
  const category = categorizeRecallAttribution({
    injectedIds,
    usedIds,
    verificationStatus: input.verificationStatus,
  });
  const credit = input.dryRun
    ? { creditedIds: [], duplicateIds: [], missingIds: [] }
    : await new RecallCreditManager({ memoryDir: input.memoryDir }).apply({
      taskId: input.taskId,
      runId: input.runId,
      verificationStatus: input.verificationStatus,
      verificationRef: input.verificationRef,
      usedRecallIds: usedIds,
    });
  if (!input.dryRun) {
    await new RunArchiveWriter({ memoryDir: input.memoryDir }).updateVerification(input.runId, {
      status: input.verificationStatus,
      evidenceRef: input.verificationRef,
    });
  }
  return {
    category,
    verificationStatus: input.verificationStatus,
    verificationRef: input.verificationRef,
    injectedIds,
    usedIds,
    ...credit,
  };
}

export function categorizeRecallAttribution(input: {
  injectedIds: string[];
  usedIds: string[];
  verificationStatus: 'pending' | 'passed' | 'failed';
}): RecallAttributionCategory {
  if (input.injectedIds.length === 0) return 'not_injected';
  if (input.usedIds.length === 0) return 'injected_not_cited';
  if (input.verificationStatus === 'pending') return 'cited_verifier_pending';
  if (input.verificationStatus === 'failed') return 'cited_verifier_failed';
  return 'cited_and_verified';
}

export async function reconcileSweBenchRecallCredits(input: {
  records: SweBenchPatchProducerRecord[];
  resolvedIds: string[];
  failedIds?: string[];
  memoryDir: string;
  verificationRef: string;
  dryRun?: boolean;
}): Promise<{
  records: Array<{ instanceId: string; attribution: RecallAttributionResult }>;
  counts: Record<RecallAttributionCategory, number>;
}> {
  const resolved = new Set(input.resolvedIds);
  const failed = new Set(input.failedIds ?? []);
  const records: Array<{ instanceId: string; attribution: RecallAttributionResult }> = [];
  for (const record of input.records) {
    const run = record.trace?.learningRun;
    if (!run) continue;
    const verificationStatus = resolved.has(record.instanceId)
      ? 'passed'
      : failed.has(record.instanceId) ? 'failed' : 'pending';
    records.push({
      instanceId: record.instanceId,
      attribution: await reconcileRecallCredit({
        memoryDir: input.memoryDir,
        taskId: record.instanceId,
        runId: run.runId,
        audit: record.trace?.recallAudit,
        verificationStatus,
        verificationRef: `${input.verificationRef}:${record.instanceId}`,
        dryRun: input.dryRun,
      }),
    });
  }
  return { records, counts: countCategories(records.map((record) => record.attribution.category)) };
}

export async function loadSweBenchRecallReconciliationInput(options: {
  recordsPath: string;
  harnessPath: string;
}): Promise<{
  records: SweBenchPatchProducerRecord[];
  resolvedIds: string[];
  failedIds: string[];
  verificationRef: string;
}> {
  const recordsJson = JSON.parse(await readFile(options.recordsPath, 'utf8')) as {
    records?: SweBenchPatchProducerRecord[];
  };
  const harnessJson = JSON.parse(await readFile(options.harnessPath, 'utf8')) as {
    resolved_ids?: unknown[];
    unresolved_ids?: unknown[];
  };
  return {
    records: recordsJson.records ?? [],
    resolvedIds: (harnessJson.resolved_ids ?? []).filter((id): id is string => typeof id === 'string'),
    failedIds: (harnessJson.unresolved_ids ?? []).filter((id): id is string => typeof id === 'string'),
    verificationRef: `swebench:${basename(options.harnessPath)}`,
  };
}

function countCategories(categories: RecallAttributionCategory[]): Record<RecallAttributionCategory, number> {
  const counts: Record<RecallAttributionCategory, number> = {
    not_injected: 0,
    injected_not_cited: 0,
    cited_verifier_pending: 0,
    cited_verifier_failed: 0,
    cited_and_verified: 0,
  };
  for (const category of categories) counts[category] += 1;
  return counts;
}
