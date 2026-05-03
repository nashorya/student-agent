export type TrustStatus = 'user-confirmed' | 'pending' | 'stale';
export type SourceType = 'user-confirmed' | 'machine-inferred';
export type QuestionStatus = 'unverified' | 'resolved' | 'stale';

export interface Provenance {
  source_type: SourceType;
  task_id: string;
  session_ref: string;
  trust_status: TrustStatus;
}

export interface AttemptEntry {
  strategy: string;
  result: '失败' | '成功' | '跳过';
  reason?: string;
}

export interface Question {
  id: string;
  error_type: string;
  error_subtype: string;
  context: string;
  stack_trace?: string;
  attempts: AttemptEntry[];
  resolution?: string;
  resolved_at?: string;
  status: QuestionStatus;
  hit_count: number;
  last_hit: string;
  provenance: Provenance;
}

export interface QuestionsFile {
  questions: Question[];
}
