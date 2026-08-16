import { getModels, type Api, type Model } from '../pi-compat/index.js';
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

  const zaiGlm53 = resolveZaiGlm53Model(config, models);
  if (zaiGlm53) {
    return zaiGlm53;
  }

  return buildCompatibleFallback(config);
}

/**
 * pi-ai's zai/zai-coding-cn catalog stops at glm-5.2 (checked 2026-08-14), so
 * glm-5.3 would otherwise hit buildCompatibleFallback and silently lose
 * thinking support, the 1M context window, and the zai compat flags. Clone the
 * glm-5.2 entry until the upstream catalog ships glm-5.3.
 */
function resolveZaiGlm53Model(config: ModelConfig, models: Model<Api>[]): Model<Api> | undefined {
  if (config.name !== 'glm-5.3') {
    return undefined;
  }

  const base = models.find((candidate) => candidate.id === 'glm-5.2');
  if (!base) {
    return undefined;
  }

  return {
    ...base,
    id: 'glm-5.3',
    name: 'GLM-5.3',
    baseUrl: config.baseUrl ?? base.baseUrl,
  };
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

/**
 * True when the model came from buildCompatibleFallback, i.e. it was not found
 * in the pi-ai catalog and runs with degraded metadata (no thinking, 128k
 * window). Eval entry points use this to refuse silently-degraded runs.
 */
export function isDegradedFallbackModel(model: Model<Api>): boolean {
  return (model as Model<Api> & { degradedFallback?: true }).degradedFallback === true;
}

function buildCompatibleFallback(config: ModelConfig): Model<Api> & { degradedFallback: true } {
  return {
    degradedFallback: true,
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
