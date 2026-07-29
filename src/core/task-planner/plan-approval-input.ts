import type { Task } from '../../memory/tasks/types.js';
import {
  createPlanSnapshot,
  detectPlanRevisionIntent,
  type DetectedPlanRevision,
  type PlanSnapshot,
} from './plan-revision-detector.js';

export type PlanApprovalInputDecision =
  | { type: 'approve' }
  | { type: 'revise'; revision: DetectedPlanRevision };

export function classifyPlanApprovalInput(
  input: string,
  activeTask: Task | null,
  snapshot: PlanSnapshot | null,
): PlanApprovalInputDecision | null {
  if (!input.trim()) return null;
  if (!activeTask || activeTask.workflow_status !== 'awaiting_plan_approval') return null;
  const effectiveSnapshot = snapshot?.taskId === activeTask.id
    ? snapshot
    : createPlanSnapshot(activeTask);

  const revision = detectPlanRevisionIntent(input, activeTask, effectiveSnapshot);
  if (revision) return { type: 'revise', revision };

  return { type: 'approve' };
}
