import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Interface } from 'node:readline/promises';
import chalk from 'chalk';
import type { StudentAgentConfig, StudentAgentConfigInput, StudentAgentProvider } from '../config/types.js';
import { parseEnvFile } from '../env.js';

export interface StartupInitializerOptions {
  cwd: string;
  config: StudentAgentConfig;
  env?: NodeJS.ProcessEnv;
  prompt?: (question: string) => Promise<string>;
  log?: (message: string) => void;
  forceModelProviderSetup?: boolean;
  forceEmbeddingSetup?: boolean;
}

export interface StartupInitializationResult {
  wroteEnv: boolean;
  wroteConfig: boolean;
  configuredModelProvider: boolean;
  suppressedEmbeddingReminder: boolean;
  configuredEmbedding: boolean;
}

const CONFIG_FILENAME = '.student-agent.json';

export async function runStartupInitializer(
  options: StartupInitializerOptions,
): Promise<StartupInitializationResult> {
  const env = options.env ?? process.env;
  const log = options.log ?? console.log;
  const result: StartupInitializationResult = {
    wroteEnv: false,
    wroteConfig: false,
    configuredModelProvider: false,
    suppressedEmbeddingReminder: false,
    configuredEmbedding: false,
  };

  if (options.forceModelProviderSetup || !hasModelProviderKey(options.config.model.provider, env)) {
    const configured = await configureModelProvider(options, env, log);
    result.wroteEnv = result.wroteEnv || configured;
    result.wroteConfig = result.wroteConfig || configured;
    result.configuredModelProvider = configured;
  }

  if (options.forceEmbeddingSetup) {
    const configured = await configureEmbeddingProvider(options, env, log);
    result.wroteEnv = result.wroteEnv || configured;
    result.wroteConfig = result.wroteConfig || configured;
    result.configuredEmbedding = configured;
  } else {
    const reminder = await maybeRemindEmbeddingConfig(options, env, log);
    result.wroteConfig = result.wroteConfig || reminder.wroteConfig;
    result.suppressedEmbeddingReminder = reminder.suppressed;
  }

  return result;
}

export function createReadlinePrompt(rl: Interface): (question: string) => Promise<string> {
  return (question: string) => rl.question(question);
}

async function configureModelProvider(
  options: StartupInitializerOptions,
  env: NodeJS.ProcessEnv,
  log: (message: string) => void,
): Promise<boolean> {
  const prompt = options.prompt;
  if (!prompt) {
    log(chalk.yellow(`未检测到 ${getApiKeyEnvName(options.config.model.provider)}。请在 .env 中配置后重新启动。`));
    return false;
  }

  log(chalk.yellow('未检测到模型 API Key，需要先完成 Provider 连接配置。'));
  const provider = normalizeProviderChoice(await prompt('选择 Provider：1) Anthropic Messages  2) OpenAI Chat Completions [1]: '));
  const mode = normalizeConnectionMode(await prompt('连接方式：1) 直连  2) 中转站 [1]: '));

  const modelName = await promptModelName(prompt, provider);
  const values: Record<string, string> = {
    STUDENT_AGENT_PROVIDER: provider,
    STUDENT_AGENT_MODEL: modelName,
  };
  env.STUDENT_AGENT_PROVIDER = provider;
  env.STUDENT_AGENT_MODEL = modelName;
  const configPatch: StudentAgentConfigInput = {
    model: {
      provider,
      name: modelName,
    },
  };

  if (mode === 'relay') {
    const baseUrl = (await prompt('中转站 Base URL: ')).trim();
    if (!baseUrl) {
      log(chalk.yellow('Base URL 为空，已跳过初始化。'));
      return false;
    }
    configPatch.model = {
      ...configPatch.model,
      baseUrl,
    };
    values[getBaseUrlEnvName(provider)] = baseUrl;
    env[getBaseUrlEnvName(provider)] = baseUrl;
  } else {
    values[getBaseUrlEnvName(provider)] = '';
    delete env[getBaseUrlEnvName(provider)];
  }

  const apiKeyName = getApiKeyEnvName(provider);
  const apiKey = (await prompt(`${apiKeyName}: `)).trim();
  if (!apiKey) {
    log(chalk.yellow('API Key 为空，已跳过初始化。'));
    return false;
  }

  values[apiKeyName] = apiKey;
  env[apiKeyName] = apiKey;

  await upsertEnvFile(join(options.cwd, options.config.envFile), values);
  await updateStudentAgentConfig(options.cwd, configPatch);
  log(chalk.green(`已写入 ${options.config.envFile}`));
  return true;
}

async function maybeRemindEmbeddingConfig(
  options: StartupInitializerOptions,
  env: NodeJS.ProcessEnv,
  log: (message: string) => void,
): Promise<{ wroteConfig: boolean; suppressed: boolean }> {
  if (options.config.setup.suppressEmbeddingReminder) {
    return { wroteConfig: false, suppressed: false };
  }

  const missing = getMissingEmbeddingConfig(env);
  if (missing.length === 0) {
    return { wroteConfig: false, suppressed: false };
  }

  log(chalk.yellow(`未完整配置向量模型：缺少 ${missing.join(', ')}。文档向量检索将不可用。`));
  const prompt = options.prompt;
  if (!prompt) {
    return { wroteConfig: false, suppressed: false };
  }

  const answer = (await prompt('以后不再提醒向量模型配置？(y/N): ')).trim().toLowerCase();
  if (answer !== 'y' && answer !== 'yes') {
    return { wroteConfig: false, suppressed: false };
  }

  await updateStudentAgentConfig(options.cwd, {
    setup: {
      suppressEmbeddingReminder: true,
    },
  });
  log(chalk.dim('已记录：以后不再提醒向量模型配置。'));
  return { wroteConfig: true, suppressed: true };
}

async function configureEmbeddingProvider(
  options: StartupInitializerOptions,
  env: NodeJS.ProcessEnv,
  log: (message: string) => void,
): Promise<boolean> {
  const prompt = options.prompt;
  if (!prompt) {
    log(chalk.yellow('无法交互配置向量模型。请在 .env 中配置 STUDENT_AGENT_EMBEDDING_*。'));
    return false;
  }

  log(chalk.yellow('配置向量模型（OpenAI-compatible embeddings）。'));
  const defaultBaseUrl = env.STUDENT_AGENT_EMBEDDING_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const defaultModel = env.STUDENT_AGENT_EMBEDDING_MODEL || env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

  const baseUrl = (await prompt(`Embedding Base URL [${defaultBaseUrl}]: `)).trim() || defaultBaseUrl;
  const model = (await prompt(`Embedding Model [${defaultModel}]: `)).trim() || defaultModel;
  const apiKey = (await prompt('Embedding API Key: ')).trim();
  if (!apiKey) {
    log(chalk.yellow('Embedding API Key 为空，已跳过向量模型配置。'));
    return false;
  }

  const suppressAnswer = (await prompt('以后不再提醒向量模型配置？(Y/n): ')).trim().toLowerCase();
  const suppressReminder = suppressAnswer !== 'n' && suppressAnswer !== 'no';

  const values = {
    STUDENT_AGENT_EMBEDDING_BASE_URL: baseUrl,
    STUDENT_AGENT_EMBEDDING_MODEL: model,
    STUDENT_AGENT_EMBEDDING_API_KEY: apiKey,
  };
  Object.assign(env, values);

  await upsertEnvFile(join(options.cwd, options.config.envFile), values);
  await updateStudentAgentConfig(options.cwd, {
    setup: {
      suppressEmbeddingReminder: suppressReminder,
    },
  });
  log(chalk.green(`已写入向量模型配置到 ${options.config.envFile}`));
  return true;
}

export function getMissingEmbeddingConfig(env: NodeJS.ProcessEnv): string[] {
  const missing: string[] = [];
  if (!hasValue(env.STUDENT_AGENT_EMBEDDING_MODEL) && !hasValue(env.OPENAI_EMBEDDING_MODEL)) {
    missing.push('STUDENT_AGENT_EMBEDDING_MODEL');
  }
  if (!hasValue(env.STUDENT_AGENT_EMBEDDING_API_KEY) && !hasValue(env.OPENAI_API_KEY)) {
    missing.push('STUDENT_AGENT_EMBEDDING_API_KEY');
  }
  return missing;
}

export async function upsertEnvFile(path: string, values: Record<string, string>): Promise<void> {
  let raw = '';
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (!isFileMissingError(err)) {
      throw err;
    }
  }

  const next = renderEnvWithValues(raw, values);
  await writeFile(path, next, { encoding: 'utf8', mode: 0o600 });
}

export function renderEnvWithValues(raw: string, values: Record<string, string>): string {
  const existing = parseEnvFile(raw);
  const lines = raw ? raw.split(/\r?\n/) : [];
  const handled = new Set<string>();

  const nextLines = lines.map((line) => {
    const key = readEnvLineKey(line);
    if (!key || !(key in values)) {
      return line;
    }
    handled.add(key);
    return `${key}=${formatEnvValue(values[key])}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (handled.has(key) || key in existing) {
      continue;
    }
    nextLines.push(`${key}=${formatEnvValue(value)}`);
  }

  return `${trimTrailingEmptyLines(nextLines).join('\n')}\n`;
}

async function updateStudentAgentConfig(cwd: string, patch: StudentAgentConfigInput): Promise<void> {
  const path = join(cwd, CONFIG_FILENAME);
  let current: StudentAgentConfigInput = {};
  try {
    current = JSON.parse(await readFile(path, 'utf8')) as StudentAgentConfigInput;
  } catch (err) {
    if (!isFileMissingError(err)) {
      throw err;
    }
  }

  const next: StudentAgentConfigInput = {
    ...current,
    ...patch,
    model: { ...current.model, ...patch.model },
    llm: { ...current.llm, ...patch.llm },
    features: { ...current.features, ...patch.features },
    context7: { ...current.context7, ...patch.context7 },
    setup: { ...current.setup, ...patch.setup },
    playwright: { ...current.playwright, ...patch.playwright },
    subAgents: { ...current.subAgents, ...patch.subAgents },
  };

  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

function normalizeConnectionMode(input: string): 'direct' | 'relay' {
  const normalized = input.trim().toLowerCase();
  if (normalized === '2' || normalized === 'relay' || normalized === 'baseurl' || normalized === '中转站') {
    return 'relay';
  }
  return 'direct';
}

function normalizeProviderChoice(input: string): StudentAgentProvider {
  const normalized = input.trim().toLowerCase();
  if (normalized === '2' || normalized === 'openai' || normalized === 'openai-chat') {
    return 'openai';
  }
  return 'anthropic';
}

async function promptModelName(
  prompt: (question: string) => Promise<string>,
  provider: StudentAgentProvider,
): Promise<string> {
  const defaultModel = provider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-6';
  const input = (await prompt(`模型名称 [${defaultModel}]: `)).trim();
  return input || defaultModel;
}

function hasModelProviderKey(provider: StudentAgentProvider, env: NodeJS.ProcessEnv): boolean {
  return hasValue(env[getApiKeyEnvName(provider)]);
}

function getApiKeyEnvName(provider: StudentAgentProvider): 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY' {
  return provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
}

function getBaseUrlEnvName(provider: StudentAgentProvider): 'ANTHROPIC_BASE_URL' | 'OPENAI_BASE_URL' {
  return provider === 'openai' ? 'OPENAI_BASE_URL' : 'ANTHROPIC_BASE_URL';
}

function readEnvLineKey(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }
  const normalized = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trimStart() : trimmed;
  const equalsIndex = normalized.indexOf('=');
  if (equalsIndex <= 0) {
    return null;
  }
  return normalized.slice(0, equalsIndex).trim();
}

function formatEnvValue(value: string): string {
  if (!value) {
    return '';
  }
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function trimTrailingEmptyLines(lines: string[]): string[] {
  const next = [...lines];
  while (next.length > 0 && next[next.length - 1] === '') {
    next.pop();
  }
  return next;
}

function hasValue(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function isFileMissingError(err: unknown): boolean {
  return (
    typeof err === 'object'
    && err !== null
    && 'code' in err
    && (err as { code?: unknown }).code === 'ENOENT'
  );
}
