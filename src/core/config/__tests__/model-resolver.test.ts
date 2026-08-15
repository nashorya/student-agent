import { describe, expect, it } from 'vitest';
import { isDegradedFallbackModel, resolveConfiguredModel } from '../model-resolver.js';

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

  it('clones the glm-5.2 catalog entry for glm-5.3 instead of the degraded fallback', () => {
    const model = resolveConfiguredModel({
      provider: 'zai-coding-cn',
      name: 'glm-5.3',
      api: 'openai-completions',
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    });

    expect(model).toMatchObject({
      id: 'glm-5.3',
      name: 'GLM-5.3',
      provider: 'zai-coding-cn',
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
      reasoning: true,
      contextWindow: 1_000_000,
    });
    expect(model.compat?.thinkingFormat).toBe('zai');
    expect(model.maxTokens).toBeGreaterThanOrEqual(131_072);
  });

  it('still falls back for unknown models', () => {
    const model = resolveConfiguredModel({
      provider: 'openai',
      name: 'new-model-b',
      api: 'openai-completions',
      baseUrl: 'https://example.com/v1',
    });

    expect(model.reasoning).toBe(false);
    expect(model.contextWindow).toBe(128_000);
  });

  it('marks only the fallback path as degraded', () => {
    const fallback = resolveConfiguredModel({
      provider: 'openai',
      name: 'new-model-b',
      api: 'openai-completions',
      baseUrl: 'https://example.com/v1',
    });
    const catalogHit = resolveConfiguredModel({
      provider: 'zai-coding-cn',
      name: 'glm-5.2',
      api: 'openai-completions',
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    });
    const cloned = resolveConfiguredModel({
      provider: 'zai-coding-cn',
      name: 'glm-5.3',
      api: 'openai-completions',
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    });

    expect(isDegradedFallbackModel(fallback)).toBe(true);
    expect(isDegradedFallbackModel(catalogHit)).toBe(false);
    expect(isDegradedFallbackModel(cloned)).toBe(false);
  });
});
