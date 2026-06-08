export type HarnessChangeStatus = 'proposed' | 'applied' | 'verified' | 'reverted';

export interface HarnessChange {
  id: string;
  targetComponent: string;
  rationale: string;
  prediction: string;
  regressionRisk: string[];
  expectedMetrics: Record<string, string>;
  risk: string;
  runRef: string;
  traceRefs: string[];
  evalBefore?: Record<string, number>;
  evalAfter?: Record<string, number>;
  status: HarnessChangeStatus;
  createdAt: string;
  verifiedAt?: string;
}

export interface CreateHarnessChangeInput {
  targetComponent: string;
  rationale: string;
  prediction: string;
  regressionRisk: string[];
  expectedMetrics: Record<string, string>;
  risk: string;
  runRef: string;
  traceRefs?: string[];
  evalBefore?: Record<string, number>;
}
