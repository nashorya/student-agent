import { COMMAND_COMPLETIONS } from '../../cli/command-parser.js';

const DIM    = '\x1b[2m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';
const REVERSE = '\x1b[7m';

export function getCompletions(inputValue: string): string[] {
  if (!inputValue.startsWith('/') || inputValue.includes(' ')) {
    // Only show completions while typing the command name (before any space)
    // Exception: show if value starts with a known parent command + space
    if (!inputValue.startsWith('/')) return [];
    // After space: show subcommand completions for /task, /design, /plan, /feedback, /review, /why
    return COMMAND_COMPLETIONS.filter((c) => c.startsWith(inputValue) && c !== inputValue).slice(0, 8);
  }
  return COMMAND_COMPLETIONS.filter((c) => c.startsWith(inputValue) && c !== inputValue).slice(0, 8);
}

export function clampCompletionIndex(items: string[], rawIndex: number): number {
  if (items.length === 0) return -1;
  // Wrap around
  const n = items.length;
  return ((rawIndex % n) + n) % n;
}

export function renderCompletionLines(
  inputValue: string,
  completionIndex: number,
  width: number,
): string[] {
  const items = getCompletions(inputValue);
  if (items.length === 0) return [];

  const clamped = completionIndex >= 0 ? clampCompletionIndex(items, completionIndex) : -1;

  const lines: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const isSelected = i === clamped;
    let line: string;
    if (isSelected) {
      // Highlighted row
      const text = ` ${item} `.padEnd(Math.max(item.length + 2, 30));
      const padded = text.slice(0, Math.min(text.length, width));
      line = REVERSE + BOLD + padded + RESET;
    } else {
      const prefix = `  ${CYAN}${item}${RESET}`;
      const plainLen = 2 + item.length;
      const pad = Math.max(0, width - plainLen);
      line = prefix + DIM + ' '.repeat(pad) + RESET;
    }
    lines.push(line);
  }
  // Add a dim border at top
  lines.unshift(DIM + '─'.repeat(width) + RESET);
  return lines;
}
