import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { useAppState } from '../state.js';
import { getCommandCompletions } from '../command-completions.js';

interface InputLineProps {
  onSubmit: (value: string) => void;
  onAbort: () => void;
}

export function InputLine({ onSubmit, onAbort }: InputLineProps) {
  const { state, dispatch } = useAppState();
  const { inputValue, cursorPos, taskStatus, currentTool, settingsPrompt } = state;

  const [menuIndex, setMenuIndex] = useState(0);
  const pendingInputRef = useRef<{ value: string; cursorPos: number } | null>(null);
  const flushScheduledRef = useRef(false);

  const menuItems = !settingsPrompt && inputValue.startsWith('/')
    ? getCommandCompletions(inputValue)
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

    if (key.escape) {
      if (showMenu || inputValue) {
        dispatch({ type: 'SET_INPUT', value: '' });
      } else {
        onAbort();
      }
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

    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        const newValue = inputValue.slice(0, cursorPos - 1) + inputValue.slice(cursorPos);
        dispatch({ type: 'SET_INPUT', value: newValue, cursorPos: cursorPos - 1 });
      }
      return;
    }

    // 菜单只接管导航和 Tab 补全；Enter/Backspace 始终按用户当前输入处理。
    if (showMenu) {
      if (key.upArrow) {
        setMenuIndex((i) => (i <= 0 ? menuItems.length - 1 : i - 1));
        return;
      }
      if (key.downArrow) {
        setMenuIndex((i) => (i >= menuItems.length - 1 ? 0 : i + 1));
        return;
      }
      if (key.tab) {
        const selected = menuItems[menuIndex] ?? menuItems[0];
        dispatch({ type: 'SET_INPUT', value: selected, cursorPos: selected.length });
        return;
      }
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

    if (input) {
      const sanitized = input.replace(/\n/g, ' ');
      const base = pendingInputRef.current ?? { value: inputValue, cursorPos };
      pendingInputRef.current = {
        value: base.value.slice(0, base.cursorPos) + sanitized + base.value.slice(base.cursorPos),
        cursorPos: base.cursorPos + sanitized.length,
      };
      if (!flushScheduledRef.current) {
        flushScheduledRef.current = true;
        setImmediate(() => {
          flushScheduledRef.current = false;
          if (pendingInputRef.current) {
            dispatch({ type: 'SET_INPUT', value: pendingInputRef.current.value, cursorPos: pendingInputRef.current.cursorPos });
            pendingInputRef.current = null;
          }
        });
      }
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
          <TaskStatusPanel taskStatus={taskStatus} />
        )}
        {!settingsPrompt && currentTool && (
          <Box>
            <Text dimColor>正在调用 {currentTool}</Text>
          </Box>
        )}
        <Box>
          <Text color={settingsPrompt ? 'yellow' : 'cyan'}>&gt; </Text>
          <InputText value={inputValue} cursor={cursorPos} />
        </Box>
      </Box>
    </Box>
  );
}

function TaskStatusPanel({ taskStatus }: { taskStatus: NonNullable<ReturnType<typeof useAppState>['state']['taskStatus']> }) {
  const reviewText = taskStatus.requiresVisualReview || taskStatus.requiresUserAcceptance
    ? ` · review:${taskStatus.requiresVisualReview ? 'visual' : ''}${taskStatus.requiresUserAcceptance ? '+user' : ''}`
    : '';
  const levelText = taskStatus.level !== undefined ? ` · L${taskStatus.level}` : '';
  const workflowText = taskStatus.workflowStatus ? ` · ${taskStatus.workflowStatus}` : '';
  const details = buildTaskDetailLines(taskStatus);

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>
          {truncate(taskStatus.name, 20)} · Phase {taskStatus.phaseIndex + 1}/{taskStatus.totalPhases}
          {workflowText}{levelText}{reviewText}
          {taskStatus.retryCount > 0 ? ` · 重试:${taskStatus.retryCount}` : ''}
          {' · '}工具:{taskStatus.toolCallCount} · {formatElapsed(taskStatus.elapsedMs)} · {getStateText(taskStatus.state)}
        </Text>
      </Box>
      {details.map((line) => (
        <Box key={line}>
          <Text dimColor>{line}</Text>
        </Box>
      ))}
    </Box>
  );
}

function buildTaskDetailLines(taskStatus: NonNullable<ReturnType<typeof useAppState>['state']['taskStatus']>): string[] {
  if ((taskStatus.level ?? 0) < 2) return [];
  const lines: string[] = [];
  if (taskStatus.goal) lines.push(`Goal: ${truncate(taskStatus.goal, 60)}`);
  if (taskStatus.acceptanceCriteria?.length) {
    lines.push(`Acceptance: ${truncate(taskStatus.acceptanceCriteria.join(' | '), 60)}`);
  }
  if (taskStatus.constraints?.length) {
    lines.push(`Constraints: ${truncate(taskStatus.constraints.join(' | '), 60)}`);
  }
  if (taskStatus.openQuestions?.length) {
    lines.push(`Open: ${truncate(taskStatus.openQuestions.join(' | '), 60)}`);
  }
  if (taskStatus.verificationSummary?.length) {
    lines.push(`Verification: ${truncate(taskStatus.verificationSummary.slice(-2).join(' | '), 60)}`);
  }
  return lines.slice(0, 4);
}

function InputText({ value, cursor }: { value: string; cursor: number }) {
  const termWidth = process.stdout.columns ?? 80;
  const promptWidth = 2; // "> "
  const borderWidth = 2; // left + right border
  const viewWidth = Math.max(10, termWidth - promptWidth - borderWidth);

  // 计算滑动窗口起点，让光标始终在窗口内
  let windowStart = 0;
  if (cursor >= viewWidth) {
    windowStart = cursor - viewWidth + 1;
  }

  const visible = value.slice(windowStart, windowStart + viewWidth);
  const localCursor = cursor - windowStart;

  return (
    <>
      <Text>{visible.slice(0, localCursor)}</Text>
      <Text inverse>{visible[localCursor] ?? ' '}</Text>
      <Text>{visible.slice(localCursor + 1)}</Text>
    </>
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

function getStateText(s: 'running' | 'aborting' | 'idle' | 'failed'): string {
  switch (s) {
    case 'running': return '● 运行中';
    case 'aborting': return '⊘ 中止中…';
    case 'idle': return '◌ 等待';
    case 'failed': return '✗ 失败';
  }
}
