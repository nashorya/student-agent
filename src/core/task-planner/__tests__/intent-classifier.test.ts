import { describe, it, expect, vi } from 'vitest';
import { classifyIntent } from '../intent-classifier.js';

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: vi.fn(),
}));

import { completeSimple } from '@mariozechner/pi-ai';

const mockModel = { id: 'test', api: 'anthropic', provider: 'anthropic' } as any;

describe('classifyIntent', () => {
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
});
