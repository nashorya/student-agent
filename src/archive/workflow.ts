import { createHash } from 'node:crypto';
import { detectNaturalReviewResponse } from '../core/task-planner/review-detector.js';
import type { TasksManager } from '../memory/tasks/manager.js';
import type { Task } from '../memory/tasks/types.js';
import type { ArchiveEvidence } from './types.js';
import { ArchiveService, type ArchiveApplyResult } from './service.js';

export class ArchiveWorkflowCoordinator {
  constructor(private readonly service: ArchiveService, private readonly tasks: TasksManager) {}

  async applyAfterVerification(task: Task): Promise<ArchiveApplyResult | undefined> {
    const evidence = task.verification_results.filter((item) => item.status === 'passed').map(toArchiveEvidence);
    const pending = (await this.service.pending(task.id)).filter((item) => item.status === 'pending');
    if (pending.length === 0) return undefined;
    const result = await this.service.applyPending(task.id, evidence);
    const waiting = result.adrs.find((adr) => adr.implementationStatus === 'verified' && adr.decisionStatus === 'proposed');
    if (waiting) {
      const evidenceRef = evidence[0]?.id ?? `task:${task.id}:verification`;
      await this.tasks.setPendingArchiveAcceptance(task.id, { adrId: waiting.id, requestedAt: new Date().toISOString(), evidenceRef });
    }
    return result;
  }

  async handleUserReview(task: Task, response: string): Promise<'accepted' | 'revision_requested' | 'ambiguous'> {
    const signal = detectNaturalReviewResponse(response);
    const pending = task.pending_archive_acceptance;
    if (!pending || signal.type === 'ambiguous') return 'ambiguous';
    if (signal.type === 'revision_requested') return 'revision_requested';
    const reviewRef = `user-review:${createHash('sha256').update(`${task.id}:${response}`).digest('hex').slice(0, 16)}`;
    await this.service.acceptAdr(pending.adrId, reviewRef);
    await this.tasks.clearPendingArchiveAcceptance(task.id);
    return 'accepted';
  }
}

function toArchiveEvidence(item: Task['verification_results'][number], index: number): ArchiveEvidence {
  return { id: `verification:${item.kind}:${index + 1}`, kind: 'verification', status: item.status === 'passed' ? 'passed' : item.status === 'failed' ? 'failed' : 'recorded', summary: item.summary };
}
