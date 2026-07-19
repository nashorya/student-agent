import { getModels, type Api, type Model } from '@mariozechner/pi-ai';
import type { StudentAgentConfig } from './types.js';

type ModelConfig = StudentAgentConfig['model'];

export function resolveConfiguredModel(config: ModelConfig): Model<Api> {
  const models = getModels(config.provider as never) as Model<Api>[];
  const registered = models.find((candidate) => candidate.id === config.name);
  if (registered) {
    return { ...registered, baseUrl: config.baseUrl ?? registered.baseUrl };
  }

  const openRouterAnthropic = resolveOpenRouterAnthropicModel(config);
  if (openRouterAnthropic) {
    return openRouterAnthropic;
  }

  return buildCompatibleFallback(config);
}

function resolveOpenRouterAnthropicModel(config: ModelConfig): Model<Api> | undefined {
  if (config.provider !== 'openrouter' || config.name !== 'anthropic/claude-sonnet-4.6') {
    return undefined;
  }

  return {
    id: config.name,
    name: config.name,
    api: (config.api as Api | undefined) ?? 'openai-completions',
    provider: 'openrouter',
    baseUrl: config.baseUrl ?? 'https://openrouter.ai/api/v1',
    reasoning: true,
    input: ['text', 'image'],
    cost: {
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    },
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    // ZenMux/OpenRouter Anthropic path: enable Anthropic cache markers + 1h TTL
    // (pi-ai maps cacheRetention=long → cache_control.ttl=1h). Verified on ZenMux 2026-07-19.
    compat: {
      cacheControlFormat: 'anthropic',
      supportsLongCacheRetention: true,
      supportsDeveloperRole: false,
    },
  };
}

function buildCompatibleFallback(config: ModelConfig): Model<Api> {
  return {
    id: config.name,
    name: config.name,
    api: (config.api as Api | undefined) ?? 'openai-completions',
    provider: config.provider,
    baseUrl: config.baseUrl ?? 'https://api.openai.com/v1',
    reasoning: false,
    input: ['text', 'image'],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 128_000,
    maxTokens: 16_384,
    compat: {
      supportsDeveloperRole: false,
    },
  };
}
