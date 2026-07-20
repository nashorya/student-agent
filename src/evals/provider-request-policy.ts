import type { Api, Model } from '@mariozechner/pi-ai';
import { appendFile } from 'node:fs/promises';
import type {
  EvalProviderRequestAuditEntry,
  EvalProviderUsageTimelineEntry,
} from './types.js';

const GLM_THINKING_MODEL_PREFIX = 'glm-5';

export interface EvalProviderRequestPolicyHandle {
  audit: EvalProviderRequestAuditEntry[];
  usageTimeline: EvalProviderUsageTimelineEntry[];
  postCompactionPrompts: Record<string, string>;
  active: boolean;
  captureNextPrompt: (boundary: string) => void;
  flush: () => Promise<void>;
  restore: () => void;
}

interface FetchTarget {
  fetch: typeof globalThis.fetch;
}

interface EvalProviderRequestPolicyOptions {
  usageTimelinePath?: string;
  frozenSampling?: EvalFrozenSampling;
}

export interface EvalFrozenSampling {
  model: string;
  thinking: string;
  temperature: number;
  topP: number;
  maxTokens: number;
}

/**
 * Installs the eval-only provider policy at the final fetch boundary.
 *
 * Pi 0.73.1 does not reliably translate its model capability metadata into
 * Z.AI's request shape. Keeping this workaround here makes the exact bytes
 * sent by evals explicit without changing the product session or model registry.
 */
export function installEvalProviderRequestPolicy(
  model: Model<Api>,
  target: FetchTarget = globalThis,
  options: EvalProviderRequestPolicyOptions = {},
): EvalProviderRequestPolicyHandle {
  const audit: EvalProviderRequestAuditEntry[] = [];
  const usageTimeline: EvalProviderUsageTimelineEntry[] = [];
  const postCompactionPrompts: Record<string, string> = {};
  if (!model.id.startsWith(GLM_THINKING_MODEL_PREFIX)) {
    return {
      audit,
      usageTimeline,
      postCompactionPrompts,
      active: false,
      captureNextPrompt: () => undefined,
      flush: async () => undefined,
      restore: () => undefined,
    };
  }

  const expectedUrl = new URL(model.baseUrl);
  const realFetch = target.fetch;
  const pendingInspections = new Set<Promise<void>>();
  let pendingPromptBoundary: string | undefined;
  let restored = false;

  target.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const requestUrl = requestUrlOf(input);
    if (!isTargetProviderRequest(requestUrl, expectedUrl)) {
      return realFetch(input, init);
    }

    const originalBody = await requestBodyOf(input, init);
    const body = parseJsonObject(originalBody, requestUrl);
    const sampling = options.frozenSampling;
    body.thinking = { type: sampling?.thinking ?? 'enabled' };
    body.temperature = sampling?.temperature ?? 0;
    body.do_sample = false;
    if (sampling) {
      body.max_tokens = sampling.maxTokens;
      // The frozen table records the provider default but explicitly says the
      // runner does not send top_p; do_sample=false makes it non-operative.
      delete body.top_p;
    }
    if (pendingPromptBoundary !== undefined) {
      postCompactionPrompts[pendingPromptBoundary] = renderProviderPrompt(body);
      pendingPromptBoundary = undefined;
    }
    const error = requestPolicyError(body, sampling?.model ?? model.id, sampling);

    const auditEntry: EvalProviderRequestAuditEntry = {
      index: audit.length + 1,
      at: new Date().toISOString(),
      url: requestUrl,
      model: String(body.model),
      thinking: body.thinking,
      temperature: body.temperature,
      doSample: body.do_sample,
      compliant: error === undefined,
      ...(error ? { error } : {}),
    };
    audit.push(auditEntry);
    if (error) throw new Error(error);

    const nextBody = JSON.stringify(body);
    let response: Response;
    try {
      response = typeof input === 'string' || input instanceof URL || init?.body !== undefined
        ? await realFetch(input, { ...init, body: nextBody })
        : await realFetch(new Request(input, { ...init, body: nextBody }));
    } catch (fetchError) {
      auditEntry.response = {
        httpStatus: 0,
        inspected: false,
        hasReasoningContent: false,
        reasoningChars: 0,
        error: fetchError instanceof Error ? fetchError.message : String(fetchError),
      };
      throw fetchError;
    }
    const responseReceivedAt = new Date().toISOString();

    const inspection = inspectProviderResponse(response.clone())
      .then(async (evidence) => {
        auditEntry.response = evidence;
        await appendUsageTimeline(
          options.usageTimelinePath,
          usageTimeline,
          auditEntry.index,
          responseReceivedAt,
          evidence,
        );
      })
      .catch(async (inspectionError) => {
        const evidence = {
          httpStatus: response.status,
          inspected: false,
          hasReasoningContent: false,
          reasoningChars: 0,
          error: inspectionError instanceof Error ? inspectionError.message : String(inspectionError),
        };
        auditEntry.response = evidence;
        await appendUsageTimeline(
          options.usageTimelinePath,
          usageTimeline,
          auditEntry.index,
          responseReceivedAt,
          evidence,
        );
      });
    pendingInspections.add(inspection);
    void inspection.then(
      () => pendingInspections.delete(inspection),
      () => pendingInspections.delete(inspection),
    );
    return response;
  };

  return {
    audit,
    usageTimeline,
    postCompactionPrompts,
    active: true,
    captureNextPrompt: (boundary) => { pendingPromptBoundary = boundary; },
    flush: async () => {
      await Promise.all([...pendingInspections]);
    },
    restore: () => {
      if (restored) return;
      restored = true;
      target.fetch = realFetch;
    },
  };
}

function renderProviderPrompt(body: Record<string, unknown>): string {
  return JSON.stringify(body, null, 2);
}

async function appendUsageTimeline(
  path: string | undefined,
  timeline: EvalProviderUsageTimelineEntry[],
  seq: number,
  ts: string,
  response: NonNullable<EvalProviderRequestAuditEntry['response']>,
): Promise<void> {
  const entry: EvalProviderUsageTimelineEntry = {
    seq,
    ts,
    promptTokens: response.promptTokens ?? null,
    cachedPromptTokens: response.cachedPromptTokens ?? null,
    completionTokens: response.completionTokens ?? null,
  };
  timeline.push(entry);
  if (path) await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
}

async function inspectProviderResponse(
  response: Response,
): Promise<NonNullable<EvalProviderRequestAuditEntry['response']>> {
  const text = await response.text();
  const payloads = providerPayloads(text, response.headers.get('content-type'));
  let reasoningChars = 0;
  let promptTokens: number | undefined;
  let cachedPromptTokens: number | undefined;
  let completionTokens: number | undefined;
  let totalTokens: number | undefined;
  let reasoningTokens: number | undefined;
  for (const payload of payloads) {
    const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
    const message = choice && typeof choice === 'object'
      ? ((choice as { message?: unknown; delta?: unknown }).message ??
        (choice as { delta?: unknown }).delta)
      : undefined;
    if (message && typeof message === 'object') {
      const reasoning = (message as { reasoning_content?: unknown }).reasoning_content;
      if (typeof reasoning === 'string') reasoningChars += reasoning.length;
    }
    const usage = payload.usage;
    if (usage && typeof usage === 'object') {
      const usageRecord = usage as Record<string, unknown>;
      promptTokens = maxObservedNumber(promptTokens, usageRecord.prompt_tokens);
      completionTokens = maxObservedNumber(completionTokens, usageRecord.completion_tokens);
      totalTokens = maxObservedNumber(totalTokens, usageRecord.total_tokens);
      const promptDetails = usageRecord.prompt_tokens_details;
      if (promptDetails && typeof promptDetails === 'object') {
        cachedPromptTokens = maxObservedNumber(
          cachedPromptTokens,
          (promptDetails as Record<string, unknown>).cached_tokens,
        );
      }
      const completionDetails = usageRecord.completion_tokens_details;
      if (completionDetails && typeof completionDetails === 'object') {
        const tokens = (completionDetails as { reasoning_tokens?: unknown }).reasoning_tokens;
        if (typeof tokens === 'number') reasoningTokens = Math.max(reasoningTokens ?? 0, tokens);
      }
    }
  }
  return {
    httpStatus: response.status,
    inspected: true,
    hasReasoningContent: reasoningChars > 0 || (reasoningTokens ?? 0) > 0,
    reasoningChars,
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(cachedPromptTokens === undefined ? {} : { cachedPromptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
  };
}

function maxObservedNumber(current: number | undefined, value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(current ?? 0, value)
    : current;
}

function providerPayloads(text: string, contentType: string | null): Array<Record<string, unknown>> {
  const rawPayloads = contentType?.includes('text/event-stream')
    ? text.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== '[DONE]')
    : [text];
  const payloads: Array<Record<string, unknown>> = [];
  for (const raw of rawPayloads) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payloads.push(parsed as Record<string, unknown>);
      }
    } catch {
      // A malformed response is represented by an inspected response with no
      // reasoning evidence; the original response remains untouched for Pi.
    }
  }
  return payloads;
}

function requestUrlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isTargetProviderRequest(requestUrl: string, expectedBaseUrl: URL): boolean {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return false;
  }
  return parsed.origin === expectedBaseUrl.origin &&
    parsed.pathname.startsWith(normalizedBasePath(expectedBaseUrl.pathname));
}

function normalizedBasePath(pathname: string): string {
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

async function requestBodyOf(input: string | URL | Request, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body !== undefined) {
    throw new Error('Eval provider policy requires a JSON string request body');
  }
  if (input instanceof Request) return input.clone().text();
  throw new Error('Eval provider policy intercepted a provider request without a body');
}

function parseJsonObject(body: string, requestUrl: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`Eval provider policy intercepted non-JSON body for ${requestUrl}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Eval provider policy expected a JSON object body for ${requestUrl}`);
  }
  return parsed as Record<string, unknown>;
}

function requestPolicyError(
  body: Record<string, unknown>,
  expectedModel: string,
  sampling?: EvalFrozenSampling,
): string | undefined {
  const thinking = body.thinking;
  const expectedThinking = sampling?.thinking ?? 'enabled';
  const thinkingMatches = !!thinking && typeof thinking === 'object' &&
    !Array.isArray(thinking) && (thinking as { type?: unknown }).type === expectedThinking;
  if (body.model !== expectedModel) {
    return `Eval provider policy expected model ${expectedModel}, received ${String(body.model)}`;
  }
  if (!thinkingMatches || body.temperature !== (sampling?.temperature ?? 0) || body.do_sample !== false) {
    return 'Eval provider request does not match pinned thinking/temperature/do_sample policy';
  }
  if (sampling && (body.max_tokens !== sampling.maxTokens || body.top_p !== undefined)) {
    return 'Eval provider request does not match frozen max_tokens/top_p policy';
  }
  return undefined;
}
