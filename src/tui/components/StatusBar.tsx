import React from 'react';
import { Box, Text } from 'ink';
import { useAppState } from '../state.js';

export function StatusBar() {
  const { state } = useAppState();
  const { taskStatus } = state;

  if (!taskStatus || !taskStatus.name) {
    return (
      <Box borderStyle="single" borderColor="gray">
        <Text dimColor>student-agent · 就绪</Text>
      </Box>
    );
  }

  const {
    name,
    phaseIndex,
    totalPhases,
    retryCount,
    toolCallCount,
    elapsedMs,
    workflowStatus,
    state: taskState,
  } = taskStatus;
  const elapsed = formatElapsed(elapsedMs);
  const retryText = retryCount > 0 ? ` · 重试:${retryCount}` : '';
  const stateIndicator = getStateIndicator(taskState);
  const workflowText = workflowStatus ? ` · ${workflowStatus}` : '';

  return (
    <Box borderStyle="single" borderColor="gray">
      <Text>
        [{truncate(name, 20)}] Phase {phaseIndex + 1}/{totalPhases}
        {workflowText}
        <Text color={retryCount > 0 ? 'yellow' : undefined}>{retryText}</Text>
        {' · '}工具:{toolCallCount} · {elapsed} · {stateIndicator}
      </Text>
    </Box>
  );
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
  return `00:${remainingSeconds.toString().padStart(2, '0')}`;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

function getStateIndicator(taskState: 'running' | 'aborting' | 'idle' | 'failed'): React.ReactElement {
  switch (taskState) {
    case 'running':
      return <Text color="green">● 运行中</Text>;
    case 'aborting':
      return <Text color="yellow">⊘ 中止中…</Text>;
    case 'idle':
      return <Text dimColor>◌ 等待输入</Text>;
    case 'failed':
      return <Text color="red">✗ 失败</Text>;
  }
}
