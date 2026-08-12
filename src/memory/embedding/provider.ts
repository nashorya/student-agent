import { logger } from '../../runtime/logger.js';
import type { EmbeddingProvider, RecallSimilarityProvider } from './types.js';

export interface OpenAICompatibleEmbeddingOptions {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  dimensions?: number;
}

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string;

  constructor(options: OpenAICompatibleEmbeddingOptions = {}) {
    this.baseUrl = options.baseUrl
      ?? process.env.STUDENT_AGENT_EMBEDDING_BASE_URL
      ?? process.env.OPENAI_BASE_URL
      ?? 'https://work.poloapi.com/v1';
    this.model = options.model
      ?? process.env.STUDENT_AGENT_EMBEDDING_MODEL
      ?? process.env.OPENAI_EMBEDDING_MODEL
      ?? 'text-embedding-3-small';
    this.apiKey = options.apiKey
      ?? process.env.STUDENT_AGENT_EMBEDDING_API_KEY
      ?? process.env.OPENAI_API_KEY
      ?? '';
    this.dimensions = options.dimensions ?? 1536;
  }

  get available(): boolean {
    return this.apiKey.length > 0;
  }

  async embed(text: string): Promise<number[]> {
    const [vector] = await this.requestEmbeddings(text);
    if (!vector) throw new Error('Embedding API response is missing data[0].embedding');
    return vector;
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return this.requestEmbeddings(texts);
  }

  private async requestEmbeddings(input: string | string[]): Promise<number[][]> {
    if (!this.apiKey) throw new Error('Embedding API key is not configured');
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => 'unknown error');
      throw new Error(`Embedding API failed: ${response.status} ${response.statusText} — ${detail}`);
    }
    const json = await response.json() as { data?: Array<{ embedding?: number[]; index?: number }> };
    const data = json.data ?? [];
    const vectors = [...data]
      .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
      .map((entry) => entry.embedding)
      .filter((entry): entry is number[] => Boolean(entry));
    const expected = typeof input === 'string' ? 1 : input.length;
    if (vectors.length !== expected) {
      throw new Error(`Embedding API response count mismatch: expected ${expected}, received ${vectors.length}`);
    }
    return vectors;
  }
}

export class EmbeddingRecallSimilarityProvider implements RecallSimilarityProvider {
  readonly source = 'embedding' as const;
  constructor(private readonly embeddings: EmbeddingProvider) {}

  async score(query: string, candidates: Array<{ id: string; text: string }>): Promise<Map<string, number>> {
    const texts = [query, ...candidates.map((candidate) => candidate.text)];
    const vectors = this.embeddings.embedMany
      ? await this.embeddings.embedMany(texts)
      : await Promise.all(texts.map((text) => this.embeddings.embed(text)));
    const [queryVector, ...candidateVectors] = vectors;
    if (!queryVector || candidateVectors.length !== candidates.length) {
      throw new Error('Embedding provider returned an incomplete batch');
    }
    const output = new Map<string, number>();
    for (const [index, candidate] of candidates.entries()) {
      output.set(candidate.id, cosineSimilarity(queryVector, candidateVectors[index]));
    }
    return output;
  }
}

export class LexicalRecallSimilarityProvider implements RecallSimilarityProvider {
  readonly source = 'lexical' as const;

  async score(query: string, candidates: Array<{ id: string; text: string }>): Promise<Map<string, number>> {
    const queryTokens = new Set(tokenize(query));
    return new Map(candidates.map((candidate) => {
      const candidateTokens = new Set(tokenize(candidate.text));
      if (queryTokens.size === 0 || candidateTokens.size === 0) return [candidate.id, 0];
      let overlap = 0;
      for (const token of queryTokens) if (candidateTokens.has(token)) overlap += 1;
      return [candidate.id, clamp(overlap / Math.sqrt(queryTokens.size * candidateTokens.size))];
    }));
  }
}

export class FallbackRecallSimilarityProvider implements RecallSimilarityProvider {
  private currentSource: 'embedding' | 'lexical' = 'embedding';
  get source(): 'embedding' | 'lexical' { return this.currentSource; }
  constructor(
    private readonly primary: RecallSimilarityProvider,
    private readonly fallback: RecallSimilarityProvider = new LexicalRecallSimilarityProvider(),
  ) {}

  async score(query: string, candidates: Array<{ id: string; text: string }>): Promise<Map<string, number>> {
    try {
      const scores = await this.primary.score(query, candidates);
      this.currentSource = this.primary.source ?? 'embedding';
      return scores;
    } catch (error) {
      logger.warn(`[Recall] embedding similarity unavailable; using lexical fallback: ${String(error)}`);
      this.currentSource = 'lexical';
      return this.fallback.score(query, candidates);
    }
  }
}

export function createDefaultRecallSimilarityProvider(): RecallSimilarityProvider {
  const embeddings = new OpenAICompatibleEmbeddingProvider();
  return embeddings.available
    ? new FallbackRecallSimilarityProvider(new EmbeddingRecallSimilarityProvider(embeddings))
    : new LexicalRecallSimilarityProvider();
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return clamp((dot / Math.sqrt(leftNorm * rightNorm) + 1) / 2);
}

function tokenize(text: string): string[] {
  return [...new Set(text.toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff_./-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2))];
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
