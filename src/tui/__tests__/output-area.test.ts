import { describe, expect, it } from 'vitest';
import { buildVisibleOutputLines, formatStreamingAssistantStatus } from '../components/OutputArea.js';
import type { Message } from '../state.js';

function message(role: Message['role'], content: string, timestamp: number): Message {
  return { id: `msg_${timestamp}`, role, content, timestamp };
}

describe('buildVisibleOutputLines', () => {
  it('aligns multiline message continuations under the content column', () => {
    const lines = buildVisibleOutputLines([
      message('system', 'line one\nline two', 1),
    ], 10);

    expect(lines).toMatchObject([
      { prefix: '✓ ', content: 'line one' },
      { prefix: '  ', content: 'line two' },
    ]);
  });

  it('keeps the tail of long output within the visible row budget', () => {
    const lines = buildVisibleOutputLines([
      message('user', 'first', 1),
      message('system', 'second\nthird\nfourth', 2),
    ], 3);

    expect(lines).toHaveLength(3);
    expect(lines).toMatchObject([
      { prefix: '… ', content: 'second' },
      { prefix: '  ', content: 'third' },
      { prefix: '  ', content: 'fourth' },
    ]);
  });

  it('wraps long content before applying the visible row budget', () => {
    const lines = buildVisibleOutputLines([
      message('system', 'alpha beta gamma delta', 1),
    ], 10, 14);

    expect(lines).toMatchObject([
      { prefix: '✓ ', content: 'alpha beta' },
      { prefix: '  ', content: 'gamma' },
      { prefix: '  ', content: 'delta' },
    ]);
  });

  it('renders markdown in system messages before wrapping', () => {
    const lines = buildVisibleOutputLines([
      message('system', '**关键发现：** `RiskGuard` 已启用', 1),
    ], 10, 60);

    expect(lines.map((line) => line.content).join('\n')).toContain('关键发现： RiskGuard 已启用');
    expect(lines.map((line) => line.content).join('\n')).not.toContain('**');
    expect(lines.map((line) => line.content).join('\n')).not.toContain('`');
  });

  it('streaming assistant status does not include full assistant content', () => {
    const status = formatStreamingAssistantStatus('完整回复内容不应该在流式动态区里渲染');

    expect(status).toContain('正在生成回复');
    expect(status).not.toContain('完整回复内容');
  });

  it('hard-wraps CJK content with no whitespace at column boundary', () => {
    // 终端 14 列：prefix "✓ " 占 2，content 区 10 列；中文双宽 → 每行至多 5 个汉字。
    const lines = buildVisibleOutputLines([
      message('system', '我可以做语法级别的分析类型检查', 1),
    ], 10, 14);

    // 每行可见宽度都不应超过 10。
    for (const line of lines) {
      const width = [...line.content].reduce((sum, ch) => {
        // 简易宽度估算：CJK 算 2，其它算 1
        return sum + (/[　-鿿＀-￯]/u.test(ch) ? 2 : 1);
      }, 0);
      expect(width).toBeLessThanOrEqual(10);
    }
    // 应该至少被拆成 2 行
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // 合起来必须保留全部字符
    expect(lines.map((l) => l.content).join('')).toBe('我可以做语法级别的分析类型检查');
  });

  it('mixed CJK + ASCII line is wrapped without eating characters', () => {
    const lines = buildVisibleOutputLines([
      message('system', '我用 bash 跑测试或构建命令然后读输出', 1),
    ], 10, 18); // content width = 18-2-2 = 14

    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.map((l) => l.content).join('')).toContain('bash');
    expect(lines.map((l) => l.content).join('')).toContain('读输出');
  });
});
