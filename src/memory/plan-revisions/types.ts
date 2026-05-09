export type PlanRevisionDiffType =
  | 'priority_change'
  | 'scope_reduction'
  | 'scope_expansion'
  | 'risk_tolerance_change'
  | 'sequencing_change'
  | 'acceptance_criteria_change'
  | 'implementation_strategy_change';

export type PlanRevisionTrustStatus =
  | 'unverified'
  | 'reobserved'
  | 'user_confirmed'
  | 'contested';

export type PlanRevisionOutcome = 'accepted' | 'observed';

export interface PlanRevisionProvenance {
  source_type: 'automatic-detection' | 'explicit-command';
  task_id: string;
  session_ref: string;
  trust_status: PlanRevisionTrustStatus;
}

export interface PlanRevision {
  id: string;
  task_id: string;
  session_ref: string;
  created_at: string;
  last_observed: string;
  observations: number;
  agent_plan_summary: string;
  user_revision_summary: string;
  diff_type: PlanRevisionDiffType;
  reason_inferred: string;
  outcome: PlanRevisionOutcome;
  trust_status: PlanRevisionTrustStatus;
  provenance: PlanRevisionProvenance[];
}

export interface PlanRevisionsFile {
  revisions: PlanRevision[];
}

export interface PlanRevisionAppendInput {
  taskId: string;
  sessionRef: string;
  agentPlanSummary: string;
  userRevisionSummary: string;
  diffType: PlanRevisionDiffType;
  reasonInferred: string;
  outcome: PlanRevisionOutcome;
  trustStatus: PlanRevisionTrustStatus;
  sourceType: PlanRevisionProvenance['source_type'];
}
