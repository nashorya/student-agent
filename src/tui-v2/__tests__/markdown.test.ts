import { describe, expect, it } from 'vitest';
import { renderMarkdownLines } from '../markdown.js';
import { stripAnsi, visibleLength } from '../terminal-control.js';

describe('renderMarkdownLines', () => {
  it('does not treat CLI menu 1) as an ordered list', () => {
    const lines = renderMarkdownLines('1) 模型\nq) 取消', { width: 40, streaming: false });
    const text = stripAnsi(lines.join('\n'));

    expect(text).toContain('1) 模型');
    expect(text).toContain('q) 取消');
    expect(text).not.toContain('1. 模型');
  });

  it('renders incomplete streaming code fence as stable code text', () => {
    const lines = renderMarkdownLines('```ts\nconst x = 1', { width: 40, streaming: true });
    const text = stripAnsi(lines.join('\n'));

    expect(text).toContain('┌─ ts');
    expect(text).toContain('const x = 1');
  });

  it('wraps long CJK content without losing characters', () => {
    const text = '我可以做语法级别的分析类型检查';
    const lines = renderMarkdownLines(text, { width: 10, streaming: false });

    expect(stripAnsi(lines.join(''))).toBe(text);
    for (const line of lines) expect(visibleLength(line)).toBeLessThanOrEqual(10);
  });

  it('removes markdown markers from committed formatted text', () => {
    const lines = renderMarkdownLines('This is **bold** text', { width: 40, streaming: false });
    const text = stripAnsi(lines.join('\n'));

    expect(text).toContain('bold');
    expect(text).not.toContain('**');
  });
});
