import { fitLine } from './status.js';
import type { TUIV2State } from '../state.js';
import { visibleLength } from '../terminal-control.js';

const MAX_INPUT_LINES = 4;

export function renderInputLine(state: TUIV2State, width: number): string {
  const view = buildInputView(state, width);
  return fitLine(view.text, width);
}

export function renderFocusedInputLine(state: TUIV2State, width: number, cursorMarker = ''): string {
  const view = buildInputView(state, width);
  const line = fitLine(view.text, width);
  return insertVisualCursor(line, view.cursorIndex, width, cursorMarker);
}

export function renderInputLines(state: TUIV2State, width: number, maxLines = MAX_INPUT_LINES): string[] {
  return buildWrappedInputView(state, width, maxLines).lines.map((line) => fitLine(line.text, width));
}

export function renderFocusedInputLines(
  state: TUIV2State,
  width: number,
  cursorMarker = '',
  maxLines = MAX_INPUT_LINES,
): string[] {
  return buildWrappedInputView(state, width, maxLines).lines.map((line) => {
    const fitted = fitLine(line.text, width);
    return line.cursorIndex === null
      ? fitted
      : insertVisualCursor(fitted, line.cursorIndex, width, cursorMarker);
  });
}

export function getInputCursorColumn(state: TUIV2State, width: number): number {
  return buildInputView(state, width).cursorColumn;
}

export function getInputPrefix(state: TUIV2State): string {
  return splitPromptQuestion(state.prompt?.question ?? state.input.promptQuestion).inputPrefix;
}

export function getPromptPanelLines(state: TUIV2State): string[] {
  return splitPromptQuestion(state.prompt?.question ?? state.input.promptQuestion).panelLines;
}

export function splitPromptQuestion(question: string | null | undefined): {
  panelLines: string[];
  inputPrefix: string;
} {
  const lines = question
    ?.split(/\r?\n/gu)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0) ?? [];
  if (lines.length === 0) return { panelLines: [], inputPrefix: '> ' };

  const inputPrompt = lines.at(-1)?.replace(/\s+/gu, ' ').trim() ?? '';
  return {
    panelLines: lines.slice(0, -1),
    inputPrefix: inputPrompt ? `${inputPrompt} > ` : '> ',
  };
}

function buildInputView(
  state: TUIV2State,
  width: number,
): { text: string; cursorColumn: number; cursorIndex: number } {
  const safeWidth = Math.max(1, width);
  const prefix = getInputPrefix(state);
  const prefixWidth = visibleLength(prefix);
  if (prefixWidth >= safeWidth) {
    return { text: prefix, cursorColumn: safeWidth, cursorIndex: prefix.length };
  }

  const value = renderInputValue(state.input.value);
  const cursorOffset = displayCursorOffset(state.input.value, state.input.cursor);
  const bodyWidth = Math.max(1, safeWidth - prefixWidth);
  const body = sliceInputBodyAroundCursor(value, cursorOffset, bodyWidth);
  return {
    text: prefix + body.text,
    cursorColumn: prefixWidth + body.cursorColumn,
    cursorIndex: prefix.length + body.cursorIndex,
  };
}

function renderInputValue(value: string): string {
  return value.replace(/\r?\n/gu, '\\n ');
}

function displayCursorOffset(value: string, cursor: number): number {
  const chars = Array.from(value).slice(0, cursor);
  return Array.from(chars.join('').replace(/\r?\n/gu, '\\n ')).length;
}

function buildWrappedInputView(
  state: TUIV2State,
  width: number,
  maxLines: number,
): { lines: Array<{ text: string; cursorIndex: number | null }> } {
  const safeWidth = Math.max(1, width);
  const safeMaxLines = Math.max(1, maxLines);
  const prefix = getInputPrefix(state);
  const prefixWidth = visibleLength(prefix);
  const chars = Array.from(state.input.value.replace(/\r\n/gu, '\n'));
  const cursorOffset = Math.max(0, Math.min(state.input.cursor, chars.length));
  const indentWidth = prefixWidth < safeWidth - 1 ? prefixWidth : 0;
  const continuationPrefix = ' '.repeat(indentWidth);
  const lines: Array<{ text: string; cursorIndex: number | null }> = [
    { text: prefix, cursorIndex: null },
  ];
  let cursorLineIndex = 0;
  let cursorPlaced = false;

  const currentLine = () => lines[lines.length - 1]!;
  const startContinuationLine = () => {
    lines.push({ text: continuationPrefix, cursorIndex: null });
  };
  const placeCursor = () => {
    if (cursorPlaced) return;
    const line = currentLine();
    line.cursorIndex = line.text.length;
    cursorLineIndex = lines.length - 1;
    cursorPlaced = true;
  };

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index] ?? '';
    if (index === cursorOffset) {
      placeCursor();
    }
    if (char === '\n') {
      startContinuationLine();
      continue;
    }
    if (char === '\r') {
      continue;
    }

    const charWidth = visibleLength(char);
    if (visibleLength(currentLine().text) + charWidth > safeWidth) {
      startContinuationLine();
    }
    currentLine().text += char;
  }

  if (!cursorPlaced) {
    placeCursor();
  }

  if (lines.length <= safeMaxLines) {
    return { lines };
  }

  const beforeCursor = Math.floor((safeMaxLines - 1) / 2);
  const maxStart = Math.max(0, lines.length - safeMaxLines);
  const start = Math.max(0, Math.min(cursorLineIndex - beforeCursor, maxStart));
  const visible = lines.slice(start, start + safeMaxLines).map((line) => ({ ...line }));
  if (start > 0 && visible[0] !== undefined) {
    visible[0] = cursorLineIndex === start
      ? markClippedTop(visible[0], continuationPrefix)
      : { text: '> …', cursorIndex: null };
  }
  return { lines: visible };
}

function markClippedTop(
  line: { text: string; cursorIndex: number | null },
  continuationPrefix: string,
): { text: string; cursorIndex: number | null } {
  const indicator = '> … ';
  const dropLength = continuationPrefix.length > 0 && line.text.startsWith(continuationPrefix)
    ? continuationPrefix.length
    : 0;
  return {
    text: indicator + line.text.slice(dropLength),
    cursorIndex: line.cursorIndex === null
      ? null
      : Math.max(0, line.cursorIndex - dropLength + indicator.length),
  };
}

function sliceInputBodyAroundCursor(
  value: string,
  cursorOffset: number,
  width: number,
): { text: string; cursorColumn: number; cursorIndex: number } {
  const chars = Array.from(value);
  const safeCursor = Math.max(0, Math.min(cursorOffset, chars.length));
  const wholeText = chars.join('');
  if (visibleLength(wholeText) <= width) {
    const beforeCursor = chars.slice(0, safeCursor).join('');
    return {
      text: wholeText,
      cursorColumn: Math.min(width, visibleLength(beforeCursor) + 1),
      cursorIndex: beforeCursor.length,
    };
  }

  const maxCellsBeforeCursor = safeCursor < chars.length
    ? Math.max(0, width - 2)
    : width;
  let start = safeCursor;
  let cellsBeforeCursor = 0;

  while (start > 0) {
    const nextStart = start - 1;
    const nextWidth = visibleLength(chars[nextStart] ?? '');
    if (cellsBeforeCursor + nextWidth > maxCellsBeforeCursor) break;
    start = nextStart;
    cellsBeforeCursor += nextWidth;
  }

  let end = start;
  let cellsInView = 0;
  while (end < chars.length) {
    const nextWidth = visibleLength(chars[end] ?? '');
    if (cellsInView + nextWidth > width) break;
    cellsInView += nextWidth;
    end += 1;
  }

  const text = chars.slice(start, end).join('');
  const beforeCursor = chars.slice(start, safeCursor).join('');
  return {
    text,
    cursorColumn: Math.min(width, visibleLength(beforeCursor) + 1),
    cursorIndex: beforeCursor.length,
  };
}

function insertVisualCursor(text: string, cursorIndex: number, width: number, cursorMarker: string): string {
  const safeIndex = Math.max(0, Math.min(cursorIndex, text.length));
  const before = text.slice(0, safeIndex);
  const after = text.slice(safeIndex);
  const target = Array.from(after).at(0);

  if (target !== undefined) {
    return `${before}${cursorMarker}\x1b[7m${target}\x1b[0m${after.slice(target.length)}`;
  }

  if (visibleLength(text) >= width && text.length > 0) {
    const chars = Array.from(text);
    const last = chars.at(-1) ?? '';
    const beforeLast = chars.slice(0, -1).join('');
    return `${beforeLast}${cursorMarker}\x1b[7m${last}\x1b[0m`;
  }

  return `${before}${cursorMarker}\x1b[7m \x1b[0m`;
}
