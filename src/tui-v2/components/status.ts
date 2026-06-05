import { visibleLength } from '../terminal-control.js';
import type { TUIV2State } from '../state.js';

// ANSI helpers
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

export function renderSeparator(width: number): string {
  return DIM + '─'.repeat(Math.max(1, width)) + RESET;
}

export function renderStatusLine(state: TUIV2State, width: number): string {
  const safeWidth = Math.max(1, width);
  const left = DIM + '? for shortcuts' + RESET;
  const leftLen = visibleLength('? for shortcuts');

  const queue = state.status.pendingCount > 0 ? ` · queued ${state.status.pendingCount}` : '';
  const tool = state.status.currentTool ? ` · ${state.status.currentTool}` : '';
  const streaming = state.streaming ? ' · streaming…' : '';
  const rawRight = state.status.transient || `student-agent${streaming || ` · ready`}${tool}${queue}`;
  const isError = /失败|error|Error/i.test(rawRight);
  const rightColor = isError ? RED : state.streaming ? YELLOW : CYAN;
  const right = rightColor + rawRight + RESET;
  const rightLen = visibleLength(rawRight);

  const gap = safeWidth - leftLen - rightLen;
  if (gap < 1) {
    return fitLine(rawRight, safeWidth);
  }
  return left + ' '.repeat(gap) + right;
}

export function fitLine(text: string, width: number): string {
  const safeWidth = Math.max(1, width);
  if (visibleLength(text) <= safeWidth) {
    return text + ' '.repeat(safeWidth - visibleLength(text));
  }

  let out = '';
  for (const ch of Array.from(text)) {
    if (visibleLength(out + ch + '…') > safeWidth) break;
    out += ch;
  }
  return out + '…';
}
