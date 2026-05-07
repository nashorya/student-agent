/**
 * EventRenderer — 将 AgentEvent 流转为终端输出。
 *
 * 渲染策略（参照 Pi 的 InteractiveMode.subscribeToAgent）：
 *   streaming 阶段: 裸文本逐 token 写 stdout（打字感）
 *   message_end:    清除裸文本，用 Markdown 渲染器重绘格式化版本
 *
 * 事件处理：
 *   agent_start       → 显示 spinner
 *   message_start     → 准备流式输出，打印 Assistant: 前缀
 *   message_update    → 逐 token 写 stdout（text_delta）+ 缓存
 *   message_end       → 清屏重绘 Markdown + 换行
 *   tool_execution_*  → 工具状态 + 参数提示
 *   agent_end         → 清理，显示耗时
 */

import type { AgentEvent } from '@mariozechner/pi-agent-core';
import type { AssistantMessageEvent } from '@mariozechner/pi-ai';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { renderMarkdown } from './markdown.js';
import type { TUIBridge } from '../tui/bridge.js';

/**
 * 从 message_update 事件的 assistantMessageEvent 中提取文本 delta。
 * 只提取 text_delta，忽略 thinking_delta 和 toolcall_delta。
 */
export function extractTextDelta(
  assistantEvent: AssistantMessageEvent,
): string | null {
  if (assistantEvent.type === 'text_delta') {
    return assistantEvent.delta;
  }
  return null;
}

/** 格式化耗时为人类可读形式。 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 100) / 10;
  return `${seconds}s`;
}

/**
 * 计算字符串在终端中占据的行数（近似值）。
 * 用于 ANSI 清屏重绘。
 */
function countTerminalLines(text: string): number {
  const cols = process.stdout.columns || 80;
  const lines = text.split('\n');
  let total = 0;
  for (const line of lines) {
    // 粗略估算：每行的可见字符数 / 终端宽度，向上取整
    // 忽略 ANSI codes 的长度
    const visibleLen = line.replace(/\x1b\[[0-9;]*m/g, '').length;
    total += Math.max(1, Math.ceil(visibleLen / cols));
  }
  return total;
}

export class EventRenderer {
  private spinner: Ora;
  private isStreaming = false;
  private hasOutput = false;
  private startTime = 0;
  private toolCount = 0;
  private bridge?: TUIBridge;

  // 流式输出缓冲区，用于 message_end 时的 markdown 重绘
  private streamBuffer = '';
  private streamLineCount = 0;

  constructor(bridge?: TUIBridge) {
    this.bridge = bridge;
    this.spinner = ora({
      spinner: 'dots',
      color: 'cyan',
    });
  }

  /**
   * 处理单个 AgentEvent。
   * 设计为传给 agent.subscribe() 的回调。
   */
  handleEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'agent_start':
        this.isStreaming = false;
        this.hasOutput = false;
        this.toolCount = 0;
        this.streamBuffer = '';
        this.streamLineCount = 0;
        this.startTime = Date.now();
        this.spinner.start(chalk.dim('思考中...'));
        break;

      case 'message_start':
        if (event.message.role === 'assistant') {
          this.spinner.stop();
          this.isStreaming = true;
          this.streamBuffer = '';
          this.streamLineCount = 0;
          if (this.bridge) {
            this.bridge.addMessage('assistant', '');
          } else {
            process.stdout.write(chalk.cyan('Assistant: '));
          }
        }
        break;

      case 'message_update': {
        if (!this.isStreaming) break;
        const delta = extractTextDelta(event.assistantMessageEvent);
        if (delta) {
          this.streamBuffer += delta;
          this.hasOutput = true;
          if (this.bridge) {
            this.bridge.updateLastMessage(this.streamBuffer);
          } else {
            process.stdout.write(delta);
          }
        }
        break;
      }

      case 'message_end':
        if (this.isStreaming && this.hasOutput) {
          // 清除裸文本输出，用 Markdown 格式化后重绘
          this.reRenderWithMarkdown();
        }
        this.isStreaming = false;
        break;

      case 'tool_execution_start':
        this.toolCount++;
        if (this.bridge) {
          this.bridge.addMessage('tool', event.toolName);
        } else {
          this.spinner.start(chalk.dim(`Tool: ${event.toolName}`));
        }
        break;

      case 'tool_execution_end':
        this.spinner.stop();
        if (event.isError) {
          const detail = (event as Record<string, unknown>).resultText ?? (event as Record<string, unknown>).error ?? '';
          console.log(chalk.red(`  ERROR: ${event.toolName} 失败${detail ? ': ' + String(detail).slice(0, 200) : ''}`));
        }
        break;

      case 'agent_end': {
        this.spinner.stop();
        this.isStreaming = false;

        // 耗时 + 工具统计
        const elapsed = Date.now() - this.startTime;
        const parts: string[] = [formatDuration(elapsed)];
        if (this.toolCount > 0) {
          parts.push(`${this.toolCount} 个工具调用`);
        }
        console.log(chalk.dim(`\n  DONE: ${parts.join(' | ')}`));
        break;
      }

      default:
        // turn_start, turn_end 等暂不处理
        break;
    }
  }

  /**
   * 清除已输出的裸文本，用 Markdown 渲染器重绘。
   * 参照 Pi 的 updateContent() → Markdown component → TUI diff render 模式。
   * 我们用 ANSI escape 模拟：移到行首 → 清除 → 写新内容。
   */
  private reRenderWithMarkdown(): void {
    const raw = this.streamBuffer.trim();
    if (!raw) {
      process.stdout.write('\n');
      return;
    }

    // 计算已输出的行数（包含 Assistant: 前缀那行）
    const rawWithPrefix = 'Assistant: ' + raw;
    const lineCount = countTerminalLines(rawWithPrefix);

    // 用 ANSI escape 回退并清除
    // \x1b[F = cursor up + move to line start
    // \x1b[2K = erase entire line
    if (lineCount > 1) {
      process.stdout.write(`\x1b[${lineCount - 1}F`); // 移到第一行
    } else {
      process.stdout.write('\r'); // 回到行首
    }
    for (let i = 0; i < lineCount; i++) {
      process.stdout.write('\x1b[2K'); // 清除当前行
      if (i < lineCount - 1) {
        process.stdout.write('\x1b[1E'); // 下移一行
      }
    }
    // 回到第一行
    if (lineCount > 1) {
      process.stdout.write(`\x1b[${lineCount - 1}F`);
    } else {
      process.stdout.write('\r');
    }

    // 用 Markdown 渲染器重绘
    const rendered = renderMarkdown(raw);
    process.stdout.write(chalk.cyan('Assistant: ') + rendered + '\n');
  }

  /** 创建可传给 agent.subscribe() 的回调函数。 */
  createSubscriber(): (event: AgentEvent) => void {
    return (event) => this.handleEvent(event);
  }

  /** 停止 spinner（用于 REPL 退出时的清理）。 */
  cleanup(): void {
    this.spinner.stop();
  }
}
