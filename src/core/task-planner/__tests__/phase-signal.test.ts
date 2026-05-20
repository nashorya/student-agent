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

  it('only counts explicit Phase lines and folds wrapped text into the previous phase', () => {
    const text = `先说明一点：我会规划。
[TASK_START name="今日饮食支持热量"]
Phase 1: 摸清接口契约
继续说明本阶段涉及 DTO 和 service。
Phase 2: 扩展前端 service
Phase 3: 改造首页卡片
[/TASK_START]`;
    const result = parsePhaseSignal(text);
    expect(result).toEqual({
      type: 'task_start',
      name: '今日饮食支持热量',
      phases: [
        '摸清接口契约 继续说明本阶段涉及 DTO 和 service。',
        '扩展前端 service',
        '改造首页卡片',
      ],
    });
  });

  it('caps parsed phases at five to keep invalid plans bounded', () => {
    const text = `[TASK_START name="过度规划"]
Phase 1: 一
Phase 2: 二
Phase 3: 三
Phase 4: 四
Phase 5: 五
Phase 6: 六
[/TASK_START]`;
    const result = parsePhaseSignal(text);
    expect(result).toMatchObject({
      type: 'task_start',
      phases: ['一', '二', '三', '四', '五'],
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
      phaseIndex: 0,
      summary: '已完成：将 opacity 写法改为 hex 值。',
      nextStepHint: '下一步：验证微信渲染效果。',
    });
  });

  it('normalizes external 1-based phase numbers to internal 0-based indexes', () => {
    expect(parsePhaseSignal('[PHASE_DONE phase=1]\n完成\n[/PHASE_DONE]')).toMatchObject({
      type: 'phase_done',
      phaseIndex: 0,
    });
    expect(parsePhaseSignal('[PHASE_DONE phase=4]\n完成\n[/PHASE_DONE]')).toMatchObject({
      type: 'phase_done',
      phaseIndex: 3,
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
