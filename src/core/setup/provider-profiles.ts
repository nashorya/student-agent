import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ProviderProfile,
  StudentAgentConfig,
  StudentAgentConfigInput,
  StudentAgentProvider,
} from '../config/types.js';

const CONFIG_FILENAME = '.student-agent.json';
const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

const API_KEY_MAP: Record<string, string> = {
  'anthropic': 'ANTHROPIC_API_KEY',
  'openai': 'OPENAI_API_KEY',
  'openai-codex': 'OPENAI_API_KEY',
  'deepseek': 'DEEPSEEK_API_KEY',
  'google': 'GEMINI_API_KEY',
  'google-vertex': 'GOOGLE_CLOUD_API_KEY',
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

export function getApiKeyEnvName(provider: StudentAgentProvider): string {
  return API_KEY_MAP[provider] ?? `${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`;
}

export function getProviderProfileApiKeyEnv(profile: ProviderProfile): string {
  return profile.apiKeyEnv ?? getApiKeyEnvName(profile.provider);
}

export function validateProviderProfileName(profileName: string): string {
  const normalized = profileName.trim();
  if (!PROFILE_NAME_PATTERN.test(normalized)) {
    throw new Error(
      'Invalid provider profile name. Use lowercase letters, digits, dots, underscores, or hyphens.',
    );
  }
  return normalized;
}

export function formatProviderProfiles(config: StudentAgentConfig): string {
  const entries = Object.entries(config.providerProfiles);
  if (entries.length === 0) {
    return '  尚未保存 provider profile。请先运行 /setting。';
  }

  return [
    '  Provider profiles：',
    ...entries.map(([profileName, profile], index) => {
      const active = profileName === config.activeProviderProfile ? ' ← 当前' : '';
      return `    ${index + 1}) ${profileName}  ${profile.provider} / ${profile.name}${active}`;
    }),
  ].join('\n');
}

export function resolveProviderProfileSelection(
  config: StudentAgentConfig,
  answer: string,
): string | null {
  const selection = answer.trim();
  if (!selection) return null;

  const names = Object.keys(config.providerProfiles);
  const index = Number.parseInt(selection, 10);
  const profileName = Number.isInteger(index) && String(index) === selection
    ? names[index - 1]
    : selection;

  if (!profileName || !config.providerProfiles[profileName]) {
    throw new Error(`Provider profile "${selection}" was not found`);
  }
  return profileName;
}

export async function selectProviderProfile(options: {
  cwd: string;
  config: StudentAgentConfig;
  answer: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ selected: boolean; profileName?: string }> {
  const profileName = resolveProviderProfileSelection(options.config, options.answer);
  if (!profileName) {
    return { selected: false };
  }

  const profile = options.config.providerProfiles[profileName];
  const apiKeyEnv = getProviderProfileApiKeyEnv(profile);
  const env = options.env ?? process.env;
  if (!env[apiKeyEnv]?.trim()) {
    throw new Error(`Missing ${apiKeyEnv} for provider profile "${profileName}"`);
  }

  await updateStudentAgentConfigFile(options.cwd, {
    activeProviderProfile: profileName,
  });
  return { selected: true, profileName };
}

export async function saveProviderProfile(options: {
  globalConfigDir: string;
  projectDir: string;
  profileName: string;
  profile: ProviderProfile;
}): Promise<void> {
  const profileName = validateProviderProfileName(options.profileName);
  validateProviderProfile(options.profile);

  await updateStudentAgentConfigFile(options.globalConfigDir, {
    activeProviderProfile: profileName,
    providerProfiles: {
      [profileName]: options.profile,
    },
  });
  await updateStudentAgentConfigFile(options.projectDir, {
    activeProviderProfile: profileName,
  });
}

export async function updateActiveProviderProfileModel(options: {
  globalConfigDir: string;
  profileName: string;
  modelName: string;
}): Promise<void> {
  const current = await readStudentAgentConfigFile(options.globalConfigDir);
  const profile = current.providerProfiles?.[options.profileName];
  if (!profile) {
    throw new Error(`Provider profile "${options.profileName}" was not found`);
  }

  await updateStudentAgentConfigFile(options.globalConfigDir, {
    providerProfiles: {
      [options.profileName]: {
        ...profile,
        name: options.modelName,
      },
    },
  });
}

export async function updateStudentAgentConfigFile(
  cwd: string,
  patch: StudentAgentConfigInput,
): Promise<void> {
  const current = await readStudentAgentConfigFile(cwd);
  const next: StudentAgentConfigInput = {
    ...current,
    ...patch,
    ...(current.providerProfiles || patch.providerProfiles ? {
      providerProfiles: {
        ...current.providerProfiles,
        ...patch.providerProfiles,
      },
    } : {}),
    ...(current.model || patch.model ? { model: { ...current.model, ...patch.model } } : {}),
    ...(current.llm || patch.llm ? { llm: { ...current.llm, ...patch.llm } } : {}),
    ...(current.features || patch.features ? {
      features: { ...current.features, ...patch.features },
    } : {}),
    ...(current.context7 || patch.context7 ? {
      context7: { ...current.context7, ...patch.context7 },
    } : {}),
    ...(current.setup || patch.setup ? { setup: { ...current.setup, ...patch.setup } } : {}),
    ...(current.fileGuard || patch.fileGuard ? {
      fileGuard: { ...current.fileGuard, ...patch.fileGuard },
    } : {}),
    ...(current.playwright || patch.playwright ? {
      playwright: { ...current.playwright, ...patch.playwright },
    } : {}),
    ...(current.subAgents || patch.subAgents ? {
      subAgents: { ...current.subAgents, ...patch.subAgents },
    } : {}),
  };

  if (Object.keys(next.providerProfiles ?? {}).length === 0) {
    delete next.providerProfiles;
  }

  await mkdir(cwd, { recursive: true });
  await writeFile(join(cwd, CONFIG_FILENAME), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

async function readStudentAgentConfigFile(cwd: string): Promise<StudentAgentConfigInput> {
  try {
    return JSON.parse(
      await readFile(join(cwd, CONFIG_FILENAME), 'utf8'),
    ) as StudentAgentConfigInput;
  } catch (err) {
    if (isFileMissingError(err)) {
      return {};
    }
    throw err;
  }
}

function validateProviderProfile(profile: ProviderProfile): void {
  if (!profile.provider.trim()) {
    throw new Error('Provider profile provider cannot be empty');
  }
  if (!profile.name.trim()) {
    throw new Error('Provider profile model cannot be empty');
  }
}

function isFileMissingError(err: unknown): boolean {
  return (
    typeof err === 'object'
    && err !== null
    && 'code' in err
    && (err as { code?: unknown }).code === 'ENOENT'
  );
}
