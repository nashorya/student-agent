import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { useAppState } from '../state.js';
import { COMMANDS } from '../../cli/command-parser.js';

interface InputLineProps {
  onSubmit: (value: string) => void;
  onAbort: () => void;
}

export function InputLine({ onSubmit, onAbort }: InputLineProps) {
  const { state, dispatch } = useAppState();
  const { inputValue, cursorPos, taskStatus, currentTool, settingsPrompt } = state;

  const [menuIndex, setMenuIndex] = useState(0);

  // 计时器：running 状态下每秒 tick 一次以刷新显示
  const startTimeRef = useRef<number | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (taskStatus?.state === 'running') {
      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now() - (taskStatus.elapsedMs ?? 0);
      }
      const id = setInterval(() => setTick((t) => t + 1), 1000);
      return () => clearInterval(id);
    } else {
      startTimeRef.current = null;
    }
  }, [taskStatus?.state]);
  const liveElapsedMs = startTimeRef.current !== null
    ? Date.now() - startTimeRef.current
    : (taskStatus?.elapsedMs ?? 0);

  const menuItems = !settingsPrompt && inputValue.startsWith('/')
    ? COMMANDS.filter((c) => c.startsWith(inputValue))
    : [];
  const showMenu = menuItems.length > 0;

  // 输入变化时重置菜单选中到第一项
  useEffect(() => {
    setMenuIndex(0);
  }, [inputValue]);

  useInput((input, key) => {
    // Settings prompt 模式：Enter 提交答案，Escape 取消（空答案）
    if (settingsPrompt) {
      if (key.return) {
        settingsPrompt.resolve(inputValue);
        dispatch({ type: 'SET_INPUT', value: '' });
        return;
      }
      if (key.escape) {
        settingsPrompt.resolve('');
        dispatch({ type: 'SET_INPUT', value: '' });
        return;
      }
      if (key.backspace || key.delete) {
        dispatch({ type: 'SET_INPUT', value: inputValue.slice(0, -1) });
        return;
      }
      if (input) {
        const sanitized = input.replace(/\n/g, ' ');
        dispatch({ type: 'SET_INPUT', value: inputValue + sanitized });
      }
      return;
    }

    // 菜单开着时，↑↓ 和 Enter 优先给菜单
    if (showMenu) {
      if (key.upArrow) {
        setMenuIndex((i) => (i <= 0 ? menuItems.length - 1 : i - 1));
        return;
      }
      if (key.downArrow) {
        setMenuIndex((i) => (i >= menuItems.length - 1 ? 0 : i + 1));
        return;
      }
      if (key.return) {
        const selected = menuItems[menuIndex] ?? menuItems[0];
        onSubmit(selected);
        dispatch({ type: 'ADD_TO_HISTORY', value: selected });
        dispatch({ type: 'SET_INPUT', value: '' });
        return;
      }
      if (key.tab) {
        const selected = menuItems[menuIndex] ?? menuItems[0];
        dispatch({ type: 'SET_INPUT', value: selected + ' ' });
        return;
      }
      if (key.escape) {
        dispatch({ type: 'SET_INPUT', value: '' });
        return;
      }
    }

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

    if (key.leftArrow) {
      dispatch({ type: 'MOVE_CURSOR', direction: 'left' });
      return;
    }

    if (key.rightArrow) {
      dispatch({ type: 'MOVE_CURSOR', direction: 'right' });
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        const newValue = inputValue.slice(0, cursorPos - 1) + inputValue.slice(cursorPos);
        dispatch({ type: 'SET_INPUT', value: newValue, cursorPos: cursorPos - 1 });
      }
      return;
    }

    if (input) {
      // 多行粘贴：替换换行符为空格
      const sanitized = input.replace(/\n/g, ' ');
      const newValue = inputValue.slice(0, cursorPos) + sanitized + inputValue.slice(cursorPos);
      dispatch({ type: 'SET_INPUT', value: newValue, cursorPos: cursorPos + sanitized.length });
    }
  });

  const showStatus = taskStatus && taskStatus.name;

  return (
    <Box flexDirection="column">
      {showMenu && (
        <Box flexDirection="column" borderStyle="single" borderColor="gray">
          {menuItems.map((cmd, i) => (
            <Box key={cmd}>
              <Text color={i === menuIndex ? 'cyan' : undefined}>
                {i === menuIndex ? '❯ ' : '  '}{cmd}
              </Text>
            </Box>
          ))}
        </Box>
      )}
      <Box flexDirection="column" borderStyle="single" borderColor={settingsPrompt ? 'yellow' : 'gray'}>
        {settingsPrompt && (
          <Box>
            <Text color="yellow">{settingsPrompt.question}</Text>
          </Box>
        )}
        {!settingsPrompt && showStatus && (
          <Box>
            <Text dimColor>
              {truncate(taskStatus.name, 20)} · Phase {taskStatus.phaseIndex + 1}/{taskStatus.totalPhases}
              {taskStatus.retryCount > 0 ? ` · 重试:${taskStatus.retryCount}` : ''}
              {' · '}工具:{taskStatus.toolCallCount} · {formatElapsed(liveElapsedMs)} ·{' '}
            </Text>
            {getStateElement(taskStatus.state)}
          </Box>
        )}
        {!settingsPrompt && currentTool && (
          <Box>
            <Text dimColor>正在调用 {currentTool}</Text>
          </Box>
        )}
        <Box>
          <Text color={settingsPrompt ? 'yellow' : 'cyan'}>&gt; </Text>
          <Text>{inputValue.slice(0, cursorPos)}</Text>
          <Text inverse>{inputValue[cursorPos] ?? ' '}</Text>
          <Text>{inputValue.slice(cursorPos + 1)}</Text>
        </Box>
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

function getStateElement(s: 'running' | 'aborting' | 'idle' | 'failed'): React.ReactElement {
  switch (s) {
    case 'running':  return <Text color="green">● 运行中</Text>;
    case 'aborting': return <Text color="yellow">⊘ 中止中…</Text>;
    case 'idle':     return <Text dimColor>◌ 等待</Text>;
    case 'failed':   return <Text color="red">✗ 失败</Text>;
  }
}
