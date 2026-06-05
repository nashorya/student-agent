import { describe, expect, it } from 'vitest';
import { createPasteBuffer } from '../paste-buffer.js';

describe('createPasteBuffer', () => {
  it('collects submitted lines between /paste and /end into one multiline message', () => {
    const buffer = createPasteBuffer();

    expect(buffer.handle('/paste')).toEqual({
      type: 'status',
      text: '粘贴模式：输入 /end 结束，/cancel 取消',
    });
    expect(buffer.handle('第一行')).toEqual({
      type: 'status',
      text: '粘贴模式：已收集 1 行，输入 /end 结束',
    });
    expect(buffer.handle('第二行')).toEqual({
      type: 'status',
      text: '粘贴模式：已收集 2 行，输入 /end 结束',
    });
    expect(buffer.handle('/end')).toEqual({
      type: 'submit',
      source: 'paste',
      value: '第一行\n第二行',
    });
  });

  it('passes ordinary input through when paste mode is inactive', () => {
    const buffer = createPasteBuffer();

    expect(buffer.handle('普通任务')).toEqual({
      type: 'submit',
      source: 'input',
      value: '普通任务',
    });
  });

  it('handles one-shot /paste blocks submitted as a single value', () => {
    const buffer = createPasteBuffer();

    expect(buffer.handle('/paste\n第一行\n第二行\n/end')).toEqual({
      type: 'submit',
      source: 'paste',
      value: '第一行\n第二行',
    });
  });

  it('keeps the first pasted line clean when /paste and content arrive together before /end', () => {
    const buffer = createPasteBuffer();

    expect(buffer.handle('/paste\n第一行')).toEqual({
      type: 'status',
      text: '粘贴模式：已收集 1 行，输入 /end 结束',
    });
    expect(buffer.handle('/end')).toEqual({
      type: 'submit',
      source: 'paste',
      value: '第一行',
    });
  });

  it('can cancel paste mode without submitting collected content', () => {
    const buffer = createPasteBuffer();

    buffer.handle('/paste');
    buffer.handle('不会提交');

    expect(buffer.handle('/cancel')).toEqual({
      type: 'status',
      text: '已取消粘贴',
    });
    expect(buffer.handle('下一条')).toEqual({
      type: 'submit',
      source: 'input',
      value: '下一条',
    });
  });

  it('marks pasted slash commands as paste content, not interactive commands', () => {
    const buffer = createPasteBuffer();

    buffer.handle('/paste');
    buffer.handle('/abort');

    expect(buffer.handle('/end')).toEqual({
      type: 'submit',
      source: 'paste',
      value: '/abort',
    });
  });
});
