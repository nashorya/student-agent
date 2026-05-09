import { describe, it, expect } from 'vitest';
import { extractTextDelta, formatDuration, formatToolFailureMessages } from '../event-renderer.js';
import type { AssistantMessageEvent } from '@mariozechner/pi-ai';

// 最小 AssistantMessage mock
const partialMessage = {
  role: 'assistant' as const,
  content: [],
  api: 'anthropic-messages' as const,
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: 'stop' as const,
  timestamp: Date.now(),
};

describe('extractTextDelta', () => {
  it('从 text_delta 事件提取 delta 文本', () => {
    const event: AssistantMessageEvent = {
      type: 'text_delta',
      contentIndex: 0,
      delta: 'Hello ',
      partial: partialMessage,
    };
    expect(extractTextDelta(event)).toBe('Hello ');
  });

  it('空 delta 返回空字符串（不是 null）', () => {
    const event: AssistantMessageEvent = {
      type: 'text_delta',
      contentIndex: 0,
      delta: '',
      partial: partialMessage,
    };
    expect(extractTextDelta(event)).toBe('');
  });

  it('thinking_delta 返回 null', () => {
    const event: AssistantMessageEvent = {
      type: 'thinking_delta',
      contentIndex: 0,
      delta: 'I should think...',
      partial: partialMessage,
    };
    expect(extractTextDelta(event)).toBeNull();
  });

  it('toolcall_delta 返回 null', () => {
    const event: AssistantMessageEvent = {
      type: 'toolcall_delta',
      contentIndex: 0,
      delta: '{"file":',
      partial: partialMessage,
    };
    expect(extractTextDelta(event)).toBeNull();
  });

  it('start 事件返回 null', () => {
    const event: AssistantMessageEvent = {
      type: 'start',
      partial: partialMessage,
    };
    expect(extractTextDelta(event)).toBeNull();
  });

  it('done 事件返回 null', () => {
    const event: AssistantMessageEvent = {
      type: 'done',
      reason: 'stop',
      message: partialMessage,
    };
    expect(extractTextDelta(event)).toBeNull();
  });

  it('text_start 返回 null', () => {
    const event: AssistantMessageEvent = {
      type: 'text_start',
      contentIndex: 0,
      partial: partialMessage,
    };
    expect(extractTextDelta(event)).toBeNull();
  });

  it('text_end 返回 null', () => {
    const event: AssistantMessageEvent = {
      type: 'text_end',
      contentIndex: 0,
      content: 'Hello world',
      partial: partialMessage,
    };
    expect(extractTextDelta(event)).toBeNull();
  });
});

describe('formatDuration', () => {
  it('毫秒级显示 ms', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('秒级显示小数', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(3200)).toBe('3.2s');
    expect(formatDuration(10000)).toBe('10s');
  });
});

describe('formatToolFailureMessages', () => {
  it('无输出失败时明确显示 stdout/stderr 为空和 exit code', () => {
    const messages = formatToolFailureMessages(
      'bash',
      '错误：(no output)\n\nCommand exited with code 1',
      { cmd: 'npm test', cwd: '/repo' },
    );

    expect(messages[0]).toEqual({
      role: 'error',
      content: [
        '主错误：bash 失败（exit code 1）',
        '命令：npm test',
        '目录：/repo',
        '命令没有 stdout/stderr（no output）。',
      ].join('\n'),
    });
  });

  it('Context7 fallback 作为辅助诊断而不是主错误', () => {
    const messages = formatToolFailureMessages(
      'bash',
      [
        'WARN: 第二次尝试仍失败（tool/unknown）',
        '错误：Command exited with code 1',
        '',
        '辅助诊断：已尝试触发 Context7 文档检索，但没有可用文档可注入。',
        '原因：未能从任务或错误中提取明确的库名',
        '',
        '建议：',
        '1. 停止重复同一工具参数',
      ].join('\n'),
    );

    expect(messages[0]?.role).toBe('error');
    expect(messages[0]?.content).toContain('主错误：bash 失败');
    expect(messages[0]?.content).not.toContain('Context7');
    expect(messages[1]).toEqual({
      role: 'system',
      content: [
        '辅助诊断：',
        '已尝试触发 Context7 文档检索，但没有可用文档可注入。',
        '原因：未能从任务或错误中提取明确的库名',
      ].join('\n'),
    });
    expect(messages[2]).toEqual({
      role: 'system',
      content: [
        '恢复动作：',
        '1. 停止重复同一工具参数',
      ].join('\n'),
    });
  });

  it('自动回滚结果进入恢复动作段', () => {
    const messages = formatToolFailureMessages(
      'edit',
      [
        'WARN: 工具执行失败（tool/edit）',
        '错误：Could not find exact text',
        '',
        '恢复动作：已自动回滚到工具调用前的状态（snapshot: snap_1）。',
      ].join('\n'),
    );

    expect(messages[0]?.content).toContain('错误：Could not find exact text');
    expect(messages[1]).toEqual({
      role: 'system',
      content: [
        '恢复动作：',
        '已自动回滚到工具调用前的状态（snapshot: snap_1）。',
      ].join('\n'),
    });
  });
});
