import React from 'react';
import { Box, Static, Text } from 'ink';
import type { ForegroundColorName } from 'chalk';
import stringWidth from 'string-width';
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

/**
 * 输出区采用 ink 的 <Static> + 活动区两段式渲染：
 *   1. 已完成消息走 <Static>：ink 渲染一次后将其"提交"到终端 scrollback。
 *      终端历史里就有完整内容，鼠标滚轮、文本选中、复制全部恢复原生体验。
 *   2. 正在流式输出的 assistant 消息只显示一行状态。
 *      不把完整流式文本渲染进动态区，否则长回复会先进入 terminal scrollback，
 *      结束后再由 <Static> append 一次，形成"回复两遍"。
 */
export function OutputArea() {
  const { state } = useAppState();
  const { messages, completedMessageIds, activeAssistantMessageId } = state;
  const terminalColumns = process.stdout.columns ?? 80;

  // 必须按 reducer 维护的"完成顺序"取消息，不能按 messages 原顺序 filter——
  // 后者会让已提交到 Static 的项目因为新成员加入而移位，触发 ink 的 slice(index) 重提交。
  const messageById = new Map(messages.map((m) => [m.id, m]));
  const completed = completedMessageIds
    .map((id) => messageById.get(id))
    .filter((m): m is Message => Boolean(m));
  const active = activeAssistantMessageId ? messageById.get(activeAssistantMessageId) : undefined;

  return (
    <>
      <Static items={completed}>
        {(message) => (
          <MessageBlock key={message.id} message={message} terminalColumns={terminalColumns} />
        )}
      </Static>
      {active && <StreamingAssistantStatus message={active} />}
    </>
  );
}

interface MessageBlockProps {
  message: Message;
  terminalColumns: number;
}

function MessageBlock({ message, terminalColumns }: MessageBlockProps) {
  const lines = formatMessageLines(message, terminalColumns);
  return (
    <Box flexDirection="column" paddingX={1}>
      {lines.map((line) => (
        <Box key={line.id}>
          <Text color={line.prefixColor}>{line.prefix}</Text>
          <Text color={line.contentColor} wrap="wrap">{line.content}</Text>
        </Box>
      ))}
    </Box>
  );
}

function StreamingAssistantStatus({ message }: { message: Message }) {
  return (
    <Box paddingX={1}>
      <Text color={getPrefixColor(message.role)}>{getPrefix(message.role)}</Text>
      <Text dimColor>{formatStreamingAssistantStatus(message.content)}</Text>
    </Box>
  );
}

/**
 * 兼容旧测试导出：把若干消息拍平成 OutputLine 数组，并按 maxRows 做尾部截断。
 * 新的 Static 渲染路径不再使用这个函数，但 src/tui/__tests__ 还依赖它，保留以保证回归测试。
 */
export function buildVisibleOutputLines(
  messages: Message[],
  maxRows: number,
  terminalColumns = process.stdout.columns ?? 80,
): OutputLine[] {
  const lines = messages.flatMap((message) => formatMessageLines(message, terminalColumns));
  const visibleRows = Math.max(1, maxRows);
  if (lines.length <= visibleRows) return lines;

  const tail = lines.slice(-visibleRows);
  const first = tail[0];
  if (!first) return tail;

  return [
    { ...first, prefix: '… ', prefixColor: 'gray' },
    ...tail.slice(1),
  ];
}

function formatMessageLines(message: Message, terminalColumns: number): OutputLine[] {
  const prefix = getPrefix(message.role);
  const contentWidth = getContentWidth(terminalColumns, prefix);
  const renderedContent = shouldRenderMarkdown(message.role)
    ? renderMarkdown(message.content, contentWidth)
    : message.content;
  const contentLines = renderedContent
    .split(/\r?\n/u)
    .flatMap((line) => wrapContentLine(line, contentWidth));
  const safeLines = contentLines.length > 0 ? contentLines : [''];
  const continuationPrefix = ' '.repeat(prefix.length);

  return safeLines.map((content, lineIndex) => ({
    id: `${message.id}-${lineIndex}`,
    prefix: lineIndex === 0 ? prefix : continuationPrefix,
    content,
    prefixColor: getPrefixColor(message.role),
    contentColor: getContentColor(message.role),
  }));
}

function getContentWidth(terminalColumns: number, prefix: string): number {
  return Math.max(10, terminalColumns - visibleLength(prefix) - 2);
}

function shouldRenderMarkdown(role: Message['role']): boolean {
  return role !== 'user';
}

export function formatStreamingAssistantStatus(content: string): string {
  const charCount = Array.from(content).length;
  return charCount > 0 ? `正在生成回复… ${charCount} 字 ▍` : '正在生成回复… ▍';
}

function wrapContentLine(line: string, width: number): string[] {
  if (width <= 0) return [line];
  if (visibleLength(line) <= width) return [line];

  const out: string[] = [];
  let current = '';
  let currentWidth = 0;
  let lastSpaceIdx = -1; // current 中最后一个 ASCII 空白的位置（用于优先按词断行）
  let lastSpaceWidth = 0;

  // 按 Unicode 码点遍历，避免代理对被切坏；string-width 处理 CJK 双宽、emoji、零宽。
  for (const ch of Array.from(line)) {
    const chWidth = stringWidth(ch);

    if (chWidth === 0) {
      // 组合字符/零宽——粘到当前位置不增加宽度。
      current += ch;
      continue;
    }

    if (currentWidth + chWidth > width) {
      // 当前字符本身是 ASCII 空白：这是天然的断点，push 当前内容并丢弃这个空格，下一段从新行开始。
      if (/^[ \t]$/.test(ch)) {
        out.push(current);
        current = '';
        currentWidth = 0;
        lastSpaceIdx = -1;
        lastSpaceWidth = 0;
        continue;
      }
      // 普通字符：优先在 current 内最近一个 ASCII 空白处断；要求空白前内容已占可见宽度的一半，避免把长 CJK 段折成"一字一行"。
      if (lastSpaceIdx > 0 && lastSpaceWidth * 2 >= width) {
        const headRaw = current.slice(0, lastSpaceIdx);
        const tailRaw = current.slice(lastSpaceIdx + 1); // 跳过空白
        out.push(headRaw.trimEnd());
        const tail = tailRaw.trimStart();
        current = tail + ch;
        currentWidth = stringWidth(current);
      } else {
        out.push(current);
        current = ch;
        currentWidth = chWidth;
      }
      lastSpaceIdx = -1;
      lastSpaceWidth = 0;
      continue;
    }

    if (/^[ \t]$/.test(ch)) {
      // 仅 ASCII 空格/制表符作为可断点；CJK 全角空格也不当成 break point（保留视觉缩进）。
      lastSpaceIdx = current.length;
      lastSpaceWidth = currentWidth;
    }
    current += ch;
    currentWidth += chWidth;
  }

  if (current.length > 0) out.push(current);
  return out.length > 0 ? out : [''];
}

function visibleLength(text: string): number {
  // string-width 会正确处理 CJK 双宽、emoji 双宽、组合字符、零宽字符以及 ANSI 转义。
  return stringWidth(text);
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
