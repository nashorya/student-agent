import type { ProjectKbManager } from '../memory/project-kb/manager.js';
import { mergeValidation, validateRecord } from './mcp-schema-validator.js';

export interface Context7ClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxSearchResults?: number;
  maxDocsChars?: number;
  fetchFn?: typeof fetch;
  projectKb?: ProjectKbManager;
}

export interface Context7SearchResult {
  id: string;
  title: string;
  description?: string;
  trustScore?: number;
  totalTokens?: number;
  versions?: string[];
}

export interface Context7DocsRequest {
  libraryId: string;
  topic?: string;
  tokens?: number;
}

export interface Context7DocsResult {
  libraryId: string;
  topic?: string;
  content: string;
  source: 'context7';
}

export interface Context7QueryRequest {
  libraryName: string;
  topic?: string;
  tokens?: number;
}

export class Context7UnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'Context7UnavailableError';
  }
}

type JsonObject = Record<string, unknown>;

const DEFAULT_BASE_URL = 'https://context7.com';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_SEARCH_RESULTS = 5;
const DEFAULT_MAX_DOCS_CHARS = 6_000;

export class Context7Client {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxSearchResults: number;
  private readonly maxDocsChars: number;
  private readonly fetchFn: typeof fetch;
  private readonly projectKb?: ProjectKbManager;

  constructor(options: Context7ClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.CONTEXT7_API_KEY;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxSearchResults = options.maxSearchResults ?? DEFAULT_MAX_SEARCH_RESULTS;
    this.maxDocsChars = options.maxDocsChars ?? DEFAULT_MAX_DOCS_CHARS;
    this.fetchFn = options.fetchFn ?? fetch;
    this.projectKb = options.projectKb;
  }

  async query(request: Context7QueryRequest): Promise<Context7DocsResult | null> {
    const libraries = await this.searchLibraries(request.libraryName);
    const library = libraries[0];
    if (!library) {
      return null;
    }

    return this.getLibraryDocs({
      libraryId: library.id,
      topic: request.topic,
      tokens: request.tokens,
    });
  }

  async searchLibraries(query: string): Promise<Context7SearchResult[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return [];
    }

    try {
      return await this.searchLibrariesV2(normalizedQuery);
    } catch (err) {
      return this.searchLibrariesV1(normalizedQuery, err);
    }
  }

  async getLibraryDocs(request: Context7DocsRequest): Promise<Context7DocsResult> {
    const libraryId = request.libraryId.trim();
    if (!libraryId) {
      throw new Context7UnavailableError('Context7 libraryId 不能为空');
    }

    try {
      return await this.getLibraryDocsV2(libraryId, request);
    } catch (err) {
      return this.getLibraryDocsV1(libraryId, request, err);
    }
  }

  private async searchLibrariesV2(query: string): Promise<Context7SearchResult[]> {
    const url = this.makeUrl('/api/v2/libs/search');
    url.searchParams.set('libraryName', query);
    url.searchParams.set('query', query);
    const json = await this.fetchJson(url);
    return normalizeSearchResults(json).slice(0, this.maxSearchResults);
  }

  private async searchLibrariesV1(
    query: string,
    previousError: unknown,
  ): Promise<Context7SearchResult[]> {
    const url = this.makeUrl('/api/v1/search');
    url.searchParams.set('query', query);
    try {
      const json = await this.fetchJson(url);
      return normalizeSearchResults(json).slice(0, this.maxSearchResults);
    } catch (err) {
      throw new Context7UnavailableError('Context7 library search failed', err ?? previousError);
    }
  }

  private async getLibraryDocsV2(
    libraryId: string,
    request: Context7DocsRequest,
  ): Promise<Context7DocsResult> {
    const url = this.makeUrl('/api/v2/context');
    url.searchParams.set('libraryId', libraryId);
    url.searchParams.set('type', 'txt');
    if (request.topic) url.searchParams.set('query', request.topic);
    if (request.tokens) url.searchParams.set('tokens', String(request.tokens));

    const content = await this.fetchText(url);
    await this.cacheDocs({ libraryId, topic: request.topic, content });
    return {
      libraryId,
      topic: request.topic,
      content: this.trimDocs(content),
      source: 'context7',
    };
  }

  private async getLibraryDocsV1(
    libraryId: string,
    request: Context7DocsRequest,
    previousError: unknown,
  ): Promise<Context7DocsResult> {
    const url = this.makeUrl(`/api/v1/${encodeLibraryPath(libraryId)}`);
    url.searchParams.set('type', 'txt');
    if (request.topic) url.searchParams.set('topic', request.topic);
    if (request.tokens) url.searchParams.set('tokens', String(request.tokens));

    try {
      const content = await this.fetchText(url);
      await this.cacheDocs({ libraryId, topic: request.topic, content });
      return {
        libraryId,
        topic: request.topic,
        content: this.trimDocs(content),
        source: 'context7',
      };
    } catch (err) {
      throw new Context7UnavailableError('Context7 docs lookup failed', err ?? previousError);
    }
  }

  private async fetchJson(url: URL): Promise<unknown> {
    const response = await this.fetchWithTimeout(url);
    if (!response.ok) {
      throw new Context7UnavailableError(`Context7 returned HTTP ${response.status}`);
    }
    const json = await response.json() as unknown;
    const validation = validateContext7Payload(json);
    if (!validation.ok) {
      throw new Context7UnavailableError(`Context7 schema validation failed: ${validation.errors.join('; ')}`);
    }
    return validation.value;
  }

  private async fetchText(url: URL): Promise<string> {
    const response = await this.fetchWithTimeout(url);
    if (!response.ok) {
      throw new Context7UnavailableError(`Context7 returned HTTP ${response.status}`);
    }
    return response.text();
  }

  private async fetchWithTimeout(url: URL): Promise<Response> {
    try {
      return await this.fetchFn(url, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new Context7UnavailableError('Context7 request failed', err);
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain;q=0.9',
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private makeUrl(path: string): URL {
    return new URL(path, this.baseUrl);
  }

  private trimDocs(content: string): string {
    const normalized = content.trim();
    if (normalized.length <= this.maxDocsChars) {
      return normalized;
    }
    return `${normalized.slice(0, this.maxDocsChars).trimEnd()}\n\n[Context7 文档已截断]`;
  }

  private async cacheDocs(params: { libraryId: string; topic?: string; content: string }): Promise<void> {
    if (!this.projectKb) return;
    await this.projectKb.upsert({
      sourceUrl: `context7:${params.libraryId}${params.topic ? `#${params.topic}` : ''}`,
      title: params.topic ? `${params.libraryId} / ${params.topic}` : params.libraryId,
      content: this.trimDocs(params.content),
      versionHint: params.libraryId,
      ttlDays: 14,
    });
  }
}

export function validateContext7Payload(value: unknown) {
  if (Array.isArray(value)) {
    return mergeValidation(value, value.every(isJsonObject) ? [] : ['array items must be objects']);
  }
  const record = validateRecord(value, 'Context7 response');
  if (!record.ok || !record.value) return record;
  const payload = record.value;
  const hasKnownContainer = ['results', 'data', 'items', 'libraries'].some((key) => key in payload);
  return mergeValidation(payload, hasKnownContainer ? [] : ['missing result container']);
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function normalizeSearchResults(json: unknown): Context7SearchResult[] {
  const items = extractItems(json);
  return items
    .map(normalizeSearchResult)
    .filter((item): item is Context7SearchResult => item !== null);
}

function extractItems(json: unknown): unknown[] {
  if (Array.isArray(json)) {
    return json;
  }
  if (!isJsonObject(json)) {
    return [];
  }

  const candidates = [json.results, json.libraries, json.data, json.items];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

function normalizeSearchResult(item: unknown): Context7SearchResult | null {
  if (!isJsonObject(item)) {
    return null;
  }

  const id = readString(item.id) ?? readString(item.libraryId) ?? readString(item.context7CompatibleLibraryID);
  if (!id) {
    return null;
  }

  return {
    id,
    title: readString(item.title) ?? readString(item.name) ?? id,
    description: readString(item.description),
    trustScore: readNumber(item.trustScore) ?? readNumber(item.trust_score),
    totalTokens: readNumber(item.totalTokens) ?? readNumber(item.total_tokens),
    versions: readStringArray(item.versions),
  };
}

function encodeLibraryPath(libraryId: string): string {
  return libraryId
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter((item): item is string => typeof item === 'string');
  return strings.length ? strings : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
