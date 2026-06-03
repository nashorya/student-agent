import React from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import { useAppState } from "../state.js";

/**
 * StatusBar — 底部状态栏，显示：
 *   1. 如果 currentStatus 有内容：显示瞬态文本（单行截断）
 *   2. 否则如果 taskStatus 有内容：显示任务状态（单行截断）
 *   3. 否则：显示就绪状态
 *
 * 所有文本必须单行截断，不能进入正文。
 */
export function StatusBar() {
  const { state } = useAppState();
  const { currentStatus, taskStatus, currentTool } = state;

  const columns = process.stdout.columns ?? 80;
  // 留出边框 2 列 + 内边距 2 列 = 4 列
  const maxWidth = Math.max(10, columns - 4);

  // 优先级：currentStatus（瞬态）> taskStatus（结构化）> 就绪
  if (currentStatus) {
    return (
      <Box borderStyle="single" borderColor="gray">
        <Text dimColor>{truncate(currentStatus, maxWidth)}</Text>
      </Box>
    );
  }

  if (!taskStatus?.name) {
    const toolText = currentTool ? ` · ${currentTool}` : "";
    return (
      <Box borderStyle="single" borderColor="gray">
        <Text dimColor>student-agent · 就绪{toolText}</Text>
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
    state: taskState,
  } = taskStatus;

  const elapsed = formatElapsed(elapsedMs);
  const retryText = retryCount > 0 ? ` · 重试:${retryCount}` : "";
  const toolText = currentTool ? ` · ${currentTool}` : "";
  const stateText = getStateText(taskState);

  const statusLine = [
    `[${truncate(name, 15)}]`,
    `P${phaseIndex + 1}/${totalPhases}`,
    `工具:${toolCallCount}`,
    elapsed,
    stateText,
  ].join(" · ");

  const fullLine = `${statusLine}${retryText}${toolText}`;

  return (
    <Box borderStyle="single" borderColor="gray">
      <Text>
        <Text dimColor>{truncate(fullLine, maxWidth - (retryText ? 10 : 0) - (currentTool ? currentTool.length + 3 : 0))}</Text>
        {retryCount > 0 && <Text color="yellow">{retryText}</Text>}
        {currentTool && <Text dimColor>{toolText}</Text>}
      </Text>
    </Box>
  );
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  }
  return `00:${remainingSeconds.toString().padStart(2, "0")}`;
}

function truncate(text: string, maxLen: number): string {
  if (stringWidth(text) <= maxLen) return text;
  // 保守截断：按字符宽度逐字缩减
  let result = text;
  while (stringWidth(result) > maxLen - 1 && result.length > 0) {
    result = result.slice(0, -1);
  }
  return result + "…";
}

function getStateText(taskState: "running" | "aborting" | "idle" | "failed"): string {
  switch (taskState) {
    case "running":
      return "● 运行中";
    case "aborting":
      return "⊘ 中止中";
    case "idle":
      return "◌ 等待";
    case "failed":
      return "✗ 失败";
  }
}
