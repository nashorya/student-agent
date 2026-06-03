import { describe, expect, it } from 'vitest';
import { normalizeProviderApiKeyEnv } from '../initializer.js';

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
