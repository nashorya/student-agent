import type { Api, Model } from '@mariozechner/pi-ai';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { installEvalProviderRequestPolicy } from '../provider-request-policy.js';

function glmModel(): Model<Api> {
  return {
    id: 'glm-5.2',
    provider: 'zhipu',
    api: 'openai-completions',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
  } as Model<Api>;
}

describe('eval provider request policy', () => {
  it('injects and audits the final GLM request body at the configured provider path', async () => {
    let sentBody = '';
    const realFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      sentBody = String(init?.body ?? '');
      return new Response(JSON.stringify({
        choices: [{ message: { reasoning_content: 'reasoning', content: 'answer' } }],
        usage: {
          prompt_tokens: 100,
          prompt_tokens_details: { cached_tokens: 25 },
          completion_tokens: 20,
          completion_tokens_details: { reasoning_tokens: 7 },
          total_tokens: 120,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const target = { fetch: realFetch as typeof globalThis.fetch };
    const handle = installEvalProviderRequestPolicy(glmModel(), target);

    await target.fetch('https://open.bigmodel.cn/api/coding/paas/v4/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'glm-5.2', temperature: 0.7, messages: [] }),
    });
    await handle.flush();

    expect(JSON.parse(sentBody)).toMatchObject({
      model: 'glm-5.2',
      thinking: { type: 'enabled' },
      temperature: 0,
      do_sample: false,
    });
    expect(handle.audit).toEqual([
      expect.objectContaining({
        index: 1,
        model: 'glm-5.2',
        thinking: { type: 'enabled' },
        temperature: 0,
        doSample: false,
        compliant: true,
        response: {
          httpStatus: 200,
          inspected: true,
          hasReasoningContent: true,
          reasoningChars: 9,
          promptTokens: 100,
          cachedPromptTokens: 25,
          completionTokens: 20,
          totalTokens: 120,
          reasoningTokens: 7,
        },
      }),
    ]);

    handle.restore();
    expect(target.fetch).toBe(realFetch);
  });

  it('appends one usage timeline JSONL record as each provider response is inspected', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'provider-usage-timeline-'));
    const usageTimelinePath = join(outputDir, 'usage-timeline.jsonl');
    const target = {
      fetch: vi.fn(async () => new Response(JSON.stringify({
        choices: [{ message: { content: 'answer' } }],
        usage: {
          prompt_tokens: 64000,
          prompt_tokens_details: { cached_tokens: 12000 },
          completion_tokens: 800,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof globalThis.fetch,
    };

    try {
      const handle = installEvalProviderRequestPolicy(glmModel(), target, { usageTimelinePath });
      await target.fetch('https://open.bigmodel.cn/api/coding/paas/v4/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'glm-5.2', messages: [] }),
      });
      await handle.flush();

      const lines = (await readFile(usageTimelinePath, 'utf8')).trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toEqual({
        seq: 1,
        ts: expect.any(String),
        promptTokens: 64000,
        cachedPromptTokens: 12000,
        completionTokens: 800,
      });
      expect(handle.usageTimeline).toEqual([JSON.parse(lines[0])]);
      handle.restore();
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('preserves missing provider usage as null instead of a successful zero-token response', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'provider-missing-usage-'));
    const usageTimelinePath = join(outputDir, 'usage-timeline.jsonl');
    const target = {
      fetch: vi.fn(async () => new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof globalThis.fetch,
    };

    try {
      const handle = installEvalProviderRequestPolicy(glmModel(), target, { usageTimelinePath });
      await target.fetch('https://open.bigmodel.cn/api/coding/paas/v4/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'glm-5.2', messages: [] }),
      });
      await handle.flush();

      expect(handle.usageTimeline[0]).toMatchObject({
        promptTokens: null,
        cachedPromptTokens: null,
        completionTokens: null,
      });
      handle.restore();
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('captures the first complete provider prompt after a marked compaction boundary', async () => {
    const target = {
      fetch: vi.fn(async () => new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof globalThis.fetch,
    };
    const handle = installEvalProviderRequestPolicy(glmModel(), target);
    handle.captureNextPrompt('phase:2');

    await target.fetch('https://open.bigmodel.cn/api/coding/paas/v4/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'glm-5.2',
        messages: [
          { role: 'system', content: 'Persistent constraints' },
          { role: 'user', content: 'Begin Phase 3' },
        ],
      }),
    });

    expect(JSON.parse(handle.postCompactionPrompts['phase:2'] ?? '')).toMatchObject({
      model: 'glm-5.2',
      thinking: { type: 'enabled' },
      temperature: 0,
      do_sample: false,
      messages: [
        { role: 'system', content: 'Persistent constraints' },
        { role: 'user', content: 'Begin Phase 3' },
      ],
    });
    handle.restore();
  });

  it('does not modify a request outside the pinned provider base path', async () => {
    let sentBody = '';
    const realFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      sentBody = String(init?.body ?? '');
      return new Response('{}', { status: 200 });
    });
    const target = { fetch: realFetch as typeof globalThis.fetch };
    const handle = installEvalProviderRequestPolicy(glmModel(), target);
    const body = JSON.stringify({ model: 'glm-5.2', temperature: 0.7 });

    await target.fetch('https://example.com/chat/completions', { method: 'POST', body });

    expect(sentBody).toBe(body);
    expect(handle.audit).toEqual([]);
    handle.restore();
  });

  it('detects reasoning evidence in a streamed provider response', async () => {
    const stream = [
      'data: {"choices":[{"delta":{"reasoning_content":"abc"}}]}',
      '',
      'data: {"choices":[],"usage":{"prompt_tokens":200,"prompt_tokens_details":{"cached_tokens":50},"completion_tokens":30,"completion_tokens_details":{"reasoning_tokens":5},"total_tokens":230}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const target = {
      fetch: vi.fn(async () => new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as typeof globalThis.fetch,
    };
    const handle = installEvalProviderRequestPolicy(glmModel(), target);

    await target.fetch('https://open.bigmodel.cn/api/coding/paas/v4/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'glm-5.2', messages: [] }),
    });
    await handle.flush();

    expect(handle.audit[0].response).toEqual({
      httpStatus: 200,
      inspected: true,
      hasReasoningContent: true,
      reasoningChars: 3,
      promptTokens: 200,
      cachedPromptTokens: 50,
      completionTokens: 30,
      totalTokens: 230,
      reasoningTokens: 5,
    });
    handle.restore();
  });

  it('records and rejects a request whose model differs from the pinned model', async () => {
    const target = {
      fetch: vi.fn(async () => new Response('{}', { status: 200 })) as typeof globalThis.fetch,
    };
    const handle = installEvalProviderRequestPolicy(glmModel(), target);

    await expect(target.fetch(
      'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
      { method: 'POST', body: JSON.stringify({ model: 'glm-5-air', messages: [] }) },
    )).rejects.toThrow('expected model glm-5.2, received glm-5-air');
    expect(handle.audit).toEqual([
      expect.objectContaining({ model: 'glm-5-air', compliant: false }),
    ]);
    handle.restore();
  });
});
