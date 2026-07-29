/**
 * TUI 模式下劫持 console.* 写入日志文件。
 *
 * 背景：ink 用 ANSI 差分渲染管理自己一块"屏幕区"，假设所有写 stdout
 * 的事都经过它。任何绕过 ink 直接 console.log/warn/info 都会让 ink
 * 的行数计算偏差，导致 markdown 输出被覆盖、错行、显示不全。
 *
 * 现实里有两类污染源：
 *   1. 项目自身散布的 console.* 调用（88 处）
 *   2. 第三方包内部的 console.warn（如 @google/genai 检测到双 env 时）
 *
 * 这个 helper 在 TUI 启动时全局重定向 log/warn/info/error 到日志文件。
 * 返回 cleanup 函数，TUI 退出时调用以恢复原始 console。
 *
 * 日志文件位置：~/.student-agent/logs/runtime-YYYY-MM-DD.log
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { format } from 'node:util';

interface ConsoleSnapshot {
  log: typeof console.log;
  warn: typeof console.warn;
  info: typeof console.info;
  debug: typeof console.debug;
  error: typeof console.error;
}

let activeLogPath: string | null = null;
let activeSnapshot: ConsoleSnapshot | null = null;

export interface RedirectOptions {
  /** 自定义日志目录；默认 ~/.student-agent/logs */
  logDir?: string;
  /** 自定义日期串（仅测试用）；默认当天 YYYY-MM-DD */
  dateString?: string;
}

/**
 * 启动 console 劫持。返回 cleanup 函数，调用后恢复原始 console。
 * 重复调用是幂等的：第二次起返回上一次的 cleanup。
 */
export function redirectConsoleForTUI(options: RedirectOptions = {}): () => void {
  if (activeLogPath && activeSnapshot) {
    // 已经劫持过，避免重复 patch
    return restore;
  }

  const logDir = options.logDir
    ?? join(process.env.STUDENT_AGENT_LOG_DIR ?? join(homedir(), '.student-agent'), 'logs');
  mkdirSync(logDir, { recursive: true });

  const dateString = options.dateString ?? new Date().toISOString().slice(0, 10);
  const logPath = join(logDir, `runtime-${dateString}.log`);
  activeLogPath = logPath;

  activeSnapshot = {
    log: console.log,
    warn: console.warn,
    info: console.info,
    debug: console.debug,
    error: console.error,
  };

  console.log = makeWriter('log');
  console.warn = makeWriter('warn');
  console.info = makeWriter('info');
  console.debug = makeWriter('debug');
  console.error = makeWriter('error');

  return restore;
}

function makeWriter(level: string): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    const logPath = activeLogPath;
    if (!logPath) return;
    // util.format 处理 %s/%d 等占位符，与原生 console.* 行为一致
    const message = format(...(args as Parameters<typeof format>));
    appendFileSync(logPath, `[${new Date().toISOString()}] [${level}] ${message}\n`);
  };
}

function restore(): void {
  if (activeSnapshot) {
    console.log = activeSnapshot.log;
    console.warn = activeSnapshot.warn;
    console.info = activeSnapshot.info;
    console.debug = activeSnapshot.debug;
    console.error = activeSnapshot.error;
    activeSnapshot = null;
  }
  activeLogPath = null;
}
