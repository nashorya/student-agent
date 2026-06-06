export type StudentAgentProvider = string;
export type StudentAgentExecutionMode = 'safe' | 'yolo';

export interface StudentAgentConfig {
  envFile: string;
  executionMode: StudentAgentExecutionMode;
  model: {
    provider: StudentAgentProvider;
    name: string;
    baseUrl?: string;
    api?: string;
  };
  llm: {
    requestTimeoutMs: number;
    maxOutputTokens?: number;
    maxRetries?: number;
    maxRetryDelayMs?: number;
  };
  features: {
    context7: boolean;
    playwright: boolean;
    boundedBreaker: boolean;
    qualityWatchdog: boolean;
    subAgents: boolean;
    riskGuard: boolean;
  };
  context7: {
    apiKey?: string;
    timeoutMs: number;
    maxDocsChars: number;
  };
  setup: {
    suppressEmbeddingReminder: boolean;
  };
  fileGuard: {
    planningMaxReads: number;
    normalMaxReads: number;
    readWindow: number;
  };
  playwright: {
    useStorageState: boolean;
    storageStatePath?: string;
    navigationTimeoutMs: number;
    renderWaitMs: number;
    maxChars: number;
  };
  subAgents: {
    maxConcurrency: number;
  };
}

export interface StudentAgentModelInput {
  provider?: StudentAgentProvider;
  name?: string;
  baseUrl?: string;
  api?: string;
}

export type StudentAgentConfigInput = Partial<{
  envFile: string;
  executionMode: StudentAgentExecutionMode;
  model: StudentAgentModelInput;
  llm: Partial<StudentAgentConfig['llm']>;
  features: Partial<StudentAgentConfig['features']>;
  context7: Partial<StudentAgentConfig['context7']>;
  setup: Partial<StudentAgentConfig['setup']>;
  fileGuard: Partial<StudentAgentConfig['fileGuard']>;
  playwright: Partial<StudentAgentConfig['playwright']>;
  subAgents: Partial<StudentAgentConfig['subAgents']>;
}>;

export const DEFAULT_STUDENT_AGENT_CONFIG: StudentAgentConfig = {
  envFile: '.env',
  executionMode: 'yolo',
  model: {
    provider: 'anthropic',
    name: 'claude-sonnet-4-6',
  },
  llm: {
    requestTimeoutMs: 300_000,
  },
  features: {
    context7: true,
    playwright: true,
    boundedBreaker: true,
    qualityWatchdog: true,
    subAgents: false,
    riskGuard: true,
  },
  context7: {
    timeoutMs: 10_000,
    maxDocsChars: 6_000,
  },
  setup: {
    suppressEmbeddingReminder: false,
  },
  fileGuard: {
    planningMaxReads: 3,
    normalMaxReads: 15,
    readWindow: 30,
  },
  playwright: {
    useStorageState: false,
    navigationTimeoutMs: 10_000,
    renderWaitMs: 2_000,
    maxChars: 5_000,
  },
  subAgents: {
    maxConcurrency: 3,
  },
};
