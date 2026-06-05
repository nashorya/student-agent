import { describe, expect, it, vi } from 'vitest';
import { CURSOR_MARKER } from '@earendil-works/pi-tui';
import { createPiTUIV2ForTest } from '../pi-runtime.js';
import { stripAnsi } from '../terminal-control.js';

describe('Pi-backed startTUIV2 runtime', () => {
  it('renders clean status and input frame on start', async () => {
    const handle = createPiTUIV2ForTest({
      columns: 40,
      rows: 5,
      onSubmit: vi.fn(),
      onAbort: vi.fn(),
    });

    await handle.flush();

    expect(handle.frame().at(-2)).toContain('student-agent');
    expect(handle.frame().at(-1)).toContain('> ');
    expect(handle.output()).toContain('\x1b[?2026h');
    expect(handle.output()).toContain('\x1b[3G');
    handle.unmount();
  });

  it('redraws a clean frame after clear', async () => {
    const handle = createPiTUIV2ForTest({
      columns: 40,
      rows: 5,
      onSubmit: vi.fn(),
      onAbort: vi.fn(),
    });
    await handle.flush();

    handle.bridge.addMessage('user', 'hello');
    handle.bridge.setStatus('busy');
    handle.bridge.dispatch({ type: 'SET_INPUT', value: 'draft', cursor: 5 });
    handle.bridge.clear?.();
    await handle.flush();

    expect(handle.output()).toContain('\x1b[2J\x1b[H\x1b[3J');
    expect(handle.frame().at(-2)).toContain('student-agent');
    expect(handle.frame().at(-1)).toContain('> ');
    expect(handle.output()).toContain('\x1b[3G');
    expect(handle.frame().join('\n')).not.toContain('hello');
    expect(handle.frame().join('\n')).not.toContain('draft');
    handle.unmount();
  });

  it('places the cursor using terminal cell width for wide input', async () => {
    const handle = createPiTUIV2ForTest({
      columns: 40,
      rows: 5,
      onSubmit: vi.fn(),
      onAbort: vi.fn(),
    });
    await handle.flush();

    handle.receiveInput('你好');
    await handle.flush();

    expect(handle.frame().at(-1)).toContain('> 你好');
    expect(handle.output()).toContain('\x1b[7G');
    handle.unmount();
  });

  it('moves the visible cursor left inside a long pasted input', async () => {
    const handle = createPiTUIV2ForTest({
      columns: 12,
      rows: 5,
      onSubmit: vi.fn(),
      onAbort: vi.fn(),
    });
    await handle.flush();

    handle.receiveInput('\x1b[200~abcdefghijklmnopqrstuvwxyz\x1b[201~');
    handle.receiveInput('\x1b[D');
    await handle.flush();

    const output = handle.output();
    expect(output).toContain('\x1b[7mz');
    expect(output).not.toContain(CURSOR_MARKER);
    expect(output).not.toContain('\x1b[?25h');
    expect(stripAnsi(output)).toContain('klmnopqrst');
    expect(stripAnsi(output)).toContain('uvwxyz');
    handle.unmount();
  });

  it('uses the input layer for promptSettings answers', async () => {
    const handle = createPiTUIV2ForTest({
      columns: 40,
      rows: 5,
      onSubmit: vi.fn(),
      onAbort: vi.fn(),
    });
    await handle.flush();

    const answer = handle.bridge.promptSettings('选择设置项');
    handle.receiveInput('2\n');
    await handle.flush();

    await expect(answer).resolves.toBe('2');
    expect(handle.frame().join('\n')).not.toContain('选择设置项');
    handle.unmount();
  });

  it('submits bracketed paste as one multiline value', async () => {
    const onSubmit = vi.fn();
    const handle = createPiTUIV2ForTest({
      columns: 40,
      rows: 5,
      onSubmit,
      onAbort: vi.fn(),
    });
    await handle.flush();

    handle.receiveInput('\x1b[200~第一行\n第二行\x1b[201~\n');
    await handle.flush();

    expect(onSubmit).toHaveBeenCalledWith('第一行\n第二行');
    handle.unmount();
  });

  it('does not render Kitty ctrl+c sequences as text', async () => {
    const onExit = vi.fn();
    const handle = createPiTUIV2ForTest({
      columns: 40,
      rows: 5,
      onSubmit: vi.fn(),
      onAbort: vi.fn(),
      onExit,
    });
    await handle.flush();

    handle.receiveInput('\x1b[99;5u');
    await handle.flush();

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(handle.frame().join('\n')).not.toContain('[99;5u');
    handle.unmount();
  });

  it('restores the terminal to a clean line on unmount', async () => {
    const handle = createPiTUIV2ForTest({
      columns: 40,
      rows: 5,
      onSubmit: vi.fn(),
      onAbort: vi.fn(),
    });
    await handle.flush();

    handle.receiveInput('11111');
    await handle.flush();
    handle.unmount();

    expect(handle.output()).toContain('\x1b[?25h');
    expect(handle.output()).toContain('\x1b[2J\x1b[3J\x1b[H');
  });
});
