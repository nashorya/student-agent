export interface LedgerFact {
  id: string;
  content: string;
  source: 'user' | 'tool_result' | 'inference';
  confidence: 'confirmed' | 'tentative';
  addedAt: string;
}

export interface LedgerRejection {
  id: string;
  assumption: string;
  reason: string;
  source: 'user_correction' | 'tool_error' | 'explicit';
  severity: 'hard' | 'soft';
  addedAt: string;
  removedAt?: string;
  removalSource?: 'user_explicit';
}

export interface LedgerQuestion {
  id: string;
  question: string;
  context: string;
  status: 'open' | 'resolved';
  resolution?: string;
  addedAt: string;
  resolvedAt?: string;
}

export interface TaskLedger {
  taskId: string;
  facts: LedgerFact[];
  rejections: LedgerRejection[];
  questions: LedgerQuestion[];
  updatedAt: string;
}

export interface TaskLedgerInput {
  confirmedFacts: LedgerFact[];
  rejectedAssumptions: LedgerRejection[];
  openQuestions: LedgerQuestion[];
}
