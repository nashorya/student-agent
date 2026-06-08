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

export type WorkingMemoryPhase = 'planning' | 'executing' | 'verifying' | 'reflecting';
export type WorkingMemoryTodoStatus = 'pending' | 'in_progress' | 'done' | 'blocked';
export type WorkingMemoryWriteTool = 'hashline_edit' | 'write_file' | 'format' | 'other';
export type WorkingMemoryErrorSource = 'tool' | 'toolguard' | 'hashline' | 'fileguard' | 'runtime';
export type WorkingMemorySignalSeverity = 'low' | 'medium' | 'high';

export interface TaskWorkingMemoryTodo {
  id: string;
  content: string;
  status: WorkingMemoryTodoStatus;
  evidenceRefs?: string[];
  updatedAt: string;
}

export interface TaskWorkingMemoryReadRange {
  startLine: number;
  endLine: number;
  summary: string;
  hashlineTag?: string;
  readAt: string;
}

export interface TaskWorkingMemoryReadFile {
  path: string;
  ranges: TaskWorkingMemoryReadRange[];
  lastReadAt: string;
  lastKnownHash?: string;
}

export interface TaskWorkingMemoryWriteFile {
  path: string;
  tool: WorkingMemoryWriteTool;
  summary: string;
  checkpointId?: string;
  writtenAt: string;
}

export interface TaskWorkingMemoryRecentError {
  id: string;
  source: WorkingMemoryErrorSource;
  pattern: string;
  summary: string;
  recoveryHint?: string;
  evidenceRef?: string;
  createdAt: string;
}

export interface TaskWorkingMemoryRecentSignal {
  id: string;
  kind: string;
  summary: string;
  severity: WorkingMemorySignalSeverity;
  evidenceRef?: string;
  createdAt: string;
}

export interface TaskWorkingMemoryArtifactRef {
  id: string;
  kind: string;
  summary: string;
}

export interface TaskWorkingMemory {
  taskId: string;
  runId: string;
  goal: string;
  phase: WorkingMemoryPhase;
  currentStep: string;
  todos: TaskWorkingMemoryTodo[];
  readFiles: TaskWorkingMemoryReadFile[];
  writeFiles: TaskWorkingMemoryWriteFile[];
  recentErrors: TaskWorkingMemoryRecentError[];
  recentSignals: TaskWorkingMemoryRecentSignal[];
  artifactRefs: TaskWorkingMemoryArtifactRef[];
  updatedAt: string;
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
  workingMemory?: Partial<TaskWorkingMemory> | Record<string, unknown>;
  requiresUserAcceptance?: boolean;
  requiresVisualReview?: boolean;
}
