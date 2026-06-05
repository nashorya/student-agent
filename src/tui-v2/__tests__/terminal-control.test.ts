import { describe, expect, it } from 'vitest';
import { stripAnsi, visibleLength } from '../terminal-control.js';

describe('terminal-control width helpers', () => {
  it('counts CJK and emoji by terminal cell width', () => {
    expect(visibleLength('你好')).toBe(4);
    expect(visibleLength('👋')).toBe(2);
  });

  it('ignores ANSI escape sequences when measuring visible text', () => {
    expect(visibleLength('\x1b[36m你好\x1b[39m')).toBe(4);
    expect(stripAnsi('\x1b[36mhello\x1b[39m')).toBe('hello');
  });
});
