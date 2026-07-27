import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BoundedBreaker } from '../../../reflect/bounded-breaker.js';
import { KnacksManager } from '../manager.js';
import type { LessonCandidate } from '../../lessons/types.js';

function makeLesson(overrides: Partial<LessonCandidate> = {}): LessonCandidate {
  return {
    id: 'lesson_1',
    sourceSignalId: 'sig_1',
    lesson: 'Re-read files after hashline stale rejection before retrying edits',
    trigger: {
      signalKinds: ['hashline_rejection'],
      paths: ['src/App.tsx'],
    },
    applicableWhen: ['Editing a file after a stale hashline rejection'],
    doNotApplyWhen: ['No file edit is being retried'],
    evidenceRefs: ['hash123'],
    severity: 'high',
    quality: 'high',
    status: 'observed',
    provenance: {
      taskId: 'task_1',
      sessionRef: 'session_1',
      signalId: 'sig_1',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('KnacksManager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'knacks-test-'));
  });

  afterEach(async () => {
    KnacksManager.resetInstance();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('promotes a lesson candidate into a candidate knack using BoundedBreaker', async () => {
    const mgr = KnacksManager.getInstance(tmpDir);
    const breaker = new BoundedBreaker({
      reviewer: {
        review: async () => ({
          confidenceLevel: 'high',
          knownFailureContext: [],
          unknownRiskZones: [],
        }),
      },
    });

    const knack = await mgr.promoteLessonCandidate(makeLesson(), { breaker, totalTaskCount: 50 });

    expect(knack).toMatchObject({
      lessonCandidateId: 'lesson_1',
      status: 'candidate',
      trigger: {
        signalKinds: ['hashline_rejection'],
        paths: ['src/App.tsx'],
      },
      recall: {
        applicableWhen: ['Editing a file after a stale hashline rejection'],
        doNotApplyWhen: ['No file edit is being retried'],
      },
      allowPromptInjection: true,
      writesHardToolRule: false,
    });
    expect(knack.id.startsWith('knack_')).toBe(true);
    expect(knack.breakerReport?.confidence_level).toBe('high');
    expect(await mgr.getAll()).toHaveLength(1);
    expect(await readFile(join(tmpDir, 'knacks.jsonl'), 'utf-8')).toContain('knack_');
  });

  it('carries schema-v1 ranking fields from the lesson', async () => {
    const mgr = KnacksManager.getInstance(tmpDir);
    const knack = await mgr.promoteLessonCandidate(makeLesson({
      repo: 'astropy/astropy',
      symptom: 'Nested CompoundModel fills `right` with 1 instead of the real matrix',
      fixSummary: 'copy the actual matrix values into `cright`',
      executionEvidence: 'edit astropy/modeling/separable.py cright = right',
      confidence: 'verified',
      promotedAt: '2026-01-03T00:00:00.000Z',
    }), { breaker: new BoundedBreaker(), totalTaskCount: 50 });

    expect(knack).toMatchObject({
      repo: 'astropy/astropy',
      fixSummary: 'copy the actual matrix values into `cright`',
      verification: 'verifier reward=1',
    });
    expect(knack.executionEvidence).toContain('separable.py');
  });

  it('blocks prompt injection when a high-severity counterexample exists', async () => {
    const mgr = KnacksManager.getInstance(tmpDir);
    const knack = await mgr.promoteLessonCandidate(makeLesson({
      counterexamples: [{
        id: 'counter_1',
        severity: 'high',
        summary: 'Do not re-read generated binary files',
        createdAt: '2026-01-02T00:00:00.000Z',
      }],
    }), {
      breaker: new BoundedBreaker(),
      totalTaskCount: 50,
    });

    expect(knack.allowPromptInjection).toBe(false);
    expect(await mgr.getPromptInjectableKnacks()).toEqual([]);
  });
});
