import { describe, expect, it } from 'vitest';
import {
  createInputGate,
  filterIncomingChunk,
  isTerminalJunkInput,
  scrubComposerBuffer,
} from '../scrub-input.js';

describe('scrubComposerBuffer', () => {
  it('removes full SGR mouse sequences', () => {
    expect(scrubComposerBuffer('\x1b[<65;32;14M')).toBe('');
    expect(scrubComposerBuffer('\x1b[<35;83;22mhello')).toBe('hello');
  });

  it('removes ESC-less mouse remnants', () => {
    expect(scrubComposerBuffer('[<65;32;14M[<35;32;14M')).toBe('');
  });

  it('removes arrow CSI and caret spam', () => {
    expect(scrubComposerBuffer('\x1b[B\x1b[A试，你随便')).toBe('试，你随便');
    expect(scrubComposerBuffer('[B[A试，你随便')).toBe('试，你随便');
    expect(scrubComposerBuffer('指定定个计划[C[C[C')).toBe('指定定个计划');
    expect(scrubComposerBuffer('^[[B^[[A试，你随便')).toBe('试，你随便');
    expect(scrubComposerBuffer('^[[B^[[B^[[A^[[A^[[B')).toBe('');
    expect(scrubComposerBuffer('^[ [B^[ [A')).toBe('');
  });

  it('preserves normal user text and code-like [A]', () => {
    expect(scrubComposerBuffer('hello world')).toBe('hello world');
    expect(scrubComposerBuffer('arr[A]')).toBe('arr[A]');
    expect(scrubComposerBuffer('[not a mouse]')).toBe('[not a mouse]');
  });
});

describe('filterIncomingChunk', () => {
  it('tags vertical arrows as scroll', () => {
    expect(filterIncomingChunk('\x1b[A')).toEqual({ action: 'scroll', dir: 'up' });
    expect(filterIncomingChunk('\x1b[B')).toEqual({ action: 'scroll', dir: 'down' });
  });

  it('passes horizontal CSI through', () => {
    expect(filterIncomingChunk('\x1b[C')).toEqual({ action: 'pass', data: '\x1b[C' });
    expect(filterIncomingChunk('\x1b[D')).toEqual({ action: 'pass', data: '\x1b[D' });
  });

  it('consumes mouse CSI and remnants', () => {
    expect(filterIncomingChunk('\x1b[<65;32;14M')).toEqual({ action: 'consume' });
    expect(filterIncomingChunk('[A')).toEqual({ action: 'scroll', dir: 'up' });
    expect(filterIncomingChunk('^[[A')).toEqual({ action: 'scroll', dir: 'up' });
    expect(isTerminalJunkInput('^[[C')).toBe(true);
  });

  it('keeps normal text', () => {
    expect(filterIncomingChunk('你好')).toEqual({ action: 'pass', data: '你好' });
  });
});

describe('createInputGate', () => {
  it('assembles split CSI arrows and scrolls', () => {
    const gate = createInputGate({ escTimeoutMs: 20 });
    expect(gate.feed('\x1b')).toEqual({ action: 'consume' });
    expect(gate.feed('[B')).toEqual({ action: 'scroll', dir: 'down' });
  });

  it('assembles split caret arrows', () => {
    const gate = createInputGate();
    expect(gate.feed('^')).toEqual({ action: 'consume' });
    expect(gate.feed('[')).toEqual({ action: 'consume' });
    expect(gate.feed('[A')).toEqual({ action: 'scroll', dir: 'up' });
  });

  it('treats timed-out lone ESC as Escape', async () => {
    const gate = createInputGate({ escTimeoutMs: 15 });
    expect(gate.feed('\x1b')).toEqual({ action: 'consume' });
    await new Promise((r) => setTimeout(r, 40));
    expect(gate.pollEscape()).toBe(true);
    expect(gate.pollEscape()).toBe(false);
  });
});
