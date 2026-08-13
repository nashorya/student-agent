import { describe, expect, it } from 'vitest';
import {
  classifyShellShortcut,
  createInputGate,
  filterIncomingChunk,
  isTerminalJunkInput,
  scrubComposerBuffer,
} from '../scrub-input.js';

describe('classifyShellShortcut', () => {
  it('routes Ctrl+C and Ctrl+P press events after CSI-u filtering', () => {
    expect(classifyShellShortcut('\x03')).toBe('exit');
    expect(classifyShellShortcut('\x10')).toBe('cycle-overlay');
    expect(classifyShellShortcut('\x1b[99;5u')).toBe('exit');
    expect(classifyShellShortcut('\x1b[112;5u')).toBe('cycle-overlay');
    expect(classifyShellShortcut('\x1b[27;5;99~')).toBe('exit');
    expect(classifyShellShortcut('\x1b[27;5;112~')).toBe('cycle-overlay');
  });

  it('consumes shortcut repeats and releases without firing the action again', () => {
    expect(classifyShellShortcut('\x1b[99;5:2u')).toBe('consume');
    expect(classifyShellShortcut('\x1b[99;5:3u')).toBe('consume');
    expect(classifyShellShortcut('\x1b[112;5:2u')).toBe('consume');
    expect(classifyShellShortcut('\x1b[112;5:3u')).toBe('consume');
  });

  it('leaves editor shortcuts to the editor', () => {
    expect(classifyShellShortcut('\x1b[97;5u')).toBeNull();
    expect(classifyShellShortcut('\x1b[120;5u')).toBeNull();
    expect(classifyShellShortcut('\x1b[97;3u')).toBeNull();
  });
});

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

  it('passes CSI-u key events through for shortcut and editor handling', () => {
    expect(filterIncomingChunk('\x1b[97u')).toEqual({
      action: 'pass',
      data: '\x1b[97u',
    });
    expect(filterIncomingChunk('\x1b[99;5u')).toEqual({
      action: 'pass',
      data: '\x1b[99;5u',
    });
    expect(filterIncomingChunk('\x1b[99;5:2u')).toEqual({
      action: 'pass',
      data: '\x1b[99;5:2u',
    });
    expect(filterIncomingChunk('\x1b[99;5:3u')).toEqual({
      action: 'pass',
      data: '\x1b[99;5:3u',
    });
    expect(filterIncomingChunk('\x1b[97;3u')).toEqual({
      action: 'pass',
      data: '\x1b[97;3u',
    });
  });

  it('normalizes caret CSI-u into a real terminal key event', () => {
    expect(filterIncomingChunk('^[[99;5u')).toEqual({
      action: 'replace',
      data: '\x1b[99;5u',
    });
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

  it('assembles split CSI-u without swallowing the shortcut', () => {
    const gate = createInputGate();
    expect(gate.feed('\x1b')).toEqual({ action: 'consume' });
    expect(gate.feed('[99;5u')).toEqual({
      action: 'pass',
      data: '\x1b[99;5u',
    });
  });

  it('assembles split caret arrows', () => {
    const gate = createInputGate();
    expect(gate.feed('^')).toEqual({ action: 'consume' });
    expect(gate.feed('[')).toEqual({ action: 'consume' });
    expect(gate.feed('[A')).toEqual({ action: 'scroll', dir: 'up' });
  });

  it('assembles split caret CSI-u into a real terminal key event', () => {
    const gate = createInputGate();
    expect(gate.feed('^')).toEqual({ action: 'consume' });
    expect(gate.feed('[')).toEqual({ action: 'consume' });
    expect(gate.feed('[99;5u')).toEqual({
      action: 'replace',
      data: '\x1b[99;5u',
    });
  });

  it('treats timed-out lone ESC as Escape', async () => {
    const gate = createInputGate({ escTimeoutMs: 15 });
    expect(gate.feed('\x1b')).toEqual({ action: 'consume' });
    await new Promise((r) => setTimeout(r, 40));
    expect(gate.pollEscape()).toBe(true);
    expect(gate.pollEscape()).toBe(false);
  });
});
