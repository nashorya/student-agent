import {
  AUTOWRAP_DISABLE_SEQUENCE,
  AUTOWRAP_ENABLE_SEQUENCE,
  clearViewport,
  padLine,
  type TerminalWriter,
} from './terminal-control.js';

interface FrameRecorder {
  setFrame?: (lines: string[]) => void;
}

export class LineRenderer {
  private previousLines: string[] = [];

  constructor(private readonly terminal: TerminalWriter) {}

  render(lines: string[]): void {
    const width = Math.max(1, this.terminal.columns || 80);
    const nextLines = lines.map((line) => padLine(line, width));
    const rowCount = Math.max(this.previousLines.length, nextLines.length);

    this.terminal.write(AUTOWRAP_DISABLE_SEQUENCE);
    try {
      for (let row = 0; row < rowCount; row++) {
        const nextLine = nextLines[row] ?? ' '.repeat(width);
        if (nextLine === this.previousLines[row]) continue;
        this.terminal.write(`\x1b[${row + 1};1H\x1b[2K${nextLine}`);
      }
    } finally {
      this.terminal.write(AUTOWRAP_ENABLE_SEQUENCE);
    }

    this.previousLines = nextLines;
    (this.terminal as FrameRecorder).setFrame?.(nextLines);
  }

  clear(): void {
    clearViewport(this.terminal);
    this.previousLines = [];
    (this.terminal as FrameRecorder).setFrame?.([]);
  }
}
