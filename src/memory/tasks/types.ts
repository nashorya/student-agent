export type PhaseStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped';
export type TaskStatus = 'active' | 'completed' | 'cancelled' | 'failed';
export type TaskLevel = 0 | 1 | 2 | 3 | 4;
export type TaskWorkflowStatus =
  | 'intake'
  | 'clarifying'
  | 'planning'
  | 'awaiting_plan_approval'
  | 'executing'
  | 'retrying'
  | 'blocked'
  | 'needs_replan'
  | 'failed'
  | 'technical_verification'
  | 'visual_review'
  | 'user_review'
  | 'revision_requested'
  | 'clarify_feedback'
  | 'revise'
  | 'accepted'
  | 'completed'
  | 'cancelled';

export interface TaskWorkingMemory {
  goal: string;
  acceptance_criteria: string[];
  constraints: string[];
  user_preferences: string[];
  project_facts: string[];
  open_questions: string[];
  decisions: string[];
  design_feedback: string[];
  verification_results: string[];
  changed_files: string[];
}

export type TaskVerificationStatus = 'passed' | 'failed' | 'skipped' | 'unknown';

export interface TaskVerificationResult {
  kind: string;
  status: TaskVerificationStatus;
  summary: string;
  command?: string;
  details?: string;
  created_at: string;
}

export interface TaskPhase {
  id: string;
  description: string;
  status: PhaseStatus;
  retry_count: number;
  feedbacks: string[];
  created_at: string;
  completed_at?: string;
  blocked_reason?: string;
}

export interface Task {
  id: string;
  name: string;
  active_phase_index: number;
  phases: TaskPhase[];
  status: TaskStatus;
  workflow_status: TaskWorkflowStatus;
  level: TaskLevel;
  working_memory: TaskWorkingMemory;
  requires_user_acceptance: boolean;
  requires_visual_review: boolean;
  verification_results: TaskVerificationResult[];
  created_at: string;
  completed_at?: string;
  accepted_at?: string;
}

export interface TasksFile {
  active_task_id: string | null;
  tasks: Task[];
}

export interface CreateTaskOptions {
  level?: TaskLevel;
  workflowStatus?: TaskWorkflowStatus;
  workingMemory?: Partial<TaskWorkingMemory>;
  requiresUserAcceptance?: boolean;
  requiresVisualReview?: boolean;
}
