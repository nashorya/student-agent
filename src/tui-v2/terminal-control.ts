import stringWidth from 'string-width';

export const CLEAR_VIEWPORT_SEQUENCE = '\x1b[0m\x1b[?7h\x1b[?25h\x1b[r\x1b[2J\x1b[3J\x1b[H';
export const AUTOWRAP_DISABLE_SEQUENCE = '\x1b[?7l';
export const AUTOWRAP_ENABLE_SEQUENCE = '\x1b[?7h';
export const BRACKETED_PASTE_ENABLE_SEQUENCE = '\x1b[?2004h';
export const BRACKETED_PASTE_DISABLE_SEQUENCE = '\x1b[?2004l';
export const ENTER_VIEW_SEQUENCE = BRACKETED_PASTE_ENABLE_SEQUENCE;
export const EXIT_VIEW_SEQUENCE = `${BRACKETED_PASTE_DISABLE_SEQUENCE}${CLEAR_VIEWPORT_SEQUENCE}`;

export interface TerminalWriter {
  columns: number;
  rows: number;
  isTTY?: boolean;
  write: (chunk: string) => void;
}

export function clearViewport(writer: TerminalWriter): void {
  if (writer.isTTY === false) return;
  writer.write(CLEAR_VIEWPORT_SEQUENCE);
}

export function enterView(writer: TerminalWriter): void {
  if (writer.isTTY === false) return;
  writer.write(ENTER_VIEW_SEQUENCE);
}

export function moveCursor(writer: TerminalWriter, row: number, column: number): void {
  writer.write(`\x1b[${Math.max(1, row)};${Math.max(1, column)}H`);
}

export function exitView(writer: TerminalWriter): void {
  if (writer.isTTY === false) return;
  writer.write(EXIT_VIEW_SEQUENCE);
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

export function visibleLength(text: string): number {
  return stringWidth(stripAnsi(text));
}

export function padLine(line: string, width: number): string {
  const missing = width - visibleLength(line);
  return missing > 0 ? line + ' '.repeat(missing) : line;
}
