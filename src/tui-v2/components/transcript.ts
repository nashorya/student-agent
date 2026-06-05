import { renderMarkdownLines } from '../markdown.js';
import type { TUIV2Message, TUIV2State } from '../state.js';
import { visibleLength } from '../terminal-control.js';

export function renderTranscriptLines(
  state: TUIV2State,
  options: { width: number },
): string[] {
  return renderMessages(state.transcript.messages, options);
}

function renderMessages(messages: TUIV2Message[], options: { width: number }): string[] {
  return messages.flatMap((message) => renderMessageLines(message, options));
}

const CYAN_BOLD = '\x1b[1;36m';
const GREEN_BOLD = '\x1b[1;32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function renderMessageLines(message: TUIV2Message, options: { width: number }): string[] {
  const streaming = message.status === 'streaming';
  const content = streaming && !message.content ? '正在生成回复...' : message.content;

  if (message.role === 'assistant') {
    const label = GREEN_BOLD + 'Assistant' + RESET + ':';
    const lines = renderMarkdownLines(content || '', { width: Math.max(1, options.width), streaming });
    return [label, ...(lines.length > 0 ? lines : [''])];
  }

  const prefix = getColoredPrefix(message.role);
  const plainPrefix = getPlainPrefix(message.role);
  const contentWidth = Math.max(1, options.width - visibleLength(plainPrefix));
  const lines = renderMarkdownLines(content || '', { width: contentWidth, streaming });
  const rendered = (lines.length > 0 ? lines : ['']).map((line, index) =>
    `${index === 0 ? prefix : ' '.repeat(visibleLength(plainPrefix))}${line}`,
  );
  return rendered;
}

function getColoredPrefix(role: TUIV2Message['role']): string {
  switch (role) {
    case 'user':    return CYAN_BOLD + '>' + RESET + ' ';
    case 'tool':    return YELLOW + 'Tool' + RESET + ': ';
    case 'system':  return DIM + 'System' + RESET + ': ';
    case 'error':   return RED + 'Error' + RESET + ': ';
    case 'assistant': return GREEN_BOLD + 'Assistant' + RESET + ': ';
  }
}

function getPlainPrefix(role: TUIV2Message['role']): string {
  switch (role) {
    case 'user':      return '> ';
    case 'assistant': return 'Assistant: ';
    case 'tool':      return 'Tool: ';
    case 'system':    return 'System: ';
    case 'error':     return 'Error: ';
  }
}
