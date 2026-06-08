export interface SchemaSnapshot {
  version: string;
  capturedAt: string;
  schemas: {
    runEvent: string[];
    taskOutcome: string[];
    harnessChange: string[];
    recallQuery: string[];
    contextSection: string[];
    signal: string[];
  };
}

export interface FreezeCheckResult {
  passed: boolean;
  breakingChanges: Array<{
    schema: string;
    missing: string[];
    added: string[];
  }>;
}

export interface SmokeTestResult {
  passed: boolean;
  components: Array<{
    name: string;
    status: 'ok' | 'error';
    error?: string;
  }>;
}
