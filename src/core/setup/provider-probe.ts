export interface ProbeOpenAiCompatibleModelsOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type ProbeOpenAiCompatibleModelsResult =
  | { ok: true; models: string[]; endpoint: string }
  | { ok: false; error: string; endpoint?: string };

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_MODELS = 200;

/**
 * Probe an OpenAI-compatible endpoint via GET {baseUrl}/models.
 * Used for custom providers only — builtin registry catalogs stay static.
 */
export async function probeOpenAiCompatibleModels(
  options: ProbeOpenAiCompatibleModelsOptions,
): Promise<ProbeOpenAiCompatibleModelsResult> {
  const baseUrl = normalizeOpenAiCompatibleBaseUrl(options.baseUrl);
  if (!baseUrl) {
    return { ok: false, error: 'Base URL 为空' };
  }
  if (!options.apiKey.trim()) {
    return { ok: false, error: 'API Key 为空' };
  }

  const endpoint = `${baseUrl}/models`;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: '当前运行时不支持 fetch', endpoint };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await readErrorDetail(response);
      return {
        ok: false,
        error: `HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
        endpoint,
      };
    }

    const payload = await response.json() as unknown;
    const models = extractModelIds(payload).slice(0, MAX_MODELS);
    if (models.length === 0) {
      return { ok: false, error: '响应中没有模型列表', endpoint };
    }
    return { ok: true, models, endpoint };
  } catch (err) {
    if (isAbortError(err)) {
      return { ok: false, error: `超时（>${timeoutMs}ms）`, endpoint };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      endpoint,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeOpenAiCompatibleBaseUrl(raw: string): string | undefined {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return undefined;
  try {
    // Validate absolute URL
    // eslint-disable-next-line no-new
    new URL(trimmed);
  } catch {
    return undefined;
  }
  return trimmed;
}

export function extractModelIds(payload: unknown): string[] {
  const ids: string[] = [];

  const push = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) {
      ids.push(value.trim());
      return;
    }
    if (value && typeof value === 'object' && 'id' in value) {
      const id = (value as { id?: unknown }).id;
      if (typeof id === 'string' && id.trim()) {
        ids.push(id.trim());
      }
    }
  };

  if (Array.isArray(payload)) {
    for (const item of payload) push(item);
  } else if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.data)) {
      for (const item of record.data) push(item);
    }
    if (Array.isArray(record.models)) {
      for (const item of record.models) push(item);
    }
  }

  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

async function readErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const text = (await response.text()).trim();
    if (!text) return undefined;
    return text.length > 180 ? `${text.slice(0, 180)}…` : text;
  } catch {
    return undefined;
  }
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === 'AbortError')
    || (typeof err === 'object' && err !== null && 'name' in err && (err as { name: string }).name === 'AbortError')
  );
}
