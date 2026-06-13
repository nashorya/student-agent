import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeConfig } from '../../config/loader.js';
import {
  normalizeProviderApiKeyEnv,
  runStartupInitializer,
  switchModelName,
} from '../initializer.js';

describe('normalizeProviderApiKeyEnv', () => {
  it('removes GOOGLE_API_KEY for google provider when GEMINI_API_KEY is present', () => {
    const env: NodeJS.ProcessEnv = {
      GEMINI_API_KEY: 'gemini-key',
      GOOGLE_API_KEY: 'google-key',
    };

    const result = normalizeProviderApiKeyEnv('google', env);

    expect(result).toEqual({
      apiKeyEnvName: 'GEMINI_API_KEY',
      changed: true,
      removedEnvKeys: ['GOOGLE_API_KEY'],
    });
    expect(env.GEMINI_API_KEY).toBe('gemini-key');
    expect(env.GOOGLE_API_KEY).toBeUndefined();
  });

  it('copies GOOGLE_API_KEY into GEMINI_API_KEY for google provider when needed', () => {
    const env: NodeJS.ProcessEnv = {
      GOOGLE_API_KEY: 'google-key',
    };

    const result = normalizeProviderApiKeyEnv('google', env);

    expect(result).toEqual({
      apiKeyEnvName: 'GEMINI_API_KEY',
      changed: true,
      copiedFrom: 'GOOGLE_API_KEY',
      removedEnvKeys: ['GOOGLE_API_KEY'],
    });
    expect(env.GEMINI_API_KEY).toBe('google-key');
    expect(env.GOOGLE_API_KEY).toBeUndefined();
  });

  it('leaves unrelated providers untouched', () => {
    const env: NodeJS.ProcessEnv = {
      GEMINI_API_KEY: 'gemini-key',
      GOOGLE_API_KEY: 'google-key',
    };

    const result = normalizeProviderApiKeyEnv('anthropic', env);

    expect(result).toEqual({
      apiKeyEnvName: 'ANTHROPIC_API_KEY',
      changed: false,
      removedEnvKeys: [],
    });
    expect(env.GEMINI_API_KEY).toBe('gemini-key');
    expect(env.GOOGLE_API_KEY).toBe('google-key');
  });
});

describe('provider profile setup', () => {
  let globalDir: string;
  let projectDir: string;

  beforeEach(async () => {
    globalDir = await mkdtemp(join(tmpdir(), 'initializer-global-'));
    projectDir = await mkdtemp(join(tmpdir(), 'initializer-project-'));
  });

  afterEach(async () => {
    await Promise.all([
      rm(globalDir, { recursive: true, force: true }),
      rm(projectDir, { recursive: true, force: true }),
    ]);
  });

  it('writes a named custom profile and removes legacy route overrides', async () => {
    await writeFile(join(globalDir, '.env'), [
      'STUDENT_AGENT_PROVIDER=openai',
      'STUDENT_AGENT_MODEL=old-model',
      'STUDENT_AGENT_BASE_URL=https://old.example/v1',
      'STUDENT_AGENT_API=openai-completions',
      '',
    ].join('\n'));
    const answers = [
      'muskapi',
      '1',
      'https://api.muskapi.cc/v1',
      'secret-key',
      'claude-sonnet-4-6',
      'muskapi-sonnet',
    ];

    const result = await runStartupInitializer({
      cwd: projectDir,
      globalConfigDir: globalDir,
      config: mergeConfig({}, {
        setup: { suppressEmbeddingReminder: true },
      }),
      env: {},
      prompt: async () => answers.shift() ?? '',
      log: () => {},
      forceModelProviderSetup: true,
    });

    expect(result.configuredModelProvider).toBe(true);
    const config = JSON.parse(await readFile(join(globalDir, '.student-agent.json'), 'utf8'));
    expect(config.activeProviderProfile).toBe('muskapi-sonnet');
    expect(config.providerProfiles['muskapi-sonnet']).toEqual({
      provider: 'muskapi',
      name: 'claude-sonnet-4-6',
      baseUrl: 'https://api.muskapi.cc/v1',
      api: 'openai-completions',
      apiKeyEnv: 'MUSKAPI_API_KEY',
    });
    const projectConfig = JSON.parse(await readFile(join(projectDir, '.student-agent.json'), 'utf8'));
    expect(projectConfig).toEqual({ activeProviderProfile: 'muskapi-sonnet' });

    const envFile = await readFile(join(globalDir, '.env'), 'utf8');
    expect(envFile).toContain('MUSKAPI_API_KEY=secret-key');
    expect(envFile).not.toContain('STUDENT_AGENT_PROVIDER=');
    expect(envFile).not.toContain('STUDENT_AGENT_MODEL=');
    expect(envFile).not.toContain('STUDENT_AGENT_BASE_URL=');
    expect(envFile).not.toContain('STUDENT_AGENT_API=');
  });

  it('switchModelName updates only the active profile', async () => {
    await writeFile(join(globalDir, '.student-agent.json'), JSON.stringify({
      activeProviderProfile: 'second',
      providerProfiles: {
        first: {
          provider: 'first-provider',
          name: 'model-a',
          apiKeyEnv: 'FIRST_API_KEY',
        },
        second: {
          provider: 'second-provider',
          name: 'model-b',
          apiKeyEnv: 'SECOND_API_KEY',
        },
      },
    }));
    const config = mergeConfig({}, {
      activeProviderProfile: 'second',
      providerProfiles: {
        first: {
          provider: 'first-provider',
          name: 'model-a',
          apiKeyEnv: 'FIRST_API_KEY',
        },
        second: {
          provider: 'second-provider',
          name: 'model-b',
          apiKeyEnv: 'SECOND_API_KEY',
        },
      },
      model: {
        provider: 'second-provider',
        name: 'model-b',
        apiKeyEnv: 'SECOND_API_KEY',
      },
    });

    const result = await switchModelName({
      config,
      globalConfigDir: globalDir,
      prompt: async () => 'new-model-b',
      log: () => {},
    });

    expect(result).toBe('new-model-b');
    const saved = JSON.parse(await readFile(join(globalDir, '.student-agent.json'), 'utf8'));
    expect(saved.providerProfiles.first.name).toBe('model-a');
    expect(saved.providerProfiles.second.name).toBe('new-model-b');
    expect(saved.model).toBeUndefined();
  });
});
