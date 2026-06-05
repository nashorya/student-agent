import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import stringWidth from "string-width";
import { useAppState } from "../state.js";
import { getCommandCompletions } from "../command-completions.js";

interface InputLineProps {
  onSubmit: (value: string) => void;
  onAbort: () => void;
}

/**
 * InputLine — 纯输入区域，不包含任务状态或工具信息。
 * 任务状态和工具信息已迁移到 StatusBar 组件。
 */
export function InputLine({ onSubmit, onAbort }: InputLineProps) {
  const { state, dispatch } = useAppState();
  const { inputValue, inputGeneration, cursorPos, settingsPrompt } = state;

  const [menuIndex, setMenuIndex] = useState(0);
  const pendingInputRef = useRef<{ value: string; cursorPos: number } | null>(null);
  const flushScheduledRef = useRef(false);

  const menuItems = !settingsPrompt && inputValue.startsWith("/")
    ? getCommandCompletions(inputValue)
    : [];
  const showMenu = menuItems.length > 0;
  const inputPrefix = settingsPrompt ? formatSettingsPromptPrefix(settingsPrompt.question) : "> ";

  // 输入变化时重置菜单选中到第一项
  useEffect(() => {
    setMenuIndex(0);
  }, [inputValue]);

  useInput((input, key) => {
    const bufferedInput = pendingInputRef.current ?? { value: inputValue, cursorPos };
    const clearInput = () => {
      pendingInputRef.current = null;
      dispatch({ type: "CLEAR_INPUT" });
    };

    // Settings prompt 模式：Enter 提交答案，Escape 取消（空答案）
    if (settingsPrompt) {
      if (key.return) {
        settingsPrompt.resolve(inputValue);
        clearInput();
        return;
      }
      if (key.escape) {
        settingsPrompt.resolve("");
        clearInput();
        return;
      }
      if (key.backspace || key.delete) {
        dispatch({ type: "SET_INPUT", value: inputValue.slice(0, -1) });
        return;
      }
      if (input) {
        const sanitized = input.replace(/\n/g, " ");
        dispatch({ type: "SET_INPUT", value: inputValue + sanitized });
      }
      return;
    }

    if (key.escape) {
      if (showMenu || bufferedInput.value) {
        clearInput();
      } else {
        onAbort();
      }
      return;
    }

    if (key.return) {
      const submittedValue = bufferedInput.value;
      if (submittedValue.trim()) {
        onSubmit(submittedValue);
        dispatch({ type: "ADD_TO_HISTORY", value: submittedValue });
        clearInput();
      }
      return;
    }

    if (key.backspace || key.delete) {
      if (bufferedInput.cursorPos > 0) {
        const newValue = bufferedInput.value.slice(0, bufferedInput.cursorPos - 1) + bufferedInput.value.slice(bufferedInput.cursorPos);
        pendingInputRef.current = null;
        dispatch({ type: "SET_INPUT", value: newValue, cursorPos: bufferedInput.cursorPos - 1 });
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
        pendingInputRef.current = null;
        dispatch({ type: "SET_INPUT", value: selected, cursorPos: selected.length });
        return;
      }
    }

    if (key.upArrow) {
      dispatch({ type: "NAVIGATE_HISTORY", direction: "up" });
      return;
    }

    if (key.downArrow) {
      dispatch({ type: "NAVIGATE_HISTORY", direction: "down" });
      return;
    }

    if (key.leftArrow) {
      dispatch({ type: "MOVE_CURSOR", direction: "left" });
      return;
    }

    if (key.rightArrow) {
      dispatch({ type: "MOVE_CURSOR", direction: "right" });
      return;
    }

    if (input) {
      const sanitized = input.replace(/\n/g, " ");
      const base = pendingInputRef.current ?? { value: inputValue, cursorPos };
      pendingInputRef.current = {
        value: base.value.slice(0, base.cursorPos) + sanitized + base.value.slice(base.cursorPos),
        cursorPos: base.cursorPos + sanitized.length,
      };
      if (!flushScheduledRef.current) {
        flushScheduledRef.current = true;
        const scheduledGeneration = inputGeneration;
        setImmediate(() => {
          flushScheduledRef.current = false;
          if (pendingInputRef.current) {
            dispatch({
              type: "SET_INPUT",
              value: pendingInputRef.current.value,
              cursorPos: pendingInputRef.current.cursorPos,
              generation: scheduledGeneration,
            });
            pendingInputRef.current = null;
          }
        });
      }
    }
  });

  return (
    <Box flexDirection="column">
      {showMenu && (
        <Box flexDirection="column" borderStyle="single" borderColor="gray">
          {menuItems.map((cmd, i) => (
            <Box key={cmd}>
              <Text color={i === menuIndex ? "cyan" : undefined}>
                {i === menuIndex ? "❯ " : "  "}{cmd}
              </Text>
            </Box>
          ))}
        </Box>
      )}
      <Box borderStyle="single" borderColor={settingsPrompt ? "yellow" : "gray"}>
        <Box>
          <InputText
            value={inputValue}
            cursor={cursorPos}
            promptWidth={stringWidth(inputPrefix)}
            prefix={inputPrefix}
            prefixColor={settingsPrompt ? "yellow" : "cyan"}
          />
        </Box>
      </Box>
    </Box>
  );
}

export function formatSettingsPromptPrefix(question: string): string {
  const normalized = question.replace(/\s+/g, " ").trim();
  return normalized ? `${normalized} > ` : "> ";
}

function InputText({
  value,
  cursor,
  promptWidth,
  prefix,
  prefixColor,
}: {
  value: string;
  cursor: number;
  promptWidth: number;
  prefix: string;
  prefixColor: "yellow" | "cyan";
}) {
  const termWidth = process.stdout.columns ?? 80;
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
    <Text>
      <Text color={prefixColor}>{prefix}</Text>
      <Text>{visible.slice(0, localCursor)}</Text>
      <Text inverse>{visible[localCursor] ?? " "}</Text>
      <Text>{visible.slice(localCursor + 1)}</Text>
    </Text>
  );
}
