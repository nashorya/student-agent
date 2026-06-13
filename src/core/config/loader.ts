import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_STUDENT_AGENT_CONFIG,
  type StudentAgentExecutionMode,
  type StudentAgentConfig,
  type StudentAgentConfigInput,
  type StudentAgentProvider,
} from './types.js';

export const GLOBAL_CONFIG_DIR = join(homedir(), '.student-agent');

export interface LoadStudentAgentConfigOptions {
  cwd?: string;
  filename?: string;
  env?: NodeJS.ProcessEnv;
  globalConfigDir?: string;
}

const DEFAULT_CONFIG_FILENAME = '.student-agent.json';

export async function loadStudentAgentConfig(
  options: LoadStudentAgentConfigOptions = {},
): Promise<StudentAgentConfig> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const globalDir = options.globalConfigDir ?? GLOBAL_CONFIG_DIR;
  const filename = options.filename ?? env.STUDENT_AGENT_CONFIG ?? DEFAULT_CONFIG_FILENAME;

  // 优先级（低→高）：默认值 → 全局配置 → 项目配置 → 环境变量
  const globalConfig = await readConfigFile(globalDir, filename);
  const localConfig = cwd !== globalDir ? await readConfigFile(cwd, filename) : {};
  const envConfig = readEnvConfig(env);
  const providerProfiles = globalConfig.providerProfiles ?? {};
  const activeProviderProfile = envConfig.activeProviderProfile
    ?? localConfig.activeProviderProfile
    ?? globalConfig.activeProviderProfile;
  const selectedProfile = activeProviderProfile
    ? providerProfiles[activeProviderProfile]
    : undefined;

  if (activeProviderProfile && !selectedProfile) {
    throw new Error(`Provider profile "${activeProviderProfile}" was not found in the global configuration`);
  }

  let config = mergeConfig(DEFAULT_STUDENT_AGENT_CONFIG, withoutProfileMetadata(globalConfig));
  if (selectedProfile) {
    config = mergeConfig(config, { model: selectedProfile });
  }
  const localOverrides = withoutProfileMetadata(localConfig);
  if (localConfig.activeProviderProfile || envConfig.activeProviderProfile) {
    delete localOverrides.model;
  }
  config = mergeConfig(config, localOverrides);
  config = mergeConfig(config, envConfig);

  if (hasExplicitModelRouteEnv(env)) {
    config.model.apiKeyEnv = readOptionalString(env.STUDENT_AGENT_API_KEY_ENV);
  }

  return {
    ...config,
    activeProviderProfile,
    providerProfiles,
  };
}

export function mergeConfig(
  base: StudentAgentConfigInput,
  override: StudentAgentConfigInput,
): StudentAgentConfig {
  return {
    envFile: override.envFile ?? base.envFile ?? DEFAULT_STUDENT_AGENT_CONFIG.envFile,
    executionMode: normalizeExecutionMode(override.executionMode ?? base.executionMode),
    activeProviderProfile: override.activeProviderProfile ?? base.activeProviderProfile,
    providerProfiles: {
      ...DEFAULT_STUDENT_AGENT_CONFIG.providerProfiles,
      ...base.providerProfiles,
      ...override.providerProfiles,
    },
    model: mergeModelConfig(base, override),
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
    setup: {
      ...DEFAULT_STUDENT_AGENT_CONFIG.setup,
      ...base.setup,
      ...override.setup,
    },
    fileGuard: {
      ...DEFAULT_STUDENT_AGENT_CONFIG.fileGuard,
      ...base.fileGuard,
      ...override.fileGuard,
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

function mergeModelConfig(
  base: StudentAgentConfigInput,
  override: StudentAgentConfigInput,
): StudentAgentConfig['model'] {
  const merged = {
    ...DEFAULT_STUDENT_AGENT_CONFIG.model,
    ...base.model,
    ...override.model,
  };
  return {
    ...merged,
    provider: normalizeProvider(merged.provider),
  };
}

function withoutProfileMetadata(config: StudentAgentConfigInput): StudentAgentConfigInput {
  const {
    activeProviderProfile: _activeProviderProfile,
    providerProfiles: _providerProfiles,
    ...rest
  } = config;
  return rest;
}

function normalizeProvider(provider: string | undefined): StudentAgentProvider {
  return provider ?? DEFAULT_STUDENT_AGENT_CONFIG.model.provider;
}

function normalizeExecutionMode(mode: StudentAgentExecutionMode | undefined): StudentAgentExecutionMode {
  return mode ?? DEFAULT_STUDENT_AGENT_CONFIG.executionMode;
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
  const provider = readProviderEnv(env);
  return {
    envFile: env.STUDENT_AGENT_ENV_FILE,
    executionMode: readExecutionMode(env.STUDENT_AGENT_EXECUTION_MODE ?? env.STUDENT_AGENT_MODE),
    activeProviderProfile: readOptionalString(env.STUDENT_AGENT_PROVIDER_PROFILE),
    model: compactObject({
      provider,
      baseUrl: readModelBaseUrl(env, provider),
      name: readOptionalString(env.STUDENT_AGENT_MODEL),
      api: readOptionalString(env.STUDENT_AGENT_API),
      apiKeyEnv: readOptionalString(env.STUDENT_AGENT_API_KEY_ENV),
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
      riskGuard: readBoolean(env.STUDENT_AGENT_FEATURE_RISK_GUARD),
    }),
    context7: compactObject({
      apiKey: readOptionalString(env.CONTEXT7_API_KEY),
      timeoutMs: readInteger(env.CONTEXT7_TIMEOUT_MS),
      maxDocsChars: readInteger(env.CONTEXT7_MAX_DOCS_CHARS),
    }),
    setup: compactObject({
      suppressEmbeddingReminder: readBoolean(env.STUDENT_AGENT_SUPPRESS_EMBEDDING_REMINDER),
    }),
    fileGuard: compactObject({
      planningMaxReads: readInteger(env.STUDENT_AGENT_FILE_GUARD_PLANNING_MAX_READS),
      normalMaxReads: readInteger(env.STUDENT_AGENT_FILE_GUARD_NORMAL_MAX_READS),
      readWindow: readInteger(env.STUDENT_AGENT_FILE_GUARD_READ_WINDOW),
    }),
    playwright: compactObject({
      useStorageState: readBoolean(env.PLAYWRIGHT_USE_STORAGE_STATE),
      storageStatePath: readOptionalString(env.PLAYWRIGHT_STORAGE_STATE_PATH),
      navigationTimeoutMs: readInteger(env.PLAYWRIGHT_NAVIGATION_TIMEOUT_MS),
      renderWaitMs: readInteger(env.PLAYWRIGHT_RENDER_WAIT_MS),
      maxChars: readInteger(env.PLAYWRIGHT_MAX_CHARS),
    }),
    subAgents: compactObject({
      maxConcurrency: readInteger(env.SUB_AGENT_MAX_CONCURRENCY),
    }),
  };
}

function hasExplicitModelRouteEnv(env: NodeJS.ProcessEnv): boolean {
  return [
    env.STUDENT_AGENT_PROVIDER,
    env.STUDENT_AGENT_MODEL,
    env.STUDENT_AGENT_BASE_URL,
    env.STUDENT_AGENT_MODEL_BASE_URL,
    env.STUDENT_AGENT_API,
    env.STUDENT_AGENT_API_KEY_ENV,
  ].some((value) => readOptionalString(value) !== undefined);
}

function readExecutionMode(value: string | undefined): StudentAgentExecutionMode | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'safe' || normalized === 'yolo') return normalized;
  return undefined;
}

function readProviderEnv(env: NodeJS.ProcessEnv): StudentAgentProvider | undefined {
  const raw = readOptionalString(env.STUDENT_AGENT_PROVIDER);
  return raw ? normalizeProvider(raw) : undefined;
}

function readModelBaseUrl(
  env: NodeJS.ProcessEnv,
  provider: StudentAgentProvider | undefined,
): string | undefined {
  return readOptionalString(env.STUDENT_AGENT_BASE_URL)
    ?? readOptionalString(env.STUDENT_AGENT_MODEL_BASE_URL)
    ?? (provider === 'openai' ? readOptionalString(env.OPENAI_BASE_URL) : undefined)
    ?? (provider === 'anthropic' ? readOptionalString(env.ANTHROPIC_BASE_URL) : undefined);
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

function readOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
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
