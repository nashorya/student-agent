export type SignalKind =
  | 'tool_error'
  | 'toolguard_block'
  | 'fileguard_block'
  | 'hashline_rejection'
  | 'hashline_recovery'
  | 'user_correction'
  | 'turn_intake_degraded'
  | 'lostness_hard'
  | 'lostness_soft';

export type SignalSeverity = 'low' | 'medium' | 'high';

export interface Signal {
  id: string;
  kind: SignalKind;
  severity: SignalSeverity;
  summary: string;
  toolName?: string;
  toolCallId?: string;
  path?: string;
  ruleName?: string;
  pattern?: string;
  recoveryHint?: string;
  provenance?: unknown;
  evidenceRef?: string;
  createdAt: string;
}
