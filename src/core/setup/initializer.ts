import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Interface } from 'node:readline/promises';
import chalk from 'chalk';
import { getProviders, getModels } from '@mariozechner/pi-ai';
import type { KnownProvider } from '@mariozechner/pi-ai';
import type { ProviderProfile, StudentAgentConfig, StudentAgentProvider } from '../config/types.js';
import { GLOBAL_CONFIG_DIR } from '../config/loader.js';
import { parseEnvFile } from '../env.js';
import {
  getApiKeyEnvName,
  saveProviderProfile,
  updateActiveProviderProfileModel,
  updateStudentAgentConfigFile,
  validateProviderProfileName,
} from './provider-profiles.js';

export { getApiKeyEnvName } from './provider-profiles.js';

export interface StartupInitializerOptions {
  cwd: string;
  globalConfigDir?: string;
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

const GLOBAL_ENV_FILENAME = '.env';
const LEGACY_MODEL_ROUTE_ENV_KEYS = [
  'STUDENT_AGENT_PROVIDER',
  'STUDENT_AGENT_MODEL',
  'STUDENT_AGENT_BASE_URL',
  'STUDENT_AGENT_MODEL_BASE_URL',
  'STUDENT_AGENT_API',
  'STUDENT_AGENT_API_KEY_ENV',
  'STUDENT_AGENT_PROVIDER_PROFILE',
];

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

  if (options.forceModelProviderSetup || !hasModelProviderKey(options.config.model, env)) {
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
  const globalConfigDir = options.globalConfigDir ?? GLOBAL_CONFIG_DIR;
  const currentApiKeyEnv = options.config.model.apiKeyEnv
    ?? getApiKeyEnvName(options.config.model.provider);
  if (!prompt) {
    log(chalk.yellow(`未检测到 ${currentApiKeyEnv}。请在 .env 中配置后重新启动。`));
    return false;
  }

  log(chalk.yellow('需要配置 LLM Provider 和 API Key。'));

  // ── 选择 Provider ──────────────────────────────────────────────────
  const piProviders = getProviders();
  log('\n  可用 Provider（来自 Pi 注册表）：');
  piProviders.forEach((p, i) => {
    log(`    ${String(i + 1).padStart(2)}) ${p}`);
  });
  log(`    ${String(piProviders.length + 1).padStart(2)}) 自定义提供商`);

  const defaultProviderIdx = piProviders.indexOf('anthropic' as KnownProvider) + 1;
  const providerChoice = (await prompt(`\n  选择 Provider [${defaultProviderIdx}]: `)).trim();
  const providerNum = parseInt(providerChoice || String(defaultProviderIdx));

  let provider: StudentAgentProvider;
  const isCustomProvider = providerNum === piProviders.length + 1
    || isNaN(providerNum)
    || providerNum < 1
    || providerNum > piProviders.length;

  if (!isNaN(providerNum) && providerNum >= 1 && providerNum <= piProviders.length) {
    provider = piProviders[providerNum - 1];
  } else if (providerNum === piProviders.length + 1) {
    provider = (await prompt('  Provider 名称: ')).trim() || 'anthropic';
  } else {
    provider = providerChoice || 'anthropic';
  }

  // ── API 格式（仅自定义 provider 需要选择）─────────────────────────
  let apiFormat = '';
  if (isCustomProvider) {
    log('\n  API 格式：');
    log('    1) OpenAI Chat Completions（大多数代理/自建服务）');
    log('    2) Anthropic Messages（Anthropic 官方 / 兼容代理）');
    const formatChoice = (await prompt('  选择 API 格式 [1]: ')).trim();
    apiFormat = formatChoice === '2' ? 'anthropic-messages' : 'openai-completions';
  }

  // ── Base URL（仅自定义 provider 需要）─────────────────────────────
  let baseUrl = '';
  if (isCustomProvider) {
    const existingBaseUrl = env['STUDENT_AGENT_BASE_URL'] ?? '';
    const baseUrlHint = existingBaseUrl ? ` [${existingBaseUrl}，直接回车保留]` : ' [直接回车跳过]';
    const baseUrlInput = (await prompt(`  Base URL${baseUrlHint}: `)).trim();
    baseUrl = baseUrlInput || existingBaseUrl || '';
  }

  // ── API Key ────────────────────────────────────────────────────────
  const apiKeyName = getApiKeyEnvName(provider);
  const existingKey = env[apiKeyName] ? ` [已有，直接回车保留]` : '';
  const apiKey = (await prompt(`  ${apiKeyName}${existingKey}: `)).trim();
  if (!apiKey && !env[apiKeyName]) {
    log(chalk.yellow('API Key 为空，已跳过初始化。'));
    return false;
  }

  // ── 选择模型 ───────────────────────────────────────────────────────
  const modelName = await promptModelName(prompt, provider, log);
  const defaultProfileName = deriveProviderProfileName(provider, modelName);
  const profileNameInput = await prompt(`  Profile 名称 [${defaultProfileName}]: `);
  const profileName = validateProviderProfileName(profileNameInput.trim() || defaultProfileName);
  if (options.config.providerProfiles[profileName]) {
    const confirmation = (await prompt(`  Profile "${profileName}" 已存在，覆盖？(y/N): `))
      .trim()
      .toLowerCase();
    if (confirmation !== 'y' && confirmation !== 'yes') {
      log(chalk.yellow('已取消覆盖 provider profile。'));
      return false;
    }
  }

  // ── 写入 ──────────────────────────────────────────────────────────
  const profile: ProviderProfile = {
    provider,
    name: modelName,
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiFormat ? { api: apiFormat } : {}),
    apiKeyEnv: apiKeyName,
  };

  await mkdir(globalConfigDir, { recursive: true });
  if (apiKey) {
    await upsertEnvFile(join(globalConfigDir, GLOBAL_ENV_FILENAME), { [apiKeyName]: apiKey });
    env[apiKeyName] = apiKey;
  }
  await removeEnvFileKeys(join(globalConfigDir, GLOBAL_ENV_FILENAME), LEGACY_MODEL_ROUTE_ENV_KEYS);
  for (const key of LEGACY_MODEL_ROUTE_ENV_KEYS) {
    delete env[key];
  }
  await saveProviderProfile({
    globalConfigDir,
    projectDir: options.cwd,
    profileName,
    profile,
  });
  log(chalk.green(
    `\nOK: 已保存 profile ${profileName}（Provider: ${provider}, 模型: ${modelName}）`,
  ));
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

  const globalConfigDir = options.globalConfigDir ?? GLOBAL_CONFIG_DIR;
  await mkdir(globalConfigDir, { recursive: true });
  await updateStudentAgentConfigFile(globalConfigDir, {
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

  const globalConfigDir = options.globalConfigDir ?? GLOBAL_CONFIG_DIR;
  await mkdir(globalConfigDir, { recursive: true });
  await upsertEnvFile(join(globalConfigDir, GLOBAL_ENV_FILENAME), values);
  await updateStudentAgentConfigFile(globalConfigDir, {
    setup: {
      suppressEmbeddingReminder: suppressReminder,
    },
  });
  log(chalk.green(`已写入向量模型配置到 ${globalConfigDir}`));
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

export async function removeEnvFileKeys(path: string, keys: string[]): Promise<void> {
  let raw = '';
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (!isFileMissingError(err)) {
      throw err;
    }
  }

  const removed = new Set(keys);
  const nextLines = raw.split(/\r?\n/).filter((line) => {
    const key = readEnvLineKey(line);
    return !key || !removed.has(key);
  });
  await writeFile(path, `${trimTrailingEmptyLines(nextLines).join('\n')}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

async function promptModelName(
  prompt: (question: string) => Promise<string>,
  provider: StudentAgentProvider,
  log: (message: string) => void,
): Promise<string> {
  const defaultFallback = provider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-6';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const models = getModels(provider as any);

  if (models.length === 0) {
    const input = (await prompt(`  模型名称 [${defaultFallback}]: `)).trim();
    return input || defaultFallback;
  }

  log(`\n  ${provider} 可用模型：`);
  models.forEach((m, i) => {
    log(`    ${String(i + 1).padStart(2)}) ${m.id}`);
  });
  log(`    ${String(models.length + 1).padStart(2)}) 手动输入`);

  const defaultIdx = models.findIndex((m) => m.id === defaultFallback);
  const displayDefault = defaultIdx >= 0 ? defaultIdx + 1 : 1;

  const choice = (await prompt(`  选择模型 [${displayDefault}]: `)).trim();
  const num = parseInt(choice || String(displayDefault));

  if (!isNaN(num) && num >= 1 && num <= models.length) {
    return models[num - 1].id;
  }
  if (num === models.length + 1) {
    const custom = (await prompt(`  模型名称 [${defaultFallback}]: `)).trim();
    return custom || defaultFallback;
  }
  // 直接输入了模型 ID
  return choice || defaultFallback;
}

/**
 * 仅切换模型名称，保持 Provider / API Key / BaseUrl 不变。
 * 返回新模型名，取消时返回 null。
 */
export async function switchModelName(options: {
  config: StudentAgentConfig;
  globalConfigDir?: string;
  prompt: (question: string) => Promise<string>;
  log?: (message: string) => void;
}): Promise<string | null> {
  const { config, prompt } = options;
  const log = options.log ?? console.log;
  const { provider, name: currentName } = config.model;

  log(`\n  当前模型：${provider} / ${currentName}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const models = getModels(provider as any);

  let newName: string;
  if (models.length === 0) {
    const input = (await prompt(`  新模型名称 [回车取消]: `)).trim();
    if (!input) return null;
    newName = input;
  } else {
    log(`\n  ${provider} 可用模型：`);
    models.forEach((m, i) => {
      const current = m.id === currentName ? ' ← 当前' : '';
      log(`    ${String(i + 1).padStart(2)}) ${m.id}${current}`);
    });
    log(`    ${String(models.length + 1).padStart(2)}) 手动输入`);

    const choice = (await prompt(`  选择模型 [回车取消]: `)).trim();
    if (!choice) return null;

    const num = parseInt(choice);
    if (!isNaN(num) && num >= 1 && num <= models.length) {
      newName = models[num - 1].id;
    } else if (num === models.length + 1) {
      const custom = (await prompt('  模型名称: ')).trim();
      if (!custom) return null;
      newName = custom;
    } else {
      newName = choice;
    }
  }

  const globalConfigDir = options.globalConfigDir ?? GLOBAL_CONFIG_DIR;
  await mkdir(globalConfigDir, { recursive: true });
  if (config.activeProviderProfile) {
    await updateActiveProviderProfileModel({
      globalConfigDir,
      profileName: config.activeProviderProfile,
      modelName: newName,
    });
  } else {
    await upsertEnvFile(join(globalConfigDir, GLOBAL_ENV_FILENAME), {
      STUDENT_AGENT_MODEL: newName,
    });
    await updateStudentAgentConfigFile(globalConfigDir, { model: { name: newName } });
    process.env.STUDENT_AGENT_MODEL = newName;
  }

  log(chalk.green(`\nOK: 模型已切换为 ${provider} / ${newName}`));
  return newName;
}

function hasModelProviderKey(
  model: StudentAgentConfig['model'],
  env: NodeJS.ProcessEnv,
): boolean {
  return hasValue(env[model.apiKeyEnv ?? getApiKeyEnvName(model.provider)]);
}

export interface NormalizeProviderApiKeyEnvResult {
  apiKeyEnvName: string;
  changed: boolean;
  copiedFrom?: string;
  removedEnvKeys: string[];
}

export function normalizeProviderApiKeyEnv(
  provider: StudentAgentProvider,
  env: NodeJS.ProcessEnv = process.env,
): NormalizeProviderApiKeyEnvResult {
  const apiKeyEnvName = getApiKeyEnvName(provider);
  const result: NormalizeProviderApiKeyEnvResult = {
    apiKeyEnvName,
    changed: false,
    removedEnvKeys: [],
  };

  if (provider !== 'google') {
    return result;
  }

  const geminiKey = 'GEMINI_API_KEY';
  const googleKey = 'GOOGLE_API_KEY';
  const geminiValue = env[geminiKey];
  const googleValue = env[googleKey];

  if (hasValue(geminiValue)) {
    if (googleKey in env) {
      delete env[googleKey];
      result.changed = true;
      result.removedEnvKeys.push(googleKey);
    }
    return result;
  }

  if (hasValue(googleValue)) {
    env[geminiKey] = googleValue;
    delete env[googleKey];
    result.changed = true;
    result.copiedFrom = googleKey;
    result.removedEnvKeys.push(googleKey);
  }

  return result;
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

function deriveProviderProfileName(provider: string, modelName: string): string {
  const raw = `${provider}-${modelName}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  return raw.replace(/^-+|-+$/g, '') || 'provider-profile';
}

function isFileMissingError(err: unknown): boolean {
  return (
    typeof err === 'object'
    && err !== null
    && 'code' in err
    && (err as { code?: unknown }).code === 'ENOENT'
  );
}
