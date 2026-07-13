import { describe, expect, it } from 'vitest';
import { resolveConfiguredModel } from '../model-resolver.js';

describe('resolveConfiguredModel', () => {
  it('uses Anthropic model metadata for an OpenRouter Anthropic model', () => {
    const model = resolveConfiguredModel({
      provider: 'openrouter',
      name: 'anthropic/claude-sonnet-4.6',
      api: 'openai-completions',
      baseUrl: 'https://openrouter.ai/api/v1',
    });

    expect(model).toMatchObject({
      id: 'anthropic/claude-sonnet-4.6',
      provider: 'openrouter',
      api: 'openai-completions',
      baseUrl: 'https://openrouter.ai/api/v1',
      cost: {
        input: 3,
        output: 15,
        cacheRead: 0.3,
        cacheWrite: 3.75,
      },
      contextWindow: 1_000_000,
    });
    expect(model.maxTokens).toBeGreaterThanOrEqual(64_000);
  });
});
