/**
 * Stub implementations for stage-1.  Replace with real MCP integrations in stage 3.
 */

/**
 * Attempt to extract a search query from a raw error string.
 * Returns null when the error is too vague to produce a useful query.
 */
export function extractSearchIntent(failureReason: string): string | null {
  // Heuristic: pull the most informative token after known keywords.
  const patterns = [
    /(?:selector|locator)[:\s]+(['"`]?)([^'"`\s,]+)\1/i,
    /(?:module|package|import)[:\s]+['"`]?([^\s'"`]+)['"`]?/i,
    /(?:error|exception|failed)[:\s]+([A-Z][A-Za-z]+(?:Error|Exception))/,
    /cannot find\s+['"`]?([^\s'"`]+)['"`]?/i,
  ];

  for (const re of patterns) {
    const m = re.exec(failureReason);
    if (m) {
      const candidate = m[2] ?? m[1];
      if (candidate && candidate.length > 2) return candidate;
    }
  }

  return null;
}

export interface WebSearchResult {
  title: string;
  snippet: string;
  url: string;
}

/**
 * Stub Web Search MCP call. Always returns an empty array in stage 1.
 * Replace with real MCP invocation in stage 3.
 */
export async function stubWebSearchMCP(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _intent: string,
): Promise<WebSearchResult[]> {
  // TODO (stage 3): call Web Search MCP tool and return results
  return [];
}

export type RetryStrategy =
  | '降级重试'
  | '拆分重试'
  | '上下文复位'
  | '扩展思考';

/**
 * Stub retry-with-strategy. Always throws to simulate continued failure in stage 1.
 * Replace with real Planner/Executor integration in stage 2.
 */
export async function retryWithStrategy(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _strategy: RetryStrategy,
): Promise<void> {
  // TODO (stage 2): invoke Planner + Executor with the chosen strategy applied
  throw new Error('retryWithStrategy is not yet implemented (stage-1 stub)');
}

/**
 * Stub retry after web-search context injection. Always throws in stage 1.
 */
export async function retryWithSearchContext(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _results: WebSearchResult[],
): Promise<void> {
  // TODO (stage 3): inject search snippets into context and re-run Executor
  throw new Error('retryWithSearchContext is not yet implemented (stage-1 stub)');
}
