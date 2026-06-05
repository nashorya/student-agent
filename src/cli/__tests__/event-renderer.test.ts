import { describe, it, expect, vi } from 'vitest';
import {
  EventRenderer,
  countTerminalLines,
  extractTextDelta,
  formatDuration,
  formatToolFailureMessages,
} from '../event-renderer.js';
import type { AssistantMessageEvent } from '@mariozechner/pi-ai';
import type { AgentEvent } from '@mariozechner/pi-agent-core';
import type { TUIBridge } from '../../tui/bridge.js';

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

  it('"(no output)" 标记触发简化文案', () => {
    const messages = formatToolFailureMessages(
      'bash',
      '错误：(No Output)\nCommand exited with code 1',
      { cmd: 'echo test' },
    );
    expect(messages[0]?.content).toContain('命令没有 stdout/stderr（no output）。');
    expect(messages[0]?.content).not.toContain('(No Output)');
  });

  it('正常 stderr 里出现 "no output" 子串不应被误判', () => {
    const messages = formatToolFailureMessages(
      'bash',
      '错误：expected: no output found in log, got 42 lines\nCommand exited with code 1',
      { cmd: 'npm test' },
    );
    expect(messages[0]?.content).toContain('expected: no output found in log');
    expect(messages[0]?.content).not.toContain('命令没有 stdout/stderr（no output）');
  });

  it('fallback 行里 "no output" 没带括号也不应误判', () => {
    const messages = formatToolFailureMessages(
      'bash',
      'WARN: 第二次仍失败\nsome stderr noting no output expected\nCommand exited with code 1',
    );
    expect(messages[0]?.content).toContain('some stderr noting no output expected');
    expect(messages[0]?.content).not.toContain('命令没有 stdout/stderr（no output）');
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

describe('countTerminalLines', () => {
  it('全英文按字符数除以列宽计算', () => {
    expect(countTerminalLines('hello world', 80)).toBe(1);
    expect(countTerminalLines('a'.repeat(160), 80)).toBe(2);
    expect(countTerminalLines('a'.repeat(81), 80)).toBe(2);
  });

  it('中文字符按 2 列计算', () => {
    // 4 个中文 = 8 列
    expect(countTerminalLines('你好世界', 80)).toBe(1);
    // 5 个中文 = 10 列；如果终端只有 8 列，应该是 2 行
    expect(countTerminalLines('你好世界！', 8)).toBe(2);
    // 50 个中文 = 100 列；终端 80 列，应该是 2 行（不是按 .length 算出的 1 行）
    expect(countTerminalLines('中'.repeat(50), 80)).toBe(2);
  });

  it('中英混合正确计算列宽', () => {
    // "hi " = 3 列 + "你好" = 4 列 = 7 列
    expect(countTerminalLines('hi 你好', 80)).toBe(1);
    expect(countTerminalLines('hi 你好', 5)).toBe(2);
  });

  it('emoji 按宽字符计算', () => {
    // emoji 通常占 2 列
    expect(countTerminalLines('👍', 80)).toBe(1);
    expect(countTerminalLines('👍'.repeat(50), 80)).toBe(2);
  });

  it('多行文本逐行累加', () => {
    expect(countTerminalLines('line1\nline2\nline3', 80)).toBe(3);
    // 第一行短，第二行 100 列中文 → 1 + 2 = 3
    expect(countTerminalLines('short\n' + '中'.repeat(50), 80)).toBe(3);
  });

  it('ANSI 颜色码不计入宽度', () => {
    // \x1b[31mred\x1b[0m — 实际可见宽度 3
    const colored = '\x1b[31mred\x1b[0m';
    expect(countTerminalLines(colored, 80)).toBe(1);
    // 80 列内即使加上 ANSI 也只占 1 行
    expect(countTerminalLines(`\x1b[31m${'a'.repeat(80)}\x1b[0m`, 80)).toBe(1);
  });

  it('空字符串至少占 1 行', () => {
    expect(countTerminalLines('', 80)).toBe(1);
    expect(countTerminalLines('\n', 80)).toBe(2);
  });
});

describe('EventRenderer TUI 多消息回合', () => {
  function createFakeBridge() {
    return {
      dispatch: vi.fn(),
      addMessage: vi.fn(),
      updateLastMessage: vi.fn(),
      endAssistantMessage: vi.fn(),
      discardAssistantMessage: vi.fn(),
      updateTaskStatus: vi.fn(),
      clearTaskStatus: vi.fn(),
      setCurrentTool: vi.fn(),
      setStatus: vi.fn(),
      clearStatus: vi.fn(),
      promptSettings: vi.fn(async () => ''),
    } satisfies TUIBridge;
  }

  function textDeltaEvent(delta: string): AgentEvent {
    return {
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta,
        partial: partialMessage,
      },
    } as unknown as AgentEvent;
  }

  it('TUI 中只提交最后一段 assistant 回复，丢弃工具间碎碎念', async () => {
    const bridge = createFakeBridge();
    const renderer = new EventRenderer(bridge);

    // 第一轮 assistant 消息 "A"
    renderer.handleEvent({ type: 'agent_start' } as unknown as AgentEvent);
    renderer.handleEvent({
      type: 'message_start',
      message: { role: 'assistant' },
    } as unknown as AgentEvent);
    renderer.handleEvent(textDeltaEvent('A'));
    renderer.handleEvent({ type: 'message_end' } as unknown as AgentEvent);

    // 工具调用插在两条 assistant 消息之间
    renderer.handleEvent({
      type: 'tool_execution_start',
      toolName: 'bash',
    } as unknown as AgentEvent);
    renderer.handleEvent({
      type: 'tool_execution_end',
      toolName: 'bash',
      isError: false,
    } as unknown as AgentEvent);

    // 第二轮 assistant 消息 "B" —— 这里曾经会覆盖 "A"
    renderer.handleEvent({
      type: 'message_start',
      message: { role: 'assistant' },
    } as unknown as AgentEvent);
    renderer.handleEvent(textDeltaEvent('B'));
    renderer.handleEvent({ type: 'message_end' } as unknown as AgentEvent);
    renderer.handleEvent({ type: 'agent_end' } as unknown as AgentEvent);

    const addAssistantCalls = bridge.addMessage.mock.calls.filter(
      ([role]) => role === 'assistant',
    );
    expect(addAssistantCalls).toEqual([
      ['assistant', ''],
      ['assistant', ''],
    ]);

    const lastUpdates = bridge.updateLastMessage.mock.calls.map(([content]) => content);
    expect(lastUpdates).toContain('A');
    expect(lastUpdates).toContain('B');
    expect(lastUpdates).not.toContain('AB');
    expect(bridge.discardAssistantMessage).toHaveBeenCalledTimes(1);
    expect(bridge.endAssistantMessage).toHaveBeenCalledTimes(1);
  });

  it('TUI bridge stream commits once without final duplicate add', () => {
    const bridge = createFakeBridge();
    const renderer = new EventRenderer(bridge);

    renderer.handleEvent({ type: 'agent_start' } as unknown as AgentEvent);
    renderer.handleEvent({
      type: 'message_start',
      message: { role: 'assistant' },
    } as unknown as AgentEvent);
    renderer.handleEvent(textDeltaEvent('hello'));
    renderer.handleEvent({ type: 'message_end' } as unknown as AgentEvent);
    renderer.handleEvent({ type: 'agent_end' } as unknown as AgentEvent);

    const addAssistantCalls = bridge.addMessage.mock.calls.filter(
      ([role]) => role === 'assistant',
    );
    expect(addAssistantCalls).toEqual([['assistant', '']]);
    expect(bridge.updateLastMessage).toHaveBeenLastCalledWith('hello');
    expect(bridge.discardAssistantMessage).not.toHaveBeenCalled();
    expect(bridge.endAssistantMessage).toHaveBeenCalledTimes(1);
  });

  it('TUI 中不会为纯 TASK_START 协议信号创建空 assistant 消息', () => {
    const bridge = createFakeBridge();
    const renderer = new EventRenderer(bridge);

    renderer.handleEvent({ type: 'agent_start' } as unknown as AgentEvent);
    renderer.handleEvent({
      type: 'message_start',
      message: { role: 'assistant' },
    } as unknown as AgentEvent);
    renderer.handleEvent(textDeltaEvent(`[TASK_START name="修复渲染"]\nPhase 1: 定位\n`));
    renderer.handleEvent(textDeltaEvent('[/TASK_START]'));
    renderer.handleEvent({ type: 'message_end' } as unknown as AgentEvent);

    expect(bridge.addMessage).not.toHaveBeenCalledWith('assistant', expect.anything());
    expect(bridge.updateLastMessage).not.toHaveBeenCalled();
    expect(bridge.endAssistantMessage).not.toHaveBeenCalled();
  });
});
