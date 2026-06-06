import { describe, expect, it, vi } from 'vitest';
import { CURSOR_MARKER } from '@earendil-works/pi-tui';
import { createPiTUIV2ForTest } from '../pi-runtime.js';
import { stripAnsi } from '../terminal-control.js';

describe('Pi TUI v2 runtime', () => {
  it('renders the v2 frame through a Pi component', async () => {
    const runtime = createPiTUIV2ForTest({
      columns: 32,
      rows: 5,
      onSubmit: vi.fn(),
      onAbort: vi.fn(),
    });

    await runtime.flush();

    expect(runtime.frame().at(-3)).toContain('student-agent');
    expect(runtime.frame().at(-1)).toContain('> ');
    expect(runtime.output()).toContain('\x1b[?2026h');

    runtime.unmount();
  });

  it('routes bracketed paste through Pi stdin buffering as one multiline submit', async () => {
    const onSubmit = vi.fn();
    const runtime = createPiTUIV2ForTest({
      columns: 40,
      rows: 5,
      onSubmit,
      onAbort: vi.fn(),
    });

    runtime.receiveInput('\x1b[200~第一行\n第二行\x1b[201~\n');
    await runtime.flush();

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith('第一行\n第二行');

    runtime.unmount();
  });

  it('maps Kitty ctrl+c to exit instead of text input while idle', async () => {
    const onExit = vi.fn();
    const runtime = createPiTUIV2ForTest({
      columns: 40,
      rows: 5,
      onSubmit: vi.fn(),
      onAbort: vi.fn(),
      onExit,
    });

    runtime.receiveInput('\x1b[99;5u');
    await runtime.flush();

    expect(onExit).toHaveBeenCalledOnce();
    expect(runtime.frame().join('\n')).not.toContain('[99;5u');

    runtime.unmount();
  });

  it('renders a visual cursor without hiding text after the cursor', async () => {
    const runtime = createPiTUIV2ForTest({
      columns: 40,
      rows: 5,
      onSubmit: vi.fn(),
      onAbort: vi.fn(),
    });

    runtime.receiveInput('abcdef');
    runtime.receiveInput('\x1b[D\x1b[D\x1b[D');
    await runtime.flush();

    const output = runtime.output();
    expect(output).toContain('\x1b[7m');
    expect(output).not.toContain(CURSOR_MARKER);
    expect(output).not.toContain('\x1b[?25h');
    expect(stripAnsi(output)).toContain('abcdef');

    runtime.unmount();
  });

  it('wraps long focused input without leaking a hardware cursor', async () => {
    const runtime = createPiTUIV2ForTest({
      columns: 42,
      rows: 8,
      onSubmit: vi.fn(),
      onAbort: vi.fn(),
    });

    runtime.receiveInput('你现在需要把正在跑的 `STUDENT_AGENT_TUI=v2 npm run dev` 用 `/quit` 退出，重新跑一遍');
    await runtime.flush();

    const output = runtime.output();
    expect(output).toContain('\x1b[7m');
    expect(output).not.toContain(CURSOR_MARKER);
    expect(output).not.toContain('\x1b[?25h');
    expect(stripAnsi(output)).toContain('`/quit` 退出');
    expect(stripAnsi(output)).toContain('重新跑');
    expect(stripAnsi(output)).toContain('一遍');

    runtime.unmount();
  });

  it('renders prompt panels through the Pi runtime and resolves the answer', async () => {
    const runtime = createPiTUIV2ForTest({
      columns: 48,
      rows: 8,
      onSubmit: vi.fn(),
      onAbort: vi.fn(),
    });

    const answer = runtime.bridge.promptSettings([
      '规划没成：规划格式不完整。',
      '下一步：',
      '  [1] 我换一种方式重试',
      '  [2] 我补充/改写任务描述',
      '选择 [1]: ',
    ].join('\n'));
    await runtime.flush();

    const frame = runtime.frame().join('\n');
    expect(frame).toContain('规划没成：规划格式不完整。');
    expect(frame).toContain('[2] 我补充/改写任务描述');
    expect(frame).toContain('选择 [1]: > ');

    runtime.receiveInput('2\n');
    await expect(answer).resolves.toBe('2');

    runtime.unmount();
  });
});
