import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { ForegroundColorName } from 'chalk';
import { useAppState } from '../state.js';
import { renderMarkdown } from '../../cli/markdown.js';
import type { Message } from '../state.js';

interface OutputLine {
  id: string;
  prefix: string;
  content: string;
  prefixColor: ForegroundColorName;
  contentColor?: ForegroundColorName;
}

export function OutputArea() {
  const { state } = useAppState();
  const { messages } = state;
  const maxRows = getOutputRows();
  const terminalColumns = process.stdout.columns ?? 80;
  const lines = useMemo(
    () => buildVisibleOutputLines(messages, maxRows, terminalColumns),
    [messages, maxRows, terminalColumns],
  );

  return (
    <Box flexDirection="column" paddingX={1} height={maxRows} overflow="hidden">
      {lines.map((line) => (
        <MessageLine key={line.id} line={line} />
      ))}
    </Box>
  );
}

function MessageLine({ line }: { line: OutputLine }) {
  return (
    <Box>
      <Text color={line.prefixColor}>{line.prefix}</Text>
      <Text color={line.contentColor} wrap="wrap">{line.content}</Text>
    </Box>
  );
}

export function buildVisibleOutputLines(
  messages: Message[],
  maxRows: number,
  terminalColumns = process.stdout.columns ?? 80,
): OutputLine[] {
  const lines = messages.flatMap((message, messageIndex) => (
    formatMessageLines(message, messageIndex, terminalColumns)
  ));
  const visibleRows = Math.max(1, maxRows);
  if (lines.length <= visibleRows) return lines;

  const tail = lines.slice(-visibleRows);
  const first = tail[0];
  if (!first) return tail;

  return [
    {
      ...first,
      prefix: '… ',
      content: first.content,
      prefixColor: 'gray',
    },
    ...tail.slice(1),
  ];
}

function formatMessageLines(message: Message, messageIndex: number, terminalColumns: number): OutputLine[] {
  const prefix = getPrefix(message.role);
  const contentWidth = getContentWidth(terminalColumns, prefix);
  const renderedContent = message.role === 'assistant'
    ? renderMarkdown(message.content, contentWidth)
    : message.content;
  const contentLines = renderedContent
    .split(/\r?\n/u)
    .flatMap((line) => wrapContentLine(line, contentWidth));
  const safeLines = contentLines.length > 0 ? contentLines : [''];
  const continuationPrefix = ' '.repeat(prefix.length);

  return safeLines.map((content, lineIndex) => ({
    id: `${message.timestamp}-${messageIndex}-${lineIndex}`,
    prefix: lineIndex === 0 ? prefix : continuationPrefix,
    content,
    prefixColor: getPrefixColor(message.role),
    contentColor: getContentColor(message.role),
  }));
}

function getContentWidth(terminalColumns: number, prefix: string): number {
  return Math.max(10, terminalColumns - visibleLength(prefix) - 2);
}

function wrapContentLine(line: string, width: number): string[] {
  if (visibleLength(line) <= width) return [line];

  const lines: string[] = [];
  let current = '';

  for (const segment of line.split(/(\s+)/u)) {
    if (!segment) continue;

    const next = current + segment;
    if (visibleLength(next) <= width || !current) {
      current = next;
      continue;
    }

    lines.push(current.trimEnd());
    current = segment.trimStart();
  }

  if (current) lines.push(current.trimEnd());
  return lines.length > 0 ? lines : [''];
}

function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function getOutputRows(): number {
  const terminalRows = process.stdout.rows ?? 24;
  return Math.max(4, terminalRows - 7);
}

function getPrefix(role: Message['role']): string {
  switch (role) {
    case 'user':      return '> ';
    case 'assistant': return 'Assistant: ';
    case 'tool':      return 'Tool: ';
    case 'system':    return '✓ ';
    case 'error':     return '✗ ';
    default:          return '';
  }
}

function getPrefixColor(role: Message['role']): ForegroundColorName {
  switch (role) {
    case 'user':      return 'cyan';
    case 'assistant': return 'white';
    case 'tool':      return 'yellow';
    case 'system':    return 'green';
    case 'error':     return 'red';
    default:          return 'white';
  }
}

function getContentColor(role: Message['role']): ForegroundColorName | undefined {
  return role === 'error' ? 'red' : undefined;
}
