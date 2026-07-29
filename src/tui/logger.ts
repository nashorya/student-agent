/**
 * TUI-safe logger — 所有业务层日志必须走这个模块，禁止直接 console.log/error。
 *
 * 行为：
 *   - TUI 模式下写文件（~/.student-agent/logs/runtime-YYYY-MM-DD.log）
 *   - 非 TUI 模式下 error 写 stderr
 *   - 支持 printf-style 占位符（与 console.log 一致）
 */

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { format } from "node:util";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  /** 自定义日志目录；默认 ~/.student-agent/logs */
  logDir?: string;
  /** 自定义日期串（仅测试用）；默认当天 YYYY-MM-DD */
  dateString?: string;
  /** 是否激活文件写入；默认 true */
  enabled?: boolean;
}

let activeLogPath: string | null = null;
let fileEnabled = true;

/**
 * 初始化日志文件路径。TUI 启动时调用一次即可。
 * 重复调用是幂等的。
 */
export function initLogger(options: LoggerOptions = {}): void {
  if (activeLogPath) return;

  const logDir =
    options.logDir ??
    join(
      process.env.STUDENT_AGENT_LOG_DIR ?? join(homedir(), ".student-agent"),
      "logs",
    );
  mkdirSync(logDir, { recursive: true });

  const dateString = options.dateString ?? new Date().toISOString().slice(0, 10);
  activeLogPath = join(logDir, `runtime-${dateString}.log`);
  fileEnabled = options.enabled ?? true;
}

/** 获取当前日志文件路径（测试用） */
export function getLogPath(): string | null {
  return activeLogPath;
}

function writeLine(level: LogLevel, ...args: unknown[]): void {
  const message = format(...(args as Parameters<typeof format>));
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;

  // 全屏 TUI 模式下 stderr 会绕过渲染器，污染输入框/状态栏。
  if (level === "error" && !tuiModeActive) {
    process.stderr.write(line);
  }

  // 文件日志
  if (fileEnabled && activeLogPath) {
    try {
      appendFileSync(activeLogPath, line);
    } catch {
      // 日志写入失败不应影响主流程
    }
  }
}

export const logger = {
  debug(...args: unknown[]): void {
    writeLine("debug", ...args);
  },
  info(...args: unknown[]): void {
    writeLine("info", ...args);
  },
  warn(...args: unknown[]): void {
    writeLine("warn", ...args);
  },
  error(...args: unknown[]): void {
    writeLine("error", ...args);
  },
} as const;

/**
 * 检查是否应该抑制 stdout 写入（TUI 模式下）。
 * 业务层在写 stdout 前应检查这个标志。
 */
let tuiModeActive = false;

export function setTuiMode(active: boolean): void {
  tuiModeActive = active;
}

export function isTuiMode(): boolean {
  return tuiModeActive;
}

/**
 * 安全写 stdout：TUI 模式下写日志文件，非 TUI 模式下写 stdout。
 * 用于必须输出到终端但又不能污染 TUI 的场景。
 */
export function safeStdout(message: string): void {
  if (tuiModeActive) {
    writeLine("info", message);
  } else {
    process.stdout.write(message);
  }
}
