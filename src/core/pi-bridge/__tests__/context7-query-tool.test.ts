import { describe, expect, it, vi } from 'vitest';
import type { Context7DocsResult } from '../../../knowledge/context7-client.js';
import { createContext7QueryToolDefinition } from '../context7-query-tool.js';

const DOCS: Context7DocsResult = {
  libraryId: '/facebook/react',
  topic: 'hooks',
  content: 'useState lets you add state to a component.',
  source: 'context7',
};

describe('context7_query tool', () => {
  it('returns docs text on successful query and fires onCall only', async () => {
    const query = vi.fn().mockResolvedValue(DOCS);
    const onCall = vi.fn();
    const onFailure = vi.fn();
    const tool = createContext7QueryToolDefinition({ client: { query }, onCall, onFailure });

    const result = await tool.execute('call-1', { library: 'react', topic: 'hooks' });

    expect(tool.name).toBe('context7_query');
    expect(query).toHaveBeenCalledWith({ libraryName: 'react', topic: 'hooks' });
    expect(result.content).toEqual([{ type: 'text', text: DOCS.content }]);
    expect(onCall).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('degrades to No documentation available. when query throws; never throws from execute', async () => {
    const query = vi.fn().mockRejectedValue(new Error('network down'));
    const onCall = vi.fn();
    const onFailure = vi.fn();
    const tool = createContext7QueryToolDefinition({ client: { query }, onCall, onFailure });

    const result = await tool.execute('call-2', { library: 'react' });

    expect(result.content).toEqual([{ type: 'text', text: 'No documentation available.' }]);
    expect(onCall).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('degrades when query returns null', async () => {
    const query = vi.fn().mockResolvedValue(null);
    const onCall = vi.fn();
    const onFailure = vi.fn();
    const tool = createContext7QueryToolDefinition({ client: { query }, onCall, onFailure });

    const result = await tool.execute('call-3', { library: 'missing-lib' });

    expect(result.content).toEqual([{ type: 'text', text: 'No documentation available.' }]);
    expect(onCall).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('degrades when no client is provided', async () => {
    const onCall = vi.fn();
    const onFailure = vi.fn();
    const tool = createContext7QueryToolDefinition({ onCall, onFailure });

    const result = await tool.execute('call-4', { library: 'react' });

    expect(result.content).toEqual([{ type: 'text', text: 'No documentation available.' }]);
    expect(onCall).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('degrades when query returns empty content', async () => {
    const query = vi.fn().mockResolvedValue({ ...DOCS, content: '   ' });
    const onCall = vi.fn();
    const onFailure = vi.fn();
    const tool = createContext7QueryToolDefinition({ client: { query }, onCall, onFailure });

    const result = await tool.execute('call-5', { library: 'react' });

    expect(result.content).toEqual([{ type: 'text', text: 'No documentation available.' }]);
    expect(onCall).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });
});
