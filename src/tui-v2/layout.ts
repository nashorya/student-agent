import { renderFocusedInputLines, renderInputLines } from './components/input.js';
import { renderPromptLines } from './components/prompt.js';
import { renderSeparator, renderStatusLine, fitLine } from './components/status.js';
import { renderTaskPanelLines } from './components/task-panel.js';
import { renderTranscriptLines } from './components/transcript.js';
import { renderCompletionLines } from './components/completions.js';
import type { TUIV2State } from './state.js';

export function renderFrame(
  state: TUIV2State,
  size: { columns: number; rows: number },
  options: { inputFocused?: boolean; cursorMarker?: string } = {},
): string[] {
  const columns = Math.max(1, size.columns || 80);
  const rows = Math.max(2, size.rows || 24);
  const transcript = renderTranscriptLines(state, {
    width: columns,
  });
  const taskPanel = renderTaskPanelLines(state.taskPanel, columns);
  const prompt = renderPromptLines(state, columns);
  const input = options.inputFocused
    ? renderFocusedInputLines(state, columns, options.cursorMarker ?? '')
    : renderInputLines(state, columns);
  const completions = state.input.promptQuestion === null
    ? renderCompletionLines(state.input.value, state.input.completionIndex, columns)
    : [];
  // Apply fitLine only to non-input footer lines; input lines already have
  // cursor markers inserted and must not be processed again (double fitLine
  // corrupts ANSI reverse-video sequences used by insertVisualCursor).
  const footerPrefix = [
    renderSeparator(columns),
    ...taskPanel,
    ...(taskPanel.length > 0 ? [renderSeparator(columns)] : []),
    ...prompt,
    ...completions,
    renderStatusLine(state, columns),
    renderSeparator(columns),
  ].map((line) => fitLine(line, columns));
  const footer = [...footerPrefix, ...input];
  const transcriptRows = Math.max(0, rows - footer.length);

  const allLines = transcript.map((line) => fitLine(line, columns));

  // Apply scroll offset: clamp so we don't scroll past the top
  const maxOffset = Math.max(0, allLines.length - transcriptRows);
  const offset = Math.min(state.scrollOffset, maxOffset);

  // Slice the visible window
  let visible: string[];
  if (allLines.length <= transcriptRows) {
    // Content fits — pad from top
    visible = [...allLines];
    while (visible.length < transcriptRows) {
      visible.unshift(' '.repeat(columns));
    }
  } else {
    // Content overflows — slice with scroll offset
    const end = allLines.length - offset;
    const start = end - transcriptRows;
    visible = allLines.slice(start, end);
  }

  // Show scroll indicator when not at bottom
  if (offset > 0 && visible.length > 0) {
    const indicator = `\x1b[7m ↑ ${offset} more lines ↑ \x1b[0m`;
    visible[0] = fitLine(indicator, columns);
  }

  const clipped = visible;

  return [
    ...clipped,
    ...footer,
  ];
}
