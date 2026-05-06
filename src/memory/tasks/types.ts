export type PhaseStatus = 'in_progress' | 'completed';
export type TaskStatus = 'active' | 'completed';

export interface TaskPhase {
  id: string;
  description: string;
  status: PhaseStatus;
  retry_count: number;
  feedbacks: string[];
  created_at: string;
  completed_at?: string;
}

export interface Task {
  id: string;
  name: string;
  active_phase_index: number;
  phases: TaskPhase[];
  status: TaskStatus;
  created_at: string;
}

export interface TasksFile {
  active_task_id: string | null;
  tasks: Task[];
}
