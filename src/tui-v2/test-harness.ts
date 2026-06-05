import type { TerminalWriter } from './terminal-control.js';

export interface FakeTerminal extends TerminalWriter {
  output: () => string;
  lastFrame: () => string[];
  setFrame: (lines: string[]) => void;
}

export function createFakeTerminal(options: { columns: number; rows: number }): FakeTerminal {
  const writes: string[] = [];
  let frame: string[] = [];

  return {
    columns: options.columns,
    rows: options.rows,
    isTTY: true,
    write(chunk) {
      writes.push(chunk);
    },
    output() {
      return writes.join('');
    },
    lastFrame() {
      return frame;
    },
    setFrame(lines) {
      frame = [...lines];
    },
  };
}
