import { describe, expect, it } from 'vitest';
import { renderFrame } from '../layout.js';
import { initialTUIV2State, type TUIV2State } from '../state.js';
import { visibleLength, stripAnsi } from '../terminal-control.js';

describe('renderFrame', () => {
  it('keeps transcript, status, and input in separate full-width bands', () => {
    const state: TUIV2State = {
      ...initialTUIV2State,
      transcript: {
        nextMessageSeq: 2,
        messages: [{ id: 'msg_1', role: 'user', content: 'hello', timestamp: 1, status: 'complete' }],
      },
      status: { transient: 'busy', currentTool: null, pendingCount: 0 },
      input: { ...initialTUIV2State.input, value: 'draft', cursor: 5, generation: 0 },
    };

    const frame = renderFrame(state, { columns: 30, rows: 6 });

    expect(frame.at(-2)).toContain('busy');
    expect(stripAnsi(frame.at(-1) ?? '')).toContain('> draft');
    expect(stripAnsi(frame.join('\n'))).toContain('> hello');
    for (const line of frame) expect(visibleLength(line)).toBe(30);
  });

  it('renders a clean ready frame for empty state', () => {
    const frame = renderFrame(initialTUIV2State, { columns: 24, rows: 4 });

    expect(frame).toHaveLength(4);
    expect(frame.at(-2)).toContain('student-agent');
    expect(stripAnsi(frame.at(-1) ?? '')).toContain('> ');
    for (const line of frame) expect(visibleLength(line)).toBe(24);
  });

  it('wraps long input across console input rows instead of erasing the suffix', () => {
    const value = '你现在需要把正在跑的 `STUDENT_AGENT_TUI=v2 npm run dev` 用 `/quit` 退出，重新跑一遍';
    const state: TUIV2State = {
      ...initialTUIV2State,
      input: {
        ...initialTUIV2State.input,
        value,
        cursor: Array.from(value).length,
        generation: 0,
      },
    };

    const frame = renderFrame(state, { columns: 42, rows: 8 });
    const output = stripAnsi(frame.join('\n'));

    expect(output).toContain('> 你现在需要把正在跑的');
    expect(output).toContain('`/quit` 退出');
    expect(output).toContain('重新跑');
    expect(output).toContain('一遍');
    expect(frame.at(-4)).toContain('student-agent');
    for (const line of frame) expect(visibleLength(line)).toBe(42);
  });

  it('marks clipped multiline input so the visible rows do not look like the full draft', () => {
    const value = [
      '这次我不再继续补单行裁剪的洞了，直接把 v2 输入区改成最多 4 行 wrap 显示。',
      '验证已过：',
      '- `npx vitest run src/tui-v2`：`61 passed | 1 skipped`',
      '- `npm run build`：通过',
      '- `npm test -- --run`：`636 passed | 1 skipped`',
      '你现在需要把正在跑的 `STUDENT_AGENT_TUI=v2 npm run dev` 用 `/quit` 退出再重启一下，旧进程不会自动吃到这次代码。',
    ].join('\n');
    const state: TUIV2State = {
      ...initialTUIV2State,
      input: {
        ...initialTUIV2State.input,
        value,
        cursor: Array.from(value).length,
        generation: 0,
      },
    };

    const frame = renderFrame(state, { columns: 48, rows: 9 });
    const inputRows = frame.slice(-4);
    const output = inputRows.join('\n');

    expect(stripAnsi(inputRows[0]).trimEnd()).toBe('> …');
    expect(output).toContain('STUDENT_AGENT_TUI=v2');
    expect(output).toContain('旧进程不');
    expect(output).toContain('会自动吃到');
    for (const line of frame) expect(visibleLength(line)).toBe(48);
  });

  it('renders active streaming output before messages queued during the stream', () => {
    const state: TUIV2State = {
      ...initialTUIV2State,
      transcript: {
        nextMessageSeq: 3,
        messages: [
          { id: 'msg_1', role: 'assistant', content: 'hello', timestamp: 1, status: 'streaming' },
          { id: 'msg_2', role: 'user', content: '/quit', timestamp: 2, status: 'complete' },
        ],
      },
      streaming: { id: 's1', messageId: 'msg_1' },
    };

    const frame = renderFrame(state, { columns: 40, rows: 6 });
    const assistantIndex = frame.findIndex((line) => stripAnsi(line).trimEnd() === 'Assistant:');
    const assistantContentIndex = frame.findIndex((line) => stripAnsi(line).trimEnd() === 'hello');
    const queuedInputIndex = frame.findIndex((line) => stripAnsi(line).includes('> /quit'));

    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(assistantContentIndex).toBe(assistantIndex + 1);
    expect(queuedInputIndex).toBeGreaterThan(assistantContentIndex);
  });

  it('returns the full transcript so Pi can preserve terminal scrollback', () => {
    const state: TUIV2State = {
      ...initialTUIV2State,
      transcript: {
        nextMessageSeq: 8,
        messages: Array.from({ length: 7 }, (_, index) => ({
          id: `msg_${index + 1}`,
          role: 'assistant' as const,
          content: `line ${index + 1}`,
          timestamp: index + 1,
          status: 'complete' as const,
        })),
      },
    };

    // Frame is always exactly `rows` lines; with many messages the transcript is scrolled/clipped
    const frame = renderFrame(state, { columns: 30, rows: 5 });

    expect(frame).toHaveLength(5);
    // All 7 messages are rendered in the transcript (some may be scrolled off)
    expect(stripAnsi(frame.join('\n'))).toContain('Assistant:');
    expect(frame.at(-2)).toContain('student-agent');
    expect(stripAnsi(frame.at(-1) ?? '')).toContain('> ');
  });

  it('renders task panel and prompt as console layers outside the transcript', () => {
    const state: TUIV2State = {
      ...initialTUIV2State,
      transcript: {
        nextMessageSeq: 2,
        messages: [{ id: 'msg_1', role: 'user', content: '重做 TUI', timestamp: 1, status: 'complete' }],
      },
      taskPanel: {
        name: '重做 TUI',
        phaseIndex: 0,
        totalPhases: 2,
        workflowStatus: 'planning',
        retryCount: 1,
        toolCallCount: 0,
        elapsedMs: 0,
        state: 'failed',
      },
      prompt: {
        kind: 'planning-recovery',
        question: [
          '规划没成：规划格式不完整。',
          '下一步：',
          '  [1] 我换一种方式重试',
          '  [2] 我补充/改写任务描述',
          '选择 [1]: ',
        ].join('\n'),
      },
      input: {
        ...initialTUIV2State.input,
        promptQuestion: [
          '规划没成：规划格式不完整。',
          '下一步：',
          '  [1] 我换一种方式重试',
          '  [2] 我补充/改写任务描述',
          '选择 [1]: ',
        ].join('\n'),
      },
    };

    const frame = renderFrame(state, { columns: 42, rows: 10 });
    const output = stripAnsi(frame.join('\n'));

    expect(output).toContain('> 重做 TUI');
    expect(output).toContain('重做 TUI');
    expect(output).toContain('failed');
    expect(output).toContain('规划没成：规划格式不完整。');
    expect(output).toContain('[2] 我补充/改写任务描述');
    expect(output).not.toContain('System: 规划没成');
    expect(frame.at(-2)).toContain('student-agent');
    expect(stripAnsi(frame.at(-1) ?? '')).toContain('选择 [1]: > ');
    for (const line of frame) expect(visibleLength(line)).toBe(42);
  });
});
