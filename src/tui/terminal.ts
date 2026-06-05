interface WritableTerminal {
  isTTY?: boolean;
  write: (chunk: string) => unknown;
}

export function clearTerminalViewport(output: WritableTerminal = process.stdout): void {
  if (output.isTTY) {
    output.write('\x1b[0m\x1b[?25h\x1b[r\x1b[2J\x1b[3J\x1b[H');
  }
}
