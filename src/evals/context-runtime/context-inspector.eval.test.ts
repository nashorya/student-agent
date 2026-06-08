import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WriteQueue } from '../../core/write-queue.js';
import { formatContextInspection, inspectContext } from '../../extension/commands/context-inspector.js';
import { TaskLedgerManager } from '../../memory/tasks/task-ledger-manager.js';
import { TasksManager } from '../../memory/tasks/manager.js';
import { FIXED_NOW } from './fixtures/working-memory.js';

describe('Context Runtime Eval: Context Inspector', () => {
  let memoryDir: string;

  beforeEach(async () => {
    memoryDir = await mkdtemp(join(tmpdir(), 'context-runtime-inspector-'));
    TasksManager.resetInstance();
    WriteQueue.resetInstance();
  });

  afterEach(async () => {
    TasksManager.resetInstance();
    WriteQueue.resetInstance();
    await rm(memoryDir, { recursive: true, force: true });
  });

  it('returns safe empty diagnostics without an active task', async () => {
    const result = await inspectContext(memoryDir);

    expect(result.tier).toBe('minimal');
    expect(result.workingMemory.taskId).toBeNull();
    expect(result.ledger.factCount).toBe(0);
    expect(result.recall.strategyGenes.count).toBe(0);
    expect(result.topItem).toBeNull();
    expect(formatContextInspection(result)).toContain('Top item: none');
    expect(formatContextInspection(result)).toContain('Task: none');
  });

  it('inspects active working memory, task ledger, recall counts, scoring dimensions, and diagnostics', async () => {
    const task = await TasksManager.getInstance(memoryDir).createTask('Inspector eval', ['Inspect'], {
      workflowStatus: 'executing',
      workingMemory: {
        goal: 'Inspect Context Runtime',
        phase: 'executing',
        currentStep: 'Build inspector output',
        recentErrors: [{ id: 'err_1', source: 'tool', pattern: 'edit_failed', summary: 'Edit failed', createdAt: FIXED_NOW }],
        recentSignals: [{ id: 'sig_1', kind: 'hashline_rejection', summary: 'Stale edit', severity: 'high', createdAt: FIXED_NOW }],
      },
    });
    const ledger = new TaskLedgerManager(memoryDir, task.id);
    await ledger.addFact({ content: 'Inspector fact', source: 'user', confidence: 'confirmed' });
    await ledger.addRejection({ assumption: 'Bad inspector assumption', reason: 'Rejected', source: 'explicit', severity: 'hard' });
    await ledger.addQuestion({ question: 'Open inspector question?', context: 'Eval' });
    await appendFile(join(memoryDir, 'knacks.jsonl'), JSON.stringify({
      id: 'knack_inspector_eval',
      lessonCandidateId: 'lesson_eval',
      status: 'candidate',
      summary: 'Inspect Context Runtime with recall scoring dimensions',
      trigger: { signalKinds: ['hashline_rejection'] },
      recall: {
        trigger: { signalKinds: ['hashline_rejection'] },
        applicableWhen: ['Inspect Context Runtime'],
        doNotApplyWhen: [],
        tags: ['context'],
      },
      evidenceRefs: ['sig_1'],
      counterexamples: [],
      allowPromptInjection: true,
      writesHardToolRule: false,
      breakerReport: null,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    }) + '\n', 'utf-8');

    const result = await inspectContext(memoryDir);
    const output = formatContextInspection(result);

    expect(result.workingMemory.recentErrorCount).toBe(1);
    expect(result.workingMemory.recentSignalCount).toBe(1);
    expect(result.ledger).toMatchObject({
      factCount: 1,
      rejectionCount: 1,
      hardRejectionCount: 1,
      openQuestionCount: 1,
    });
    expect(result.recall.strategyGenes.count).toBe(1);
    expect(result.topItem?.dimensions).toEqual(expect.objectContaining({
      trigger: expect.any(Number),
      keyword: expect.any(Number),
      recency: expect.any(Number),
      relevance: expect.any(Number),
      metadata: expect.any(Number),
      evidence: expect.any(Number),
    }));
    expect(result.diagnostics).toEqual(expect.objectContaining({
      queryText: expect.any(String),
      triggerSummary: expect.any(String),
      totalCandidates: expect.any(Number),
      droppedCount: expect.any(Number),
      estimatedTokens: expect.any(Number),
      truncatedSections: expect.any(Array),
    }));
    expect(output).toContain('=== Context Inspector ===');
    expect(output).toContain('[L1 Tier]');
    expect(output).toContain('[L2 Working Memory]');
    expect(output).toContain('[L2 Task Ledger]');
    expect(output).toContain('[L3 Recall Results]');
    expect(output).toContain('[L3 Scoring]');
    expect(output).toContain('[Diagnostics]');
  });
});
