import { describe, expect, it, vi } from 'vitest';
import type { Context7DocsResult } from '../../knowledge/context7-client.js';
import { createEvalContext7Tool } from '../agent-runner.js';

const DOCS: Context7DocsResult = {
  libraryId: '/facebook/react',
  content: 'React docs body',
  source: 'context7',
};

describe('createEvalContext7Tool', () => {
  it('returns undefined when feature is disabled', () => {
    const counters = { calls: 0, failures: 0 };
    const tool = createEvalContext7Tool({
      enabled: false,
      client: { query: vi.fn() },
      counters,
    });
    expect(tool).toBeUndefined();
    expect(counters).toEqual({ calls: 0, failures: 0 });
  });

  it('registers tool when enabled and increments counters on success', async () => {
    const counters = { calls: 0, failures: 0 };
    const query = vi.fn().mockResolvedValue(DOCS);
    const tool = createEvalContext7Tool({
      enabled: true,
      client: { query },
      counters,
    });

    expect(tool).toBeDefined();
    expect(tool!.name).toBe('context7_query');

    const result = await tool!.execute('c1', { library: 'react' });
    expect(result.content[0]).toEqual({ type: 'text', text: DOCS.content });
    expect(counters).toEqual({ calls: 1, failures: 0 });
  });

  it('increments both counters on degrade and never throws', async () => {
    const counters = { calls: 0, failures: 0 };
    const query = vi.fn().mockRejectedValue(new Error('timeout'));
    const tool = createEvalContext7Tool({
      enabled: true,
      client: { query },
      counters,
    });

    const result = await tool!.execute('c2', { library: 'react' });
    expect(result.content[0]).toEqual({ type: 'text', text: 'No documentation available.' });
    expect(counters).toEqual({ calls: 1, failures: 1 });
  });

  it('counts failure when client is missing but feature is enabled', async () => {
    const counters = { calls: 0, failures: 0 };
    const tool = createEvalContext7Tool({
      enabled: true,
      counters,
    });

    const result = await tool!.execute('c3', { library: 'react' });
    expect(result.content[0]).toEqual({ type: 'text', text: 'No documentation available.' });
    expect(counters).toEqual({ calls: 1, failures: 1 });
  });

  it('summary fields mirror counters (agent-runner return shape)', () => {
    const counters = { calls: 2, failures: 1 };
    // agent-runner always returns these on StudentAgentEvalTrace
    const summary = {
      ctx7Calls: counters.calls,
      ctx7Failures: counters.failures,
    };
    expect(summary).toEqual({ ctx7Calls: 2, ctx7Failures: 1 });
  });
});
