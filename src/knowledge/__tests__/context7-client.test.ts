import { describe, it, expect, vi } from 'vitest';
import { Context7Client } from '../context7-client.js';

describe('Context7Client', () => {
  it('query 使用 v2 search 和 v2 context，并携带 API key', async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{ id: '/reactjs/react.dev', title: 'React Docs' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('React hooks docs', { status: 200 }));

    const client = new Context7Client({
      apiKey: 'ctx7-key',
      fetchFn,
    });

    const result = await client.query({ libraryName: 'react', topic: 'hooks' });

    expect(result?.libraryId).toBe('/reactjs/react.dev');
    expect(result?.content).toBe('React hooks docs');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const firstCall = fetchFn.mock.calls[0];
    expect(String(firstCall[0])).toContain('/api/v2/libs/search');
    expect(firstCall[1]?.headers).toMatchObject({
      Authorization: 'Bearer ctx7-key',
    });
  });

  it('search v2 失败时降级到 v1 search', async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{ id: '/vitejs/vite', title: 'Vite' }],
      }), { status: 200 }));

    const client = new Context7Client({ fetchFn });

    await expect(client.searchLibraries('vite')).resolves.toEqual([
      { id: '/vitejs/vite', title: 'Vite' },
    ]);
    expect(String(fetchFn.mock.calls[1][0])).toContain('/api/v1/search');
  });

  it('docs v2 失败时降级到 v1 docs，并截断过长内容', async () => {
    const longContent = `${'x'.repeat(20)}\n`;
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
      .mockResolvedValueOnce(new Response(longContent, { status: 200 }));

    const client = new Context7Client({
      fetchFn,
      maxDocsChars: 10,
    });

    const result = await client.getLibraryDocs({
      libraryId: '/reactjs/react.dev',
      topic: 'hooks',
    });

    expect(String(fetchFn.mock.calls[1][0])).toContain('/api/v1/reactjs/react.dev');
    expect(result.content).toBe('xxxxxxxxxx\n\n[Context7 文档已截断]');
  });
});
