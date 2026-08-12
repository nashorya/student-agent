import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildCtx7RetryContext } from '../ctx7-retry-builder.js';

vi.mock('../../pi-compat/index.js', () => ({ completeSimple: vi.fn() }));
import { completeSimple } from '../../pi-compat/index.js';

const mockModel = { id: 'test', api: 'anthropic', provider: 'anthropic' } as any;

describe('buildCtx7RetryContext', () => {
  const mockCtx7 = { query: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries ctx7 with LLM-extracted keywords', async () => {
    vi.mocked(completeSimple).mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Taro 小程序 CSS 颜色渲染' }],
    } as any);
    mockCtx7.query.mockResolvedValueOnce({
      libraryId: '/taro/taro',
      content: '# Taro CSS\n不支持 CSS 变量...',
      source: 'context7',
    });

    const result = await buildCtx7RetryContext(
      '调整首页颜色',
      ['颜色不对', '还是灰色', '微信不渲染'],
      mockCtx7 as any,
      mockModel,
    );

    expect(mockCtx7.query).toHaveBeenCalledWith({
      libraryName: 'Taro 小程序 CSS 颜色渲染',
      topic: '调整首页颜色',
    });
    expect(result).toContain('不支持 CSS 变量');
  });

  it('returns empty string when ctx7 returns no docs', async () => {
    vi.mocked(completeSimple).mockResolvedValueOnce({
      content: [{ type: 'text', text: '关键词' }],
    } as any);
    mockCtx7.query.mockResolvedValueOnce(null);

    const result = await buildCtx7RetryContext('任务', ['反馈'], mockCtx7 as any, mockModel);
    expect(result).toBe('');
  });

  it('falls back to task name when LLM extraction fails', async () => {
    vi.mocked(completeSimple).mockRejectedValueOnce(new Error('LLM error'));
    mockCtx7.query.mockResolvedValueOnce({
      libraryId: '/lib/lib',
      content: '# Docs content',
      source: 'context7',
    });

    const result = await buildCtx7RetryContext('React hooks', ['error'], mockCtx7 as any, mockModel);

    expect(mockCtx7.query).toHaveBeenCalledWith({
      libraryName: 'React hooks',
      topic: 'React hooks',
    });
    expect(result).toContain('Docs content');
  });

  it('returns empty string when ctx7 query throws', async () => {
    vi.mocked(completeSimple).mockResolvedValueOnce({
      content: [{ type: 'text', text: 'keywords' }],
    } as any);
    mockCtx7.query.mockRejectedValueOnce(new Error('Network error'));

    const result = await buildCtx7RetryContext('task', ['feedback'], mockCtx7 as any, mockModel);
    expect(result).toBe('');
  });
});
