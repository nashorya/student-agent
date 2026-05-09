import { beforeEach, describe, it, expect, vi } from 'vitest';
import { classifyIntent, isMetaQuestion } from '../intent-classifier.js';

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: vi.fn(),
}));

import { completeSimple } from '@mariozechner/pi-ai';

const mockModel = { id: 'test', api: 'anthropic', provider: 'anthropic' } as any;

describe('classifyIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns new_task with extracted name', async () => {
    vi.mocked(completeSimple).mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"type":"new_task","task_name":"修改首页颜色方案"}' }],
    } as any);
    const result = await classifyIntent('帮我改首页的颜色', null, mockModel);
    expect(result).toEqual({ type: 'new_task', taskName: '修改首页颜色方案' });
  });

  it('returns continue when LLM says continue', async () => {
    vi.mocked(completeSimple).mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"type":"continue"}' }],
    } as any);
    const result = await classifyIntent('好的，继续', '修改首页', mockModel);
    expect(result).toEqual({ type: 'continue' });
  });

  it('falls back to continue on LLM error', async () => {
    vi.mocked(completeSimple).mockRejectedValueOnce(new Error('network'));
    const result = await classifyIntent('随便说一句', null, mockModel);
    expect(result.type).toBe('continue');
  });

  it('short-circuits meta questions without calling LLM', async () => {
    const result = await classifyIntent('我想让你学习某个网站的设计，该怎么做', null, mockModel);

    expect(result).toEqual({ type: 'continue' });
    expect(completeSimple).not.toHaveBeenCalled();
  });
});

describe('isMetaQuestion', () => {
  it.each([
    '我想让你学习某个网站的设计，该怎么做',
    '怎么使用 design study 技能？',
    '你能不能学习网页风格？',
    '这个命令怎么触发',
  ])('detects meta question: %s', (input) => {
    expect(isMetaQuestion(input)).toBe(true);
  });

  it.each([
    '帮我改首页颜色',
    '实现登录页面',
    '修复 Failed to load 错误',
  ])('does not treat task request as meta question: %s', (input) => {
    expect(isMetaQuestion(input)).toBe(false);
  });
});
