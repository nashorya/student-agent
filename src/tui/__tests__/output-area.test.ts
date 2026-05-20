import { describe, expect, it } from 'vitest';
import { buildVisibleOutputLines } from '../components/OutputArea.js';
import type { Message } from '../state.js';

function message(role: Message['role'], content: string, timestamp: number): Message {
  return { role, content, timestamp };
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
});
