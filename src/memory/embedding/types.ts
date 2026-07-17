export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedMany?(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}

export interface RecallSimilarityProvider {
  readonly source?: 'embedding' | 'lexical';
  score(
    query: string,
    candidates: Array<{ id: string; text: string }>,
  ): Promise<Map<string, number>>;
}
