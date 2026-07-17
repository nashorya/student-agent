import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeConfig } from '../../core/config/loader.js';
import { runProviderProfileCommand } from '../provider-command.js';

describe('runProviderProfileCommand', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'provider-command-'));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  function config() {
    return mergeConfig({}, {
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
    });
  }

  it('cancels without writing or activating', async () => {
    const result = await runProviderProfileCommand({
      cwd,
      config: config(),
      env: { FIRST_API_KEY: 'first' },
      prompt: async () => '',
      log: () => {},
      activate: async () => 'runtime',
    });

    expect(result).toEqual({ switched: false });
    await expect(readFile(join(cwd, '.student-agent.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('writes the selected profile and activates the new runtime', async () => {
    const result = await runProviderProfileCommand({
      cwd,
      config: config(),
      env: { SECOND_API_KEY: 'second' },
      prompt: async () => '2',
      log: () => {},
      activate: async () => 'new-runtime',
    });

    expect(result).toEqual({
      switched: true,
      profileName: 'second',
      value: 'new-runtime',
    });
    const saved = JSON.parse(await readFile(join(cwd, '.student-agent.json'), 'utf8'));
    expect(saved.activeProviderProfile).toBe('second');
  });

  it('rolls back the project selection when activation fails', async () => {
    await writeFile(join(cwd, '.student-agent.json'), JSON.stringify({
      activeProviderProfile: 'first',
      features: { context7: false },
    }));

    await expect(runProviderProfileCommand({
      cwd,
      config: config(),
      env: { SECOND_API_KEY: 'second' },
      prompt: async () => 'second',
      log: () => {},
      activate: async () => {
        throw new Error('runtime failed');
      },
    })).rejects.toThrow('runtime failed');

    const saved = JSON.parse(await readFile(join(cwd, '.student-agent.json'), 'utf8'));
    expect(saved.activeProviderProfile).toBe('first');
    expect(saved.features.context7).toBe(false);
  });
});
