export type StudentAgentProvider = string;

export interface StudentAgentConfig {
  envFile: string;
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
    designStudy: boolean;
    boundedBreaker: boolean;
    qualityWatchdog: boolean;
    subAgents: boolean;
  };
  context7: {
    apiKey?: string;
    timeoutMs: number;
    maxDocsChars: number;
  };
  setup: {
    suppressEmbeddingReminder: boolean;
  };
  playwright: {
    useStorageState: boolean;
    storageStatePath?: string;
    navigationTimeoutMs: number;
    renderWaitMs: number;
    maxChars: number;
  };
  designStudy: {
    extractorMode: 'auto' | 'native' | 'dembrandt';
    dembrandtCommand?: string;
    criticThreshold: number;
    maxCriticRetries: number;
    localUrl?: string;
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
  model: StudentAgentModelInput;
  llm: Partial<StudentAgentConfig['llm']>;
  features: Partial<StudentAgentConfig['features']>;
  context7: Partial<StudentAgentConfig['context7']>;
  setup: Partial<StudentAgentConfig['setup']>;
  playwright: Partial<StudentAgentConfig['playwright']>;
  designStudy: Partial<StudentAgentConfig['designStudy']>;
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
    designStudy: false,
    boundedBreaker: true,
    qualityWatchdog: true,
    subAgents: false,
  },
  context7: {
    timeoutMs: 10_000,
    maxDocsChars: 6_000,
  },
  setup: {
    suppressEmbeddingReminder: false,
  },
  playwright: {
    useStorageState: false,
    navigationTimeoutMs: 10_000,
    renderWaitMs: 2_000,
    maxChars: 5_000,
  },
  designStudy: {
    extractorMode: 'auto',
    criticThreshold: 0.8,
    maxCriticRetries: 1,
  },
  subAgents: {
    maxConcurrency: 3,
  },
};
