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
 *
 * TUI 模式下：
 *   - tool error 必须通过 bridge.addMessage('error', ...) append 到 transcriptMessages
 *   - 工具状态通过 bridge.setStatus() / bridge.setCurrentTool() 走状态栏
 *   - 禁止直接 console.log
 */

import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { AssistantMessageEvent } from "@mariozechner/pi-ai";
import chalk from "chalk";
import ora, { type Ora } from "ora";
import stringWidth from "string-width";
import { renderMarkdown } from "./markdown.js";
import type { TUIBridge } from "../tui/bridge.js";
import { stripPhaseSignals } from "../core/task-planner/phase-signal.js";
import { recordDebugEvent } from "../tui/debug-events.js";
import { logger } from "../tui/logger.js";

/**
 * 从 message_update 事件的 assistantMessageEvent 中提取文本 delta。
 * 只提取 text_delta，忽略 thinking_delta 和 toolcall_delta。
 */
export function extractTextDelta(
  assistantEvent: AssistantMessageEvent,
): string | null {
  if (assistantEvent.type === "text_delta") {
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
 *
 * 用 string-width 计算可见宽度：
 *   - 自动剥 ANSI escape 序列
 *   - 中日韩 / 全角字符按 2 列计算
 *   - emoji 按 2 列计算
 *
 * 之前使用 .length 直接除会严重低估 CJK 行数，
 * 导致 reRenderWithMarkdown 清屏不彻底，留下花屏。
 */
export function countTerminalLines(text: string, columns?: number): number {
  const cols = columns ?? process.stdout.columns ?? 80;
  let total = 0;
  for (const line of text.split("\n")) {
    const width = stringWidth(line);
    total += Math.max(1, Math.ceil(width / cols));
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
  private streamBuffer = "";
  private streamLineCount = 0;
  private bridgeFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private bridgeMessageStarted = false;
  private bridgeVisibleText = "";

  constructor(bridge?: TUIBridge) {
    this.bridge = bridge;
    this.spinner = ora({
      spinner: "dots",
      color: "cyan",
    });
  }

  /**
   * 处理单个 AgentEvent。
   * 设计为传给 agent.subscribe() 的回调。
   */
  handleEvent(event: AgentEvent): void {
    switch (event.type) {
      case "agent_start":
        this.isStreaming = false;
        this.hasOutput = false;
        this.toolCount = 0;
        this.streamBuffer = "";
        this.streamLineCount = 0;
        this.bridgeMessageStarted = false;
        this.bridgeVisibleText = "";
        this.startTime = Date.now();
        if (!this.bridge) {
          this.spinner.start(chalk.dim("思考中..."));
        }
        break;

      case "message_start":
        if (event.message.role === "assistant") {
          this.spinner.stop();
          if (this.bridge && this.bridgeMessageStarted) {
            this.bridge.discardAssistantMessage();
            this.bridgeMessageStarted = false;
            this.bridgeVisibleText = "";
          }
          this.isStreaming = true;
          this.streamBuffer = "";
          this.streamLineCount = 0;
          // 关键：每条新 assistant 消息都要重置 hasOutput，
          // 否则一个回合内的第二条消息（典型场景 assistant→tool→assistant）
          // 不会触发 bridge.addMessage()，导致 updateLastMessage() 覆盖前一条。
          this.hasOutput = false;
          if (!this.bridge) {
            process.stdout.write(chalk.cyan("Assistant: "));
          }
          // TUI 模式下延迟到第一个 text_delta 才添加消息，
          // 避免工具调用轮次留下空白 Assistant 消息
        }
        break;

      case "message_update": {
        if (!this.isStreaming) break;
        const delta = extractTextDelta(event.assistantMessageEvent);
        if (delta) {
          this.streamBuffer += delta;
          this.hasOutput = true;
          if (this.bridge) {
            this.scheduleBridgeFlush();
          } else {
            process.stdout.write(delta);
          }
        }
        break;
      }

      case "message_end":
        this.flushBridgeBuffer();
        if (this.isStreaming && this.hasOutput && !this.bridge) {
          // 清除裸文本输出，用 Markdown 格式化后重绘（仅非 TUI 模式）
          this.reRenderWithMarkdown();
        }
        // TUI 模式：message_end 时立即 commit，避免下一条 message_start discard 掉有内容的消息
        if (this.bridge && this.bridgeMessageStarted) {
          this.finishBridgeAssistantMessage();
        }
        this.isStreaming = false;
        break;

      case "tool_execution_start":
        this.toolCount++;
        if (this.bridge) {
          this.bridge.setCurrentTool(event.toolName);
          this.bridge.setStatus(`正在调用 ${event.toolName}`);
        } else {
          this.spinner.start(chalk.dim(`Tool: ${event.toolName}`));
        }
        break;

      case "tool_execution_end":
        if (this.bridge) {
          this.bridge.setCurrentTool(null);
          this.bridge.clearStatus();
        } else {
          this.spinner.stop();
        }
        if (event.isError) {
          const ev = event as Record<string, unknown>;
          const rawDetail = extractToolErrorDetail(ev);
          const messages = formatToolFailureMessages(event.toolName, rawDetail, ev.args ?? ev.toolArgs);
          if (this.bridge) {
            // 所有 tool error 必须 append 到 transcriptMessages
            for (const message of messages) {
              this.bridge.addMessage(message.role, message.content);
            }
            recordDebugEvent("toolResult", {
              toolName: event.toolName,
              isError: true,
              messageCount: messages.length,
            });
          } else {
            for (const message of messages) {
              const color = message.role === "error" ? chalk.red : chalk.dim;
              // 非 TUI 模式：直接写 stderr，不用 console.log
              process.stderr.write(color(`  ${message.content}\n`));
            }
          }
        }
        break;

      case "agent_end": {
        this.flushBridgeBuffer();
        if (this.bridge) {
          this.finishBridgeAssistantMessage();
        } else if (this.isStreaming && this.bridgeMessageStarted) {
          // Non-TUI rendering writes directly to stdout and does not use bridge commits.
        }
        if (this.bridge) {
          this.bridge.setCurrentTool(null);
          this.bridge.updateTaskStatus({ state: "idle" });
        } else {
          this.spinner.stop();
        }
        this.isStreaming = false;

        // 耗时 + 工具统计
        const elapsed = Date.now() - this.startTime;
        const parts: string[] = [formatDuration(elapsed)];
        if (this.toolCount > 0) {
          parts.push(`${this.toolCount} 个工具调用`);
        }
        if (!this.bridge) {
          process.stderr.write(chalk.dim(`\n  DONE: ${parts.join(" | ")}\n`));
        }
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
      process.stdout.write("\n");
      return;
    }

    // 计算已输出的行数（包含 Assistant: 前缀那行）
    const rawWithPrefix = "Assistant: " + raw;
    const lineCount = countTerminalLines(rawWithPrefix);

    // 用 ANSI escape 回退并清除
    // \x1b[F = cursor up + move to line start
    // \x1b[2K = erase entire line
    if (lineCount > 1) {
      process.stdout.write(`\x1b[${lineCount - 1}F`); // 移到第一行
    } else {
      process.stdout.write("\r"); // 回到行首
    }
    for (let i = 0; i < lineCount; i++) {
      process.stdout.write("\x1b[2K"); // 清除当前行
      if (i < lineCount - 1) {
        process.stdout.write("\x1b[1E"); // 下移一行
      }
    }
    // 回到第一行
    if (lineCount > 1) {
      process.stdout.write(`\x1b[${lineCount - 1}F`);
    } else {
      process.stdout.write("\r");
    }

    // 用 Markdown 渲染器重绘
    const visible = stripPhaseSignals(raw);
    if (!visible) {
      process.stdout.write("\n");
      return;
    }

    const rendered = renderMarkdown(visible);
    process.stdout.write(chalk.cyan("Assistant: ") + rendered + "\n");
  }

  /** 创建可传给 agent.subscribe() 的回调函数。 */
  createSubscriber(): (event: AgentEvent) => void {
    return (event) => this.handleEvent(event);
  }

  /** 停止 spinner（用于 REPL 退出时的清理）。 */
  cleanup(): void {
    this.flushBridgeBuffer();
    if (this.bridge) {
      if (this.bridgeMessageStarted) {
        if (this.isStreaming || !this.bridgeVisibleText.trim()) {
          this.bridge.discardAssistantMessage();
        } else {
          this.bridge.endAssistantMessage();
        }
        this.bridgeMessageStarted = false;
        this.bridgeVisibleText = "";
      }
    } else if (this.isStreaming && this.bridgeMessageStarted) {
      // Non-TUI rendering writes directly to stdout and does not use bridge commits.
    }
    this.spinner.stop();
  }

  private scheduleBridgeFlush(): void {
    if (!this.bridge || this.bridgeFlushTimer) return;
    this.bridgeFlushTimer = setTimeout(() => {
      this.bridgeFlushTimer = null;
      this.flushBridgeBuffer();
    }, 50);
  }

  private flushBridgeBuffer(): void {
    if (!this.bridge || !this.hasOutput) return;
    if (this.bridgeFlushTimer) {
      clearTimeout(this.bridgeFlushTimer);
      this.bridgeFlushTimer = null;
    }
    const visible = stripPhaseSignals(this.streamBuffer);
    if (!visible && !this.bridgeMessageStarted) return;
    if (!this.bridgeMessageStarted) {
      this.bridge.addMessage("assistant", "");
      this.bridgeMessageStarted = true;
    }
    this.bridgeVisibleText = visible;
    this.bridge.updateLastMessage(visible);
  }

  private finishBridgeAssistantMessage(): void {
    if (!this.bridge || !this.bridgeMessageStarted) return;
    if (this.bridgeVisibleText.trim()) {
      this.bridge.endAssistantMessage();
    } else {
      this.bridge.discardAssistantMessage();
    }
    this.bridgeMessageStarted = false;
    this.bridgeVisibleText = "";
  }
}

/** 从 Pi tool_execution_end 事件中提取原始错误文本，尝试多条路径。 */
function extractToolErrorDetail(ev: Record<string, unknown>): string {
  // 路径1: result.content[0].text（AgentToolResult 标准格式）
  const resultContent = (ev.result as Record<string, unknown> | undefined)?.content;
  if (Array.isArray(resultContent) && resultContent.length > 0) {
    const text = (resultContent[0] as Record<string, unknown>)?.text;
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  // 路径2: resultText
  if (typeof ev.resultText === "string" && ev.resultText.trim()) return ev.resultText.trim();
  // 路径3: error
  if (typeof ev.error === "string" && ev.error.trim()) return ev.error.trim();
  if (ev.error instanceof Error) return ev.error.message;
  return "";
}

export interface ToolFailureMessage {
  role: "error" | "system";
  content: string;
}

export function formatToolFailureMessages(
  toolName: string,
  rawDetail: string,
  args?: unknown,
): ToolFailureMessage[] {
  const detail = rawDetail.trim();
  const lines = detail.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const exitCode = extractExitCode(detail);
  const contextLines = summarizeToolArgs(args);
  const primaryError = extractPrimaryError(lines);

  const primary = [
    `主错误：${toolName} 失败${exitCode ? `（exit code ${exitCode}）` : ""}`,
    ...contextLines,
    primaryError ?? "命令没有 stdout/stderr（no output）。",
  ].join("\n");

  const messages: ToolFailureMessage[] = [{ role: "error", content: primary }];
  const diagnostics = extractDiagnosticLines(lines);
  if (diagnostics.length > 0) {
    messages.push({ role: "system", content: ["辅助诊断：", ...diagnostics].join("\n") });
  }

  const recovery = extractRecoveryLines(lines);
  if (recovery.length > 0) {
    messages.push({ role: "system", content: ["恢复动作：", ...recovery].join("\n") });
  }

  return messages;
}

function extractExitCode(text: string): string | null {
  const match = text.match(/Command exited with code (\d+)/u);
  return match?.[1] ?? null;
}

/**
 * 匹配上游工具结果里 "(no output)" 这个显式标记。
 * 必须带括号——上游就是这么生产的（参见 failure-escalation.ts isProbeMiss）。
 * 不匹配 "expected: no output found in log" 这种含 "no output" 子串的正常 stderr，
 * 避免把真实错误吞成简化的"无输出"提示。
 */
const NO_OUTPUT_TAG_RE = /\(no output\)/iu;
const NO_OUTPUT_FALLBACK_TEXT = "命令没有 stdout/stderr（no output）。";

function extractPrimaryError(lines: string[]): string | null {
  const errorLine = lines.find((line) => /^错误[：:]/u.test(line));
  if (errorLine) {
    return NO_OUTPUT_TAG_RE.test(errorLine) ? NO_OUTPUT_FALLBACK_TEXT : errorLine;
  }

  const fallback = lines.find((line) =>
    !/^WARN[：:]/u.test(line)
    && !/^建议[：:]/u.test(line)
    && !/^辅助诊断[：:]/u.test(line)
    && !/^恢复动作[：:]/u.test(line)
    && !/^OK[：:]/u.test(line)
    && !/^原因[：:]/u.test(line)
    && !/^Command exited with code/u.test(line)
  );
  if (!fallback) return null;
  return NO_OUTPUT_TAG_RE.test(fallback) ? NO_OUTPUT_FALLBACK_TEXT : fallback;
}

function extractDiagnosticLines(lines: string[]): string[] {
  const diagnostics: string[] = [];
  for (const line of lines) {
    if (/^辅助诊断[：:]/u.test(line)) {
      diagnostics.push(stripLabel(line));
    } else if (/Context7/u.test(line) || /^原因[：:]/u.test(line) || /^查询[：:]/u.test(line) || /^命中文档[：:]/u.test(line)) {
      diagnostics.push(line);
    }
  }
  return uniqueLines(diagnostics).map(limitLine);
}

function extractRecoveryLines(lines: string[]): string[] {
  const recovery: string[] = [];
  let inAdvice = false;

  for (const line of lines) {
    if (/^恢复动作[：:]/u.test(line)) {
      recovery.push(stripLabel(line));
      inAdvice = false;
      continue;
    }
    if (/^OK[：:]/u.test(line)) {
      recovery.push(line);
      inAdvice = false;
      continue;
    }
    if (/^建议[：:]/u.test(line)) {
      inAdvice = true;
      continue;
    }
    if (inAdvice) {
      recovery.push(line);
    }
  }

  return uniqueLines(recovery).map(limitLine);
}

function summarizeToolArgs(args: unknown): string[] {
  if (!isRecord(args)) return [];
  const command = pickString(args, ["cmd", "command"]);
  const cwd = pickString(args, ["cwd", "workdir"]);
  const lines: string[] = [];
  if (command) lines.push(`命令：${limitLine(command)}`);
  if (cwd) lines.push(`目录：${cwd}`);
  return lines;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripLabel(line: string): string {
  return line.replace(/^[^：:]+[：:]\s*/u, "");
}

function uniqueLines(lines: string[]): string[] {
  return [...new Set(lines.filter((line) => line.trim()))];
}

function limitLine(line: string): string {
  return line.length > 220 ? `${line.slice(0, 217)}...` : line;
}
