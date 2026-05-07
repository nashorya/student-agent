import React from 'react';
import { Box, Text } from 'ink';
import { useAppState } from '../state.js';

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
  return (
    <Box>
      <Text color={getPrefixColor(message.role)}>{prefix}</Text>
      <Text>{message.content}</Text>
    </Box>
  );
}

function getPrefix(role: string): string {
  switch (role) {
    case 'user':
      return '> ';
    case 'assistant':
      return 'Assistant: ';
    case 'tool':
      return 'Tool: ';
    case 'system':
      return '✓ ';
    default:
      return '';
  }
}

function getPrefixColor(role: string): string {
  switch (role) {
    case 'user':
      return 'cyan';
    case 'assistant':
      return 'white';
    case 'tool':
      return 'yellow';
    case 'system':
      return 'green';
    default:
      return 'white';
  }
}
