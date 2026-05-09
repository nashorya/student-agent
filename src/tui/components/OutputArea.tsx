import React from 'react';
import { Box, Text } from 'ink';
import { useAppState } from '../state.js';
import { renderMarkdown } from '../../cli/markdown.js';

export function OutputArea() {
  const { state } = useAppState();
  const { messages } = state;

  return (
    <Box flexDirection="column" paddingX={1}>
      {messages.map((msg, idx) => (
        <MessageLine key={idx} message={msg} />
      ))}
    </Box>
  );
}

function MessageLine({ message }: { message: { role: string; content: string } }) {
  const prefix = getPrefix(message.role);
  const content = message.role === 'assistant'
    ? renderMarkdown(message.content, Math.max(40, (process.stdout.columns || 80) - prefix.length - 4))
    : message.content;
  return (
    <Box>
      <Text color={getPrefixColor(message.role)}>{prefix}</Text>
      <Text color={getContentColor(message.role)}>{content}</Text>
    </Box>
  );
}

function getPrefix(role: string): string {
  switch (role) {
    case 'user':      return '> ';
    case 'assistant': return 'Assistant: ';
    case 'tool':      return 'Tool: ';
    case 'system':    return '✓ ';
    case 'error':     return '✗ ';
    default:          return '';
  }
}

function getPrefixColor(role: string): string {
  switch (role) {
    case 'user':      return 'cyan';
    case 'assistant': return 'white';
    case 'tool':      return 'yellow';
    case 'system':    return 'green';
    case 'error':     return 'red';
    default:          return 'white';
  }
}

function getContentColor(role: string): string | undefined {
  return role === 'error' ? 'red' : undefined;
}
