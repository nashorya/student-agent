import { describe, expect, it, vi } from 'vitest';
import { clearTerminalViewport } from '../terminal.js';

describe('clearTerminalViewport', () => {
  it('clears the visible terminal viewport for TTY output', () => {
    const output = {
      isTTY: true,
      write: vi.fn(),
    };

    clearTerminalViewport(output);

    expect(output.write).toHaveBeenCalledWith('\x1b[0m\x1b[?25h\x1b[r\x1b[2J\x1b[3J\x1b[H');
  });

  it('does not write ANSI clear codes for non-TTY output', () => {
    const output = {
      isTTY: false,
      write: vi.fn(),
    };

    clearTerminalViewport(output);

    expect(output.write).not.toHaveBeenCalled();
  });
});
