import type { StudentAgentConfig } from '../core/config/types.js';
import {
  formatProviderProfiles,
  resolveProviderProfileSelection,
  setActiveProviderProfile,
  getProviderProfileApiKeyEnv,
} from '../core/setup/provider-profiles.js';

export async function runProviderProfileCommand<T>(options: {
  cwd: string;
  config: StudentAgentConfig;
  env?: NodeJS.ProcessEnv;
  prompt: (question: string) => Promise<string>;
  log: (message: string) => void;
  activate: () => Promise<T>;
}): Promise<{ switched: false } | { switched: true; profileName: string; value: T }> {
  options.log(formatProviderProfiles(options.config));
  if (Object.keys(options.config.providerProfiles).length === 0) {
    return { switched: false };
  }

  const answer = await options.prompt('  选择 profile [回车取消]: ');
  const profileName = resolveProviderProfileSelection(options.config, answer);
  if (!profileName) {
    return { switched: false };
  }

  const profile = options.config.providerProfiles[profileName];
  const apiKeyEnv = getProviderProfileApiKeyEnv(profile);
  const env = options.env ?? process.env;
  if (!env[apiKeyEnv]?.trim()) {
    throw new Error(`Missing ${apiKeyEnv} for provider profile "${profileName}"`);
  }

  const previousProfileName = options.config.activeProviderProfile;
  await setActiveProviderProfile(options.cwd, profileName);
  try {
    const value = await options.activate();
    return { switched: true, profileName, value };
  } catch (err) {
    await setActiveProviderProfile(options.cwd, previousProfileName);
    throw err;
  }
}
