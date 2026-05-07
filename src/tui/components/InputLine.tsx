import React from 'react';
import { Box, Text, useInput } from 'ink';
import { useAppState } from '../state.js';
import { COMMANDS } from '../../cli/command-parser.js';

interface InputLineProps {
  onSubmit: (value: string) => void;
  onAbort: () => void;
}

export function InputLine({ onSubmit, onAbort }: InputLineProps) {
  const { state, dispatch } = useAppState();
  const { inputValue, taskStatus } = state;

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

    if (key.tab) {
      if (inputValue.startsWith('/')) {
        const hits = COMMANDS.filter((c) => c.startsWith(inputValue));
        if (hits.length === 0) return;
        const currentIdx = hits.indexOf(inputValue);
        const next = currentIdx >= 0 ? hits[(currentIdx + 1) % hits.length] : hits[0];
        dispatch({ type: 'SET_INPUT', value: next });
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

  const showStatus = taskStatus && taskStatus.name;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray">
      {showStatus && (
        <Box>
          <Text dimColor>
            {truncate(taskStatus.name, 20)} · Phase {taskStatus.phaseIndex + 1}/{taskStatus.totalPhases}
            {taskStatus.retryCount > 0 ? ` · 重试:${taskStatus.retryCount}` : ''}
            {' · '}工具:{taskStatus.toolCallCount} · {formatElapsed(taskStatus.elapsedMs)} · {getStateText(taskStatus.state)}
          </Text>
        </Box>
      )}
      <Box>
        <Text color="cyan">&gt; </Text>
        <Text>{inputValue}</Text>
        <Text inverse> </Text>
      </Box>
    </Box>
  );
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  return `00:${remainingSeconds.toString().padStart(2, '0')}`;
}

function getStateText(s: 'running' | 'idle' | 'failed'): string {
  switch (s) {
    case 'running': return '● 运行中';
    case 'idle': return '◌ 等待';
    case 'failed': return '✗ 失败';
  }
}
