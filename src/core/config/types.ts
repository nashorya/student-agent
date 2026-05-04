export interface StudentAgentConfig {
  envFile: string;
  model: {
    provider: 'anthropic';
    name: string;
    baseUrl?: string;
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
  };
  context7: {
    apiKey?: string;
    timeoutMs: number;
    maxDocsChars: number;
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
  provider?: 'anthropic';
  name?: string;
  baseUrl?: string;
}

export type StudentAgentConfigInput = Partial<{
  envFile: string;
  model: StudentAgentModelInput;
  llm: Partial<StudentAgentConfig['llm']>;
  features: Partial<StudentAgentConfig['features']>;
  context7: Partial<StudentAgentConfig['context7']>;
  playwright: Partial<StudentAgentConfig['playwright']>;
  subAgents: Partial<StudentAgentConfig['subAgents']>;
}>;

export const DEFAULT_STUDENT_AGENT_CONFIG: StudentAgentConfig = {
  envFile: '.env',
  model: {
    provider: 'anthropic',
    name: 'claude-sonnet-4-6',
  },
  llm: {
    requestTimeoutMs: 300_000,
  },
  features: {
    context7: true,
    playwright: false,
    boundedBreaker: true,
    qualityWatchdog: true,
    subAgents: false,
  },
  context7: {
    timeoutMs: 10_000,
    maxDocsChars: 6_000,
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
