import { describe, expect, it, vi } from 'vitest';
import {
  extractModelIds,
  normalizeOpenAiCompatibleBaseUrl,
  probeOpenAiCompatibleModels,
} from '../provider-probe.js';

describe('normalizeOpenAiCompatibleBaseUrl', () => {
  it('strips trailing slashes', () => {
    expect(normalizeOpenAiCompatibleBaseUrl('https://api.example.com/v1/')).toBe(
      'https://api.example.com/v1',
    );
  });

  it('rejects empty or invalid URLs', () => {
    expect(normalizeOpenAiCompatibleBaseUrl('')).toBeUndefined();
    expect(normalizeOpenAiCompatibleBaseUrl('not-a-url')).toBeUndefined();
  });
});

describe('extractModelIds', () => {
  it('reads OpenAI-style data[].id', () => {
    expect(extractModelIds({
      data: [{ id: 'b-model' }, { id: 'a-model' }, { id: 'a-model' }],
    })).toEqual(['a-model', 'b-model']);
  });

  it('reads models[] and bare string arrays', () => {
    expect(extractModelIds({ models: ['z', { id: 'y' }] })).toEqual(['y', 'z']);
    expect(extractModelIds(['m2', 'm1'])).toEqual(['m1', 'm2']);
  });
});

describe('probeOpenAiCompatibleModels', () => {
  it('returns sorted model ids from a successful probe', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://relay.example/v1/models');
      return new Response(JSON.stringify({
        data: [{ id: 'claude-sonnet-4-6' }, { id: 'gpt-4o' }],
      }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await probeOpenAiCompatibleModels({
      baseUrl: 'https://relay.example/v1/',
      apiKey: 'secret',
      fetchImpl,
    });

    expect(result).toEqual({
      ok: true,
      endpoint: 'https://relay.example/v1/models',
      models: ['claude-sonnet-4-6', 'gpt-4o'],
    });
  });

  it('surfaces HTTP errors', async () => {
    const fetchImpl = vi.fn(async () => new Response('invalid key', { status: 401 })) as unknown as typeof fetch;

    const result = await probeOpenAiCompatibleModels({
      baseUrl: 'https://relay.example/v1',
      apiKey: 'bad',
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('HTTP 401');
      expect(result.endpoint).toBe('https://relay.example/v1/models');
    }
  });

  it('surfaces network failures', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const result = await probeOpenAiCompatibleModels({
      baseUrl: 'https://relay.example/v1',
      apiKey: 'secret',
      fetchImpl,
    });

    expect(result).toMatchObject({ ok: false, error: 'ECONNREFUSED' });
  });
});
