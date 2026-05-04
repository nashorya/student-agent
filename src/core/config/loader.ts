import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_STUDENT_AGENT_CONFIG,
  type StudentAgentConfig,
  type StudentAgentConfigInput,
} from './types.js';

export interface LoadStudentAgentConfigOptions {
  cwd?: string;
  filename?: string;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_CONFIG_FILENAME = '.student-agent.json';

export async function loadStudentAgentConfig(
  options: LoadStudentAgentConfigOptions = {},
): Promise<StudentAgentConfig> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const filename = options.filename ?? env.STUDENT_AGENT_CONFIG ?? DEFAULT_CONFIG_FILENAME;
  const fileConfig = await readConfigFile(cwd, filename);
  const envConfig = readEnvConfig(env);

  return mergeConfig(DEFAULT_STUDENT_AGENT_CONFIG, mergeConfig(fileConfig, envConfig));
}

export function mergeConfig(
  base: StudentAgentConfigInput,
  override: StudentAgentConfigInput,
): StudentAgentConfig {
  return {
    envFile: override.envFile ?? base.envFile ?? DEFAULT_STUDENT_AGENT_CONFIG.envFile,
    model: {
      ...DEFAULT_STUDENT_AGENT_CONFIG.model,
      ...base.model,
      ...override.model,
      provider: 'anthropic',
    },
    llm: {
      ...DEFAULT_STUDENT_AGENT_CONFIG.llm,
      ...base.llm,
      ...override.llm,
    },
    features: {
      ...DEFAULT_STUDENT_AGENT_CONFIG.features,
      ...base.features,
      ...override.features,
    },
    context7: {
      ...DEFAULT_STUDENT_AGENT_CONFIG.context7,
      ...base.context7,
      ...override.context7,
    },
    playwright: {
      ...DEFAULT_STUDENT_AGENT_CONFIG.playwright,
      ...base.playwright,
      ...override.playwright,
    },
    subAgents: {
      ...DEFAULT_STUDENT_AGENT_CONFIG.subAgents,
      ...base.subAgents,
      ...override.subAgents,
    },
  };
}

async function readConfigFile(
  cwd: string,
  filename: string,
): Promise<StudentAgentConfigInput> {
  const path = join(cwd, filename);
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as StudentAgentConfigInput;
  } catch (err) {
    if (isFileMissingError(err)) {
      return {};
    }
    throw err;
  }
}

function readEnvConfig(env: NodeJS.ProcessEnv): StudentAgentConfigInput {
  return {
    envFile: env.STUDENT_AGENT_ENV_FILE,
    model: compactObject({
      baseUrl: env.ANTHROPIC_BASE_URL,
      name: env.STUDENT_AGENT_MODEL,
    }),
    llm: compactObject({
      requestTimeoutMs: readInteger(env.STUDENT_AGENT_LLM_REQUEST_TIMEOUT_MS),
      maxOutputTokens: readInteger(env.STUDENT_AGENT_LLM_MAX_OUTPUT_TOKENS),
      maxRetries: readInteger(env.STUDENT_AGENT_LLM_MAX_RETRIES),
      maxRetryDelayMs: readInteger(env.STUDENT_AGENT_LLM_MAX_RETRY_DELAY_MS),
    }),
    features: compactObject({
      context7: readBoolean(env.STUDENT_AGENT_FEATURE_CONTEXT7),
      playwright: readBoolean(env.STUDENT_AGENT_FEATURE_PLAYWRIGHT),
      boundedBreaker: readBoolean(env.STUDENT_AGENT_FEATURE_BOUNDED_BREAKER),
      qualityWatchdog: readBoolean(env.STUDENT_AGENT_FEATURE_QUALITY_WATCHDOG),
      subAgents: readBoolean(env.STUDENT_AGENT_FEATURE_SUB_AGENTS),
    }),
    context7: compactObject({
      apiKey: env.CONTEXT7_API_KEY,
      timeoutMs: readInteger(env.CONTEXT7_TIMEOUT_MS),
      maxDocsChars: readInteger(env.CONTEXT7_MAX_DOCS_CHARS),
    }),
    playwright: compactObject({
      useStorageState: readBoolean(env.PLAYWRIGHT_USE_STORAGE_STATE),
      storageStatePath: env.PLAYWRIGHT_STORAGE_STATE_PATH,
      navigationTimeoutMs: readInteger(env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS),
      renderWaitMs: readInteger(env.PLAYWRIGHT_RENDER_WAIT_MS),
      maxChars: readInteger(env.PLAYWRIGHT_MAX_CHARS),
    }),
    subAgents: compactObject({
      maxConcurrency: readInteger(env.SUB_AGENT_MAX_CONCURRENCY),
    }),
  };
}

function readBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false;
    default:
      return undefined;
  }
}

function readInteger(value: string | undefined): number | undefined {
  if (value === undefined || !value.trim()) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  return Object.fromEntries(entries) as Partial<T>;
}

function isFileMissingError(err: unknown): boolean {
  return (
    typeof err === 'object'
    && err !== null
    && 'code' in err
    && (err as { code?: unknown }).code === 'ENOENT'
  );
}
