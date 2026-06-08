import type { FreezeCheckResult, SchemaSnapshot } from './types.js';

export function captureCurrentSchemas(): SchemaSnapshot {
  return {
    version: 'v0.4-integration-freeze',
    capturedAt: new Date().toISOString(),
    schemas: {
      runEvent: ['timestamp', 'kind', 'summary', 'toolName', 'path', 'metadata'],
      taskOutcome: [
        'taskId',
        'runId',
        'status',
        'userAccepted',
        'userCorrectionCount',
        'toolErrorCount',
        'hashlineRejectionCount',
        'hashlineRecoveryCount',
        'repeatedToolCallCount',
        'lostnessTriggerCount',
        'finalSummary',
        'evidenceRefs',
        'createdAt',
      ],
      harnessChange: [
        'id',
        'targetComponent',
        'rationale',
        'prediction',
        'regressionRisk',
        'expectedMetrics',
        'risk',
        'runRef',
        'traceRefs',
        'evalBefore',
        'evalAfter',
        'status',
        'createdAt',
        'verifiedAt',
      ],
      recallQuery: ['text', 'trigger', 'metadata', 'limit', 'includeVectorSearch'],
      contextSection: ['name', 'priority', 'content', 'estimatedTokens'],
      signal: [
        'id',
        'kind',
        'severity',
        'summary',
        'toolName',
        'toolCallId',
        'path',
        'ruleName',
        'pattern',
        'recoveryHint',
        'provenance',
        'evidenceRef',
        'createdAt',
      ],
    },
  };
}

export function checkFreeze(
  baseline: SchemaSnapshot,
  current: SchemaSnapshot,
): FreezeCheckResult {
  const breakingChanges = Object.keys(baseline.schemas).flatMap((schemaName) => {
    const schema = schemaName as keyof SchemaSnapshot['schemas'];
    const baselineFields = baseline.schemas[schema];
    const currentFields = current.schemas[schema] ?? [];
    const missing = baselineFields.filter((field) => !currentFields.includes(field));
    const added = currentFields.filter((field) => !baselineFields.includes(field));
    return missing.length > 0 ? [{ schema, missing, added }] : [];
  });
  return {
    passed: breakingChanges.length === 0,
    breakingChanges,
  };
}
