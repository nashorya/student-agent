import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Interface } from 'node:readline/promises';
import chalk from 'chalk';
import { getProviders, getModels } from '@mariozechner/pi-ai';
import type { KnownProvider } from '@mariozechner/pi-ai';
import type { StudentAgentConfig, StudentAgentConfigInput, StudentAgentProvider } from '../config/types.js';
import { GLOBAL_CONFIG_DIR } from '../config/loader.js';
import { parseEnvFile } from '../env.js';

const API_KEY_MAP: Record<string, string> = {
  'anthropic': 'ANTHROPIC_API_KEY',
  'openai': 'OPENAI_API_KEY',
  'openai-codex': 'OPENAI_API_KEY',
  'deepseek': 'DEEPSEEK_API_KEY',
  'google': 'GOOGLE_API_KEY',
  'google-vertex': 'GOOGLE_API_KEY',
  'groq': 'GROQ_API_KEY',
  'xai': 'XAI_API_KEY',
  'mistral': 'MISTRAL_API_KEY',
  'openrouter': 'OPENROUTER_API_KEY',
  'cerebras': 'CEREBRAS_API_KEY',
  'fireworks': 'FIREWORKS_API_KEY',
  'github-copilot': 'GITHUB_TOKEN',
  'amazon-bedrock': 'AWS_ACCESS_KEY_ID',
  'azure-openai-responses': 'AZURE_OPENAI_API_KEY',
  'huggingface': 'HUGGINGFACE_API_KEY',
  'moonshotai': 'MOONSHOT_API_KEY',
  'minimax': 'MINIMAX_API_KEY',
  'vercel-ai-gateway': 'VERCEL_OPENAI_API_KEY',
  'zai': 'ZAI_API_KEY',
};

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
const GLOBAL_ENV_FILENAME = '.env';

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
    // 归一化到 Pi SDK 已知的 provider，确保 API Key env var 名称正确
    provider = apiFormat === 'anthropic-messages' ? 'anthropic' : 'openai';
  }

  // ── Base URL（可选，空则使用 Provider 默认）────────────────────────
  const existingBaseUrl = env['STUDENT_AGENT_BASE_URL'] ?? '';
  const baseUrlHint = existingBaseUrl ? ` [${existingBaseUrl}，直接回车保留]` : ' [直接回车跳过]';
  const baseUrlInput = (await prompt(`  Base URL${baseUrlHint}: `)).trim();
  const baseUrl = baseUrlInput || existingBaseUrl || '';

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

  // ── 写入 ──────────────────────────────────────────────────────────
  const values: Record<string, string> = {
    STUDENT_AGENT_PROVIDER: provider,
    STUDENT_AGENT_MODEL: modelName,
  };
  env.STUDENT_AGENT_PROVIDER = provider;
  env.STUDENT_AGENT_MODEL = modelName;

  const configPatch: StudentAgentConfigInput = { model: { provider, name: modelName } };

  if (baseUrl) {
    values['STUDENT_AGENT_BASE_URL'] = baseUrl;
    configPatch.model = { ...configPatch.model, baseUrl };
    env['STUDENT_AGENT_BASE_URL'] = baseUrl;
  } else {
    delete env['STUDENT_AGENT_BASE_URL'];
  }

  if (apiFormat) {
    values['STUDENT_AGENT_API'] = apiFormat;
    configPatch.model = { ...configPatch.model, api: apiFormat };
    env['STUDENT_AGENT_API'] = apiFormat;
  } else {
    delete env['STUDENT_AGENT_API'];
  }

  if (apiKey) {
    values[apiKeyName] = apiKey;
    env[apiKeyName] = apiKey;
  }

  await mkdir(GLOBAL_CONFIG_DIR, { recursive: true });
  await upsertEnvFile(join(GLOBAL_CONFIG_DIR, GLOBAL_ENV_FILENAME), values);
  await updateStudentAgentConfig(GLOBAL_CONFIG_DIR, configPatch);
  log(chalk.green(`\nOK: 已写入 ${GLOBAL_CONFIG_DIR}（Provider: ${provider}, 模型: ${modelName}）`));
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

  await mkdir(GLOBAL_CONFIG_DIR, { recursive: true });
  await updateStudentAgentConfig(GLOBAL_CONFIG_DIR, {
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

  await mkdir(GLOBAL_CONFIG_DIR, { recursive: true });
  await upsertEnvFile(join(GLOBAL_CONFIG_DIR, GLOBAL_ENV_FILENAME), values);
  await updateStudentAgentConfig(GLOBAL_CONFIG_DIR, {
    setup: {
      suppressEmbeddingReminder: suppressReminder,
    },
  });
  log(chalk.green(`已写入向量模型配置到 ${GLOBAL_CONFIG_DIR}`));
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

  await mkdir(GLOBAL_CONFIG_DIR, { recursive: true });
  await upsertEnvFile(join(GLOBAL_CONFIG_DIR, GLOBAL_ENV_FILENAME), { STUDENT_AGENT_MODEL: newName });
  await updateStudentAgentConfig(GLOBAL_CONFIG_DIR, { model: { name: newName } });
  process.env.STUDENT_AGENT_MODEL = newName;

  log(chalk.green(`\nOK: 模型已切换为 ${provider} / ${newName}`));
  return newName;
}

function hasModelProviderKey(provider: StudentAgentProvider, env: NodeJS.ProcessEnv): boolean {
  return hasValue(env[getApiKeyEnvName(provider)]);
}

export function getApiKeyEnvName(provider: StudentAgentProvider): string {
  return API_KEY_MAP[provider] ?? `${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`;
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
