import React from 'react';
import { Box, Text, useInput } from 'ink';
import { useAppState } from '../state.js';

interface InputLineProps {
  onSubmit: (value: string) => void;
  onAbort: () => void;
}

export function InputLine({ onSubmit, onAbort }: InputLineProps) {
  const { state, dispatch } = useAppState();
  const { inputValue } = state;

  useInput((input, key) => {
    if (key.escape) {
      onAbort();
      return;
    }

    if (key.return) {
      if (inputValue.trim()) {
        onSubmit(inputValue);
        dispatch({ type: 'ADD_TO_HISTORY', value: inputValue });
        dispatch({ type: 'SET_INPUT', value: '' });
      }
      return;
    }

    if (key.upArrow) {
      dispatch({ type: 'NAVIGATE_HISTORY', direction: 'up' });
      return;
    }

    if (key.downArrow) {
      dispatch({ type: 'NAVIGATE_HISTORY', direction: 'down' });
      return;
    }

    if (key.backspace || key.delete) {
      dispatch({ type: 'SET_INPUT', value: inputValue.slice(0, -1) });
      return;
    }

    // 多行粘贴：替换换行符为空格
    const sanitized = input.replace(/\n/g, ' ');
    dispatch({ type: 'SET_INPUT', value: inputValue + sanitized });
  });

  return (
    <Box>
      <Text color="cyan">&gt; </Text>
      <Text>{inputValue}</Text>
      <Text inverse> </Text>
    </Box>
  );
}
