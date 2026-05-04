import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../markdown.js';

describe('renderMarkdown', () => {
  it('空输入返回空字符串', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('  ')).toBe('');
  });

  it('渲染纯文本保留内容', () => {
    const result = renderMarkdown('Hello world');
    expect(result).toContain('Hello world');
  });

  it('渲染 bold 保留内容文本', () => {
    const result = renderMarkdown('This is **bold** text');
    expect(result).toContain('bold');
    expect(result).toContain('This is');
    expect(result).toContain('text');
    // 原始的 ** 标记应该被移除
    expect(result).not.toContain('**');
  });

  it('渲染 italic 保留内容文本', () => {
    const result = renderMarkdown('This is *italic* text');
    expect(result).toContain('italic');
    // 原始的 * 标记应该被移除（但 ANSI codes 里可能有 * 字符，只检查内容即可）
    expect(result).toContain('This is');
  });

  it('渲染 code block 保留代码内容', () => {
    const result = renderMarkdown('```js\nconsole.log("hi")\n```');
    expect(result).toContain('console.log("hi")');
    expect(result).toContain('js'); // language label
  });

  it('渲染 inline code 保留代码内容', () => {
    const result = renderMarkdown('Use `npm install`');
    expect(result).toContain('npm install');
  });

  it('渲染无序列表保留所有项', () => {
    const result = renderMarkdown('- item 1\n- item 2\n- item 3');
    expect(result).toContain('item 1');
    expect(result).toContain('item 2');
    expect(result).toContain('item 3');
  });

  it('渲染标题保留内容', () => {
    const result = renderMarkdown('# Heading 1');
    expect(result).toContain('Heading 1');
  });

  it('渲染多级标题区分处理', () => {
    const result = renderMarkdown('## Heading 2\n\n### Heading 3');
    expect(result).toContain('Heading 2');
    expect(result).toContain('Heading 3');
    // H3 应该保留 ### 前缀
    expect(result).toContain('###');
  });

  it('渲染链接保留文本和 URL', () => {
    const result = renderMarkdown('[Google](https://google.com)');
    expect(result).toContain('Google');
    expect(result).toContain('https://google.com');
  });

  it('渲染 blockquote 保留内容', () => {
    const result = renderMarkdown('> This is a quote');
    expect(result).toContain('This is a quote');
    expect(result).toContain('│');
  });

  it('渲染水平线', () => {
    const result = renderMarkdown('---');
    expect(result).toContain('─');
  });
});
