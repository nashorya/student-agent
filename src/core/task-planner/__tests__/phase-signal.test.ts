import { describe, it, expect } from 'vitest';
import { parsePhaseSignal, stripPhaseSignals } from '../phase-signal.js';

describe('parsePhaseSignal', () => {
  it('parses TASK_START signal', () => {
    const text = `[TASK_START name="调整首页颜色"]
Phase 1: 分析当前 CSS
Phase 2: 修改颜色值
Phase 3: 验证微信渲染
[/TASK_START]`;
    const result = parsePhaseSignal(text);
    expect(result).toEqual({
      type: 'task_start',
      name: '调整首页颜色',
      phases: ['分析当前 CSS', '修改颜色值', '验证微信渲染'],
    });
  });

  it('parses PHASE_DONE signal', () => {
    const text = `[PHASE_DONE phase=1]
已完成：将 opacity 写法改为 hex 值。
下一步：验证微信渲染效果。
[/PHASE_DONE]`;
    const result = parsePhaseSignal(text);
    expect(result).toEqual({
      type: 'phase_done',
      phaseIndex: 1,
      summary: '已完成：将 opacity 写法改为 hex 值。',
      nextStepHint: '下一步：验证微信渲染效果。',
    });
  });

  it('returns null when no signal', () => {
    expect(parsePhaseSignal('普通的回复内容')).toBeNull();
  });

  it('stripPhaseSignals removes signal blocks from text', () => {
    const text = `做了一些修改。\n[PHASE_DONE phase=1]\n已完成。\n[/PHASE_DONE]\n请确认。`;
    expect(stripPhaseSignals(text)).toBe('做了一些修改。\n\n请确认。');
  });
});
