/**
 * 调试事件记录器 — 记录 UI 事件到 .student-agent/debug-ui-events.jsonl。
 *
 * 记录的事件类型：
 *   - appendMessage: 添加消息到 transcript
 *   - setStatus: 设置状态栏文本
 *   - render: TUI 渲染帧
 *   - toolResult: 工具执行结果
 *   - clearStatus: 清除状态栏
 *
 * 每行一个 JSON 对象，格式：
 *   { "ts": "ISO时间", "event": "eventType", "payload": {...} }
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type DebugEventType =
  | "appendMessage"
  | "setStatus"
  | "clearStatus"
  | "render"
  | "toolResult";

export interface DebugEvent {
  ts: string;
  event: DebugEventType;
  payload: Record<string, unknown>;
}

let eventsPath: string | null = null;
let enabled = false;

/**
 * 初始化调试事件文件。TUI 启动时调用。
 */
export function initDebugEvents(options?: {
  /** 自定义目录；默认 <cwd>/.student-agent */
  dir?: string;
  /** 是否启用；默认 false，需显式开启 */
  enabled?: boolean;
}): void {
  const dir = options?.dir ?? join(process.cwd(), ".student-agent");
  enabled = options?.enabled ?? false;

  if (!enabled) return;

  mkdirSync(dir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  eventsPath = join(dir, `debug-ui-events-${timestamp}.jsonl`);
}

/** 获取当前调试事件文件路径（测试用） */
export function getDebugEventsPath(): string | null {
  return eventsPath;
}

/** 是否启用调试事件 */
export function isDebugEnabled(): boolean {
  return enabled;
}

/**
 * 记录一个调试事件。
 * 如果未启用或文件路径未初始化，静默跳过。
 */
export function recordDebugEvent(
  event: DebugEventType,
  payload: Record<string, unknown>,
): void {
  if (!enabled || !eventsPath) return;

  try {
    const entry: DebugEvent = {
      ts: new Date().toISOString(),
      event,
      payload,
    };
    appendFileSync(eventsPath, JSON.stringify(entry) + "\n");
  } catch {
    // 调试事件写入失败不应影响主流程
  }
}
