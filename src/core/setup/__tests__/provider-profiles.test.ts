import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StudentAgentConfig } from '../../config/types.js';
import {
  formatProviderProfiles,
  resolveProviderProfileSelection,
  saveProviderProfile,
  selectProviderProfile,
  updateActiveProviderProfileModel,
  validateProviderProfileName,
} from '../provider-profiles.js';

function makeConfig(): StudentAgentConfig {
  return {
    envFile: '.env',
    executionMode: 'yolo',
    activeProviderProfile: 'first',
    providerProfiles: {
      first: {
        provider: 'openrouter',
        name: 'model-a',
        apiKeyEnv: 'FIRST_API_KEY',
      },
      second: {
        provider: 'anthropic',
        name: 'model-b',
        apiKeyEnv: 'SECOND_API_KEY',
      },
    },
    model: {
      provider: 'openrouter',
      name: 'model-a',
      apiKeyEnv: 'FIRST_API_KEY',
    },
    llm: { requestTimeoutMs: 300_000 },
    features: {
      context7: true,
      playwright: true,
      boundedBreaker: true,
      qualityWatchdog: true,
      subAgents: false,
      riskGuard: true,
    },
    context7: { timeoutMs: 10_000, maxDocsChars: 6_000 },
    setup: { suppressEmbeddingReminder: false },
    fileGuard: { planningMaxReads: 3, normalMaxReads: 15, readWindow: 30 },
    playwright: {
      useStorageState: false,
      navigationTimeoutMs: 10_000,
      renderWaitMs: 2_000,
      maxChars: 5_000,
    },
    subAgents: { maxConcurrency: 3 },
  };
}

describe('provider profiles', () => {
  let globalDir: string;
  let projectDir: string;

  beforeEach(async () => {
    globalDir = await mkdtemp(join(tmpdir(), 'provider-profiles-global-'));
    projectDir = await mkdtemp(join(tmpdir(), 'provider-profiles-project-'));
  });

  afterEach(async () => {
    await Promise.all([
      rm(globalDir, { recursive: true, force: true }),
      rm(projectDir, { recursive: true, force: true }),
    ]);
  });

  it('formats profiles and marks the active one', () => {
    const menu = formatProviderProfiles(makeConfig());

    expect(menu).toContain('1) first');
    expect(menu).toContain('openrouter / model-a');
    expect(menu).toContain('← 当前');
    expect(menu).toContain('2) second');
  });

  it('resolves a numbered or named selection and allows cancellation', () => {
    const config = makeConfig();

    expect(resolveProviderProfileSelection(config, '2')).toBe('second');
    expect(resolveProviderProfileSelection(config, 'second')).toBe('second');
    expect(resolveProviderProfileSelection(config, '')).toBeNull();
    expect(() => resolveProviderProfileSelection(config, 'missing')).toThrow(
      'Provider profile "missing" was not found',
    );
  });

  it('validates profile names', () => {
    expect(validateProviderProfileName('openrouter-sonnet')).toBe('openrouter-sonnet');
    expect(() => validateProviderProfileName('Open Router')).toThrow('Invalid provider profile name');
  });

  it('selects a profile only when its API key exists and writes project selection', async () => {
    const result = await selectProviderProfile({
      cwd: projectDir,
      config: makeConfig(),
      answer: '2',
      env: { SECOND_API_KEY: 'secret' },
    });

    expect(result).toEqual({ selected: true, profileName: 'second' });
    const saved = JSON.parse(await readFile(join(projectDir, '.student-agent.json'), 'utf8'));
    expect(saved).toEqual({ activeProviderProfile: 'second' });
  });

  it('does not write selection when the profile key is missing', async () => {
    await expect(selectProviderProfile({
      cwd: projectDir,
      config: makeConfig(),
      answer: '2',
      env: {},
    })).rejects.toThrow('Missing SECOND_API_KEY for provider profile "second"');

    await expect(readFile(join(projectDir, '.student-agent.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('saves a profile without replacing existing definitions', async () => {
    await writeFile(join(globalDir, '.student-agent.json'), JSON.stringify({
      providerProfiles: {
        first: {
          provider: 'openrouter',
          name: 'model-a',
          apiKeyEnv: 'FIRST_API_KEY',
        },
      },
      features: { context7: false },
    }));

    await saveProviderProfile({
      globalConfigDir: globalDir,
      projectDir,
      profileName: 'second',
      profile: {
        provider: 'anthropic',
        name: 'model-b',
        apiKeyEnv: 'SECOND_API_KEY',
      },
    });

    const globalConfig = JSON.parse(await readFile(join(globalDir, '.student-agent.json'), 'utf8'));
    const projectConfig = JSON.parse(await readFile(join(projectDir, '.student-agent.json'), 'utf8'));
    expect(globalConfig.activeProviderProfile).toBe('second');
    expect(globalConfig.providerProfiles.first.name).toBe('model-a');
    expect(globalConfig.providerProfiles.second.name).toBe('model-b');
    expect(globalConfig.features.context7).toBe(false);
    expect(projectConfig).toEqual({ activeProviderProfile: 'second' });
  });

  it('updates only the active profile model', async () => {
    await writeFile(join(globalDir, '.student-agent.json'), JSON.stringify({
      activeProviderProfile: 'second',
      providerProfiles: makeConfig().providerProfiles,
    }));

    await updateActiveProviderProfileModel({
      globalConfigDir: globalDir,
      profileName: 'second',
      modelName: 'new-model-b',
    });

    const saved = JSON.parse(await readFile(join(globalDir, '.student-agent.json'), 'utf8'));
    expect(saved.providerProfiles.first.name).toBe('model-a');
    expect(saved.providerProfiles.second.name).toBe('new-model-b');
  });
});
