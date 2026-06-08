import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WriteQueue } from '../../../core/write-queue.js';
import { TaskLedgerManager } from '../task-ledger-manager.js';
import type { TaskLedger } from '../task-ledger.js';

describe('TaskLedgerManager', () => {
  let memoryDir: string;
  let manager: TaskLedgerManager;

  beforeEach(async () => {
    memoryDir = await mkdtemp(join(tmpdir(), 'task-ledger-test-'));
    WriteQueue.resetInstance();
    manager = new TaskLedgerManager(memoryDir, 'task_1');
  });

  afterEach(async () => {
    WriteQueue.resetInstance();
    await rm(memoryDir, { recursive: true, force: true });
  });

  it('loads an empty ledger when the file does not exist and can save/load it', async () => {
    const empty = await manager.load();

    expect(empty).toMatchObject({
      taskId: 'task_1',
      facts: [],
      rejections: [],
      questions: [],
    });
    expect(empty.updatedAt).toEqual(expect.any(String));

    const ledger: TaskLedger = {
      ...empty,
      facts: [{
        id: 'fact_manual',
        content: 'User confirmed npm is used',
        source: 'user',
        confidence: 'confirmed',
        addedAt: '2026-01-01T00:00:00.000Z',
      }],
    };
    await manager.save(ledger);

    const raw = await readFile(join(memoryDir, 'tasks', 'task_1', 'ledger.json'), 'utf-8');
    expect(JSON.parse(raw)).toMatchObject({ taskId: 'task_1' });
    expect(await manager.load()).toEqual(ledger);
  });

  it('adds facts with generated id, addedAt, and persistence', async () => {
    const fact = await manager.addFact({
      content: 'Use the existing recall module naming',
      source: 'inference',
      confidence: 'tentative',
    });

    expect(fact.id).toMatch(/^fact_/);
    expect(fact.addedAt).toEqual(expect.any(String));
    await expect(manager.addFact({
      content: '   ',
      source: 'user',
      confidence: 'confirmed',
    })).rejects.toThrow('Fact content must not be empty');
    expect((await manager.load()).facts).toEqual([fact]);
  });

  it('adds rejections with strict hard-rejection source rules', async () => {
    const soft = await manager.addRejection({
      assumption: 'The user wants the old strategy-gene name',
      reason: 'Current codebase uses knacks',
      source: 'tool_error',
      severity: 'soft',
    });

    expect(soft.id).toMatch(/^rej_/);
    expect(soft.addedAt).toEqual(expect.any(String));
    await expect(manager.addRejection({
      assumption: '',
      reason: 'reason',
      source: 'explicit',
      severity: 'hard',
    })).rejects.toThrow('Rejection assumption must not be empty');
    await expect(manager.addRejection({
      assumption: 'bad',
      reason: ' ',
      source: 'explicit',
      severity: 'hard',
    })).rejects.toThrow('Rejection reason must not be empty');
    await expect(manager.addRejection({
      assumption: 'tool error means hard rejection',
      reason: 'tool only',
      source: 'tool_error',
      severity: 'hard',
    })).rejects.toThrow('Hard rejection requires user correction or explicit source');
  });

  it('removes rejections without physical deletion', async () => {
    const rejection = await manager.addRejection({
      assumption: 'Blindly retry stale edits',
      reason: 'User rejected blind retries',
      source: 'user_correction',
      severity: 'hard',
    });

    expect(await manager.removeRejection('missing', 'user_explicit')).toBe(false);
    expect(await manager.removeRejection(rejection.id, 'user_explicit')).toBe(true);
    expect(await manager.removeRejection(rejection.id, 'user_explicit')).toBe(false);

    const ledger = await manager.load();
    expect(ledger.rejections).toHaveLength(1);
    expect(ledger.rejections[0].removedAt).toEqual(expect.any(String));
    expect(ledger.rejections[0].removalSource).toBe('user_explicit');
    expect(await manager.getActiveRejections()).toEqual([]);
  });

  it('adds and resolves questions', async () => {
    const question = await manager.addQuestion({
      question: 'Should we add UI tests?',
      context: 'Frontend behavior changed',
    });

    expect(question.id).toMatch(/^q_/);
    expect(question.status).toBe('open');
    expect(await manager.getOpenQuestions()).toEqual([question]);
    await expect(manager.addQuestion({ question: '', context: 'x' }))
      .rejects.toThrow('Question must not be empty');
    await expect(manager.addQuestion({ question: 'x', context: ' ' }))
      .rejects.toThrow('Question context must not be empty');
    await expect(manager.resolveQuestion(question.id, ' '))
      .rejects.toThrow('Question resolution must not be empty');

    expect(await manager.resolveQuestion('missing', 'No')).toBe(false);
    expect(await manager.resolveQuestion(question.id, 'Yes, add focused tests')).toBe(true);
    expect(await manager.resolveQuestion(question.id, 'Again')).toBe(false);
    expect(await manager.getOpenQuestions()).toEqual([]);
    expect((await manager.load()).questions[0]).toMatchObject({
      status: 'resolved',
      resolution: 'Yes, add focused tests',
      resolvedAt: expect.any(String),
    });
  });

  it('converts to lightweight ledger input with active rejections and open questions only', async () => {
    expect(await manager.toLedgerInput()).toEqual({
      confirmedFacts: [],
      rejectedAssumptions: [],
      openQuestions: [],
    });
    const fact = await manager.addFact({
      content: 'Fact',
      source: 'user',
      confidence: 'confirmed',
    });
    const active = await manager.addRejection({
      assumption: 'Active rejection',
      reason: 'Still valid',
      source: 'explicit',
      severity: 'hard',
    });
    const removed = await manager.addRejection({
      assumption: 'Removed rejection',
      reason: 'No longer valid',
      source: 'explicit',
      severity: 'soft',
    });
    await manager.removeRejection(removed.id, 'user_explicit');
    const open = await manager.addQuestion({
      question: 'Open?',
      context: 'Need answer',
    });
    const resolved = await manager.addQuestion({
      question: 'Resolved?',
      context: 'Already answered',
    });
    await manager.resolveQuestion(resolved.id, 'Done');

    expect(await manager.toLedgerInput()).toEqual({
      confirmedFacts: [fact],
      rejectedAssumptions: [active],
      openQuestions: [open],
    });
  });
});
