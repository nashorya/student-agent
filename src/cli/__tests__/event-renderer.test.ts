import { describe, it, expect } from 'vitest';
import { extractTextDelta, formatDuration } from '../event-renderer.js';
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
