import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WriteQueue } from '../../core/write-queue.js';
import { ContextBuilder } from '../../memory/recall/context-builder.js';
import { buildRecallCitationAudit } from '../../memory/recall/citation.js';
import type { RecallBundle, RecalledItem } from '../../memory/recall/types.js';
import { RECALL_LIMITS } from '../../memory/recall/tier-selector.js';
import { reconcileRecallCredit } from '../recall-credit-reconciler.js';
import { workingMemory } from './fixtures/working-memory.js';

describe('Context Runtime Eval: P3 recall citation and credit', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    WriteQueue.resetInstance();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it.each([
    ['astropy__astropy-6938', 'knack-astropy-astropy-e4073fa1578d', 'Assign the replace result back to output_field'],
    ['astropy__astropy-12907', 'knack-astropy-astropy-56bb6cb9aa1e', 'Copy the actual nested separability matrix values'],
  ])('carries %s from standard top-three prompt citation to verified idempotent credit', async (
    taskId,
    knackId,
    summary,
  ) => {
    const memoryDir = await mkdtemp(join(tmpdir(), 'p3-citation-eval-'));
    dirs.push(memoryDir);
    await mkdir(memoryDir, { recursive: true });
    await writeFile(join(memoryDir, 'knacks.jsonl'), `${JSON.stringify({
      id: knackId,
      status: 'validated',
      summary,
      reuseCount: 0,
      updatedAt: '2026-01-01T00:00:00.000Z',
    })}\n`, 'utf8');
    const injected = [
      recalled(knackId, summary),
      recalled('distractor_1', 'Unrelated packaging note'),
      recalled('distractor_2', 'Unrelated documentation note'),
    ].slice(0, RECALL_LIMITS.standard.knacks);
    const context = new ContextBuilder().build({
      workingMemory: workingMemory({ taskId, runId: `run_${taskId}` }),
      recallBundle: bundle(injected),
      tier: 'standard',
      runMode: 'eval',
    });
    const knackSection = context.sections.find((section) => section.name === 'knacks');
    expect(RECALL_LIMITS.standard.knacks).toBe(3);
    expect(knackSection?.content).toContain(`[recall:${knackId}]`);

    const citation = buildRecallCitationAudit({
      messages: [`Applying the recalled fix. [[used_recall:${knackId}]]`],
      contexts: [{ items: injected.map((item) => ({ id: item.id, kind: item.kind })) }],
    });
    expect(citation.cleanedMessages[0]).not.toContain('used_recall');
    expect(citation.audit.used_recall_ids).toEqual([knackId]);

    const pending = await reconcileRecallCredit({
      memoryDir,
      taskId,
      runId: `run_${taskId}`,
      audit: citation.audit,
      verificationStatus: 'pending',
      verificationRef: `harness:${taskId}`,
    });
    expect(pending.creditedIds).toEqual([]);

    const passed = await reconcileRecallCredit({
      memoryDir,
      taskId,
      runId: `run_${taskId}`,
      audit: citation.audit,
      verificationStatus: 'passed',
      verificationRef: `harness:${taskId}`,
    });
    const repeated = await reconcileRecallCredit({
      memoryDir,
      taskId,
      runId: `run_${taskId}`,
      audit: citation.audit,
      verificationStatus: 'passed',
      verificationRef: `harness:${taskId}`,
    });
    expect(passed.creditedIds).toEqual([knackId]);
    expect(repeated.duplicateIds).toEqual([knackId]);
    const stored = JSON.parse((await readFile(join(memoryDir, 'knacks.jsonl'), 'utf8')).trim());
    expect(stored).toMatchObject({ reuseCount: 1, lastSucceededTask: taskId });
  });
});

function recalled(id: string, summary: string): RecalledItem {
  return {
    id,
    kind: 'knack',
    summary,
    reason: 'fixture',
    score: {
      dimensions: { trigger: 0, keyword: 0, recency: 0, relevance: 1, metadata: 1, evidence: 1 },
      trigger: 0,
      keyword: 0,
      metadata: 1,
      vector: 0,
      total: 1,
    },
  };
}

function bundle(knacks: RecalledItem[]): RecallBundle {
  return {
    knacks,
    preferences: [],
    docFindings: [],
    historicalTaskSnapshots: [],
    artifactRefs: [],
    runArchiveRefs: [],
    diagnostics: { queryText: '', triggerUsed: {}, totalCandidates: 3, dropped: [], penalties: [] },
  };
}
