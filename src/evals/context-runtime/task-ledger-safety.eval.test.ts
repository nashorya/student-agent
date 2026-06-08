import { describe, expect, it, vi } from 'vitest';
import { ContextBuilder } from '../../memory/recall/context-builder.js';
import { RecallRouter } from '../../memory/recall/recall-router.js';
import { workingMemory } from './fixtures/working-memory.js';
import { removedRejection, resolvedQuestion, taskLedger } from './fixtures/task-ledger.js';
import { memoryResult, recallBundle, recallItem } from './fixtures/recall-items.js';
import { recallRouterInput } from './fixtures/recall-query.js';

describe('Context Runtime Eval: Task Ledger safety', () => {
  it('renders active task ledger facts, rejections, and questions with safety language', () => {
    const built = new ContextBuilder().build({
      workingMemory: workingMemory(),
      recallBundle: recallBundle(),
      taskLedger: taskLedger({
        rejectedAssumptions: [...taskLedger().rejectedAssumptions, removedRejection],
        openQuestions: [...taskLedger().openQuestions, resolvedQuestion],
      }),
      tier: 'standard',
    });
    const section = built.sections.find((item) => item.name === 'taskLedger');

    expect(section?.content).toContain('Confirmed fact survives into L1');
    expect(section?.content).toContain('Tentative fact is labeled tentative');
    expect(section?.content).toContain('DO NOT revisit');
    expect(section?.content).toContain('[HARD] Blind retry stale edits');
    expect(section?.content).toContain('[soft] Generated docs are authoritative');
    expect(section?.content).not.toContain('Removed rejection should not affect recall');
    expect(section?.content).not.toContain('Resolved question should not render');
  });

  it('penalizes active rejected assumptions and ignores removed rejections', async () => {
    const router = new RecallRouter({
      search: vi.fn().mockResolvedValue([
        memoryResult(recallItem({
          id: 'active_overlap',
          summary: 'Blind retry stale edits after rejection',
        }), 1, { keyword: 1 }),
        memoryResult(recallItem({
          id: 'removed_overlap',
          summary: 'Removed rejection should not affect recall',
        }), 1, { keyword: 1 }),
      ]),
    });

    const bundle = await router.recall(recallRouterInput({
      taskLedger: taskLedger({
        rejectedAssumptions: [...taskLedger().rejectedAssumptions, removedRejection],
      }),
    }));

    expect(bundle.knacks.find((item) => item.id === 'active_overlap')?.score.total).toBe(0.3);
    expect(bundle.knacks.find((item) => item.id === 'removed_overlap')?.score.total).toBe(1);
    expect(bundle.diagnostics.penalties.map((penalty) => penalty.id)).toEqual(['active_overlap']);
  });
});
