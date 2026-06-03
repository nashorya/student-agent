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

  it('parses optional TASK_CONTEXT with task start', () => {
    const text = `[TASK_CONTEXT]
goal: 更新项目文档
acceptance_criteria: 文档存在 | 内容覆盖状态机
constraints: 不改 runtime
open_questions: 是否需要截图
requires_user_acceptance: true
requires_visual_review: false
[/TASK_CONTEXT]
[TASK_START name="更新文档"]
Phase 1: 编写文档
Phase 2: 验证 diff
[/TASK_START]`;

    const result = parsePhaseSignal(text);

    expect(result).toMatchObject({
      type: 'task_start',
      name: '更新文档',
      phases: ['编写文档', '验证 diff'],
      context: {
        goal: '更新项目文档',
        acceptance_criteria: ['文档存在', '内容覆盖状态机'],
        constraints: ['不改 runtime'],
        open_questions: ['是否需要截图'],
        requires_user_acceptance: true,
        requires_visual_review: false,
      },
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

  it('parses Phase lines with parenthetical labels and full-width punctuation', () => {
    const text = `[TASK_START name="更新 project.txt 状态标记"]
Phase 1（执行）：一次编辑 project.txt，将 "Phase A: todo" 替换为 "Phase A: done"。

Phase 2（验证）：读取 project.txt，确认两行均已正确更新。
[/TASK_START]`;

    const result = parsePhaseSignal(text);

    expect(result).toEqual({
      type: 'task_start',
      name: '更新 project.txt 状态标记',
      phases: [
        '一次编辑 project.txt，将 "Phase A: todo" 替换为 "Phase A: done"。',
        '读取 project.txt，确认两行均已正确更新。',
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

  it('rejects leaked control markers as phase descriptions', () => {
    const text = `[TASK_START name="个人博客站点搭建"]
Phase 1: [TASK_START name="个人博客站点搭建"]
Phase 2: [TASK_START name="个人博客站点搭建"]
Phase 3: **新 [TASK_START name="个人博客站点搭建"]
Phase 4: **新 [TASK_START name="个人博客站点搭建"]
Phase 5: **新项目初始化 [TASK_START name="个人博客站点搭建"]
[/TASK_START]`;

    const result = parsePhaseSignal(text);

    expect(result).toEqual({
      type: 'task_start',
      name: '个人博客站点搭建',
      phases: [],
    });
  });

  it('rejects duplicate phase descriptions', () => {
    const text = `[TASK_START name="重复计划"]
Phase 1: 检查项目结构
Phase 2: 检查项目结构
[/TASK_START]`;

    const result = parsePhaseSignal(text);

    expect(result).toEqual({
      type: 'task_start',
      name: '重复计划',
      phases: [],
    });
  });

  it('rejects single-phase plans because planning requires a real decomposition', () => {
    const text = `[TASK_START name="单阶段"]
Phase 1: 完成所有事情
[/TASK_START]`;

    const result = parsePhaseSignal(text);

    expect(result).toEqual({
      type: 'task_start',
      name: '单阶段',
      phases: [],
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

  it('parses bare PHASE_DONE signals emitted without a closing tag', () => {
    const result = parsePhaseSignal('本阶段已处理完毕。\n[PHASE_DONE phase=2]');

    expect(result).toEqual({
      type: 'phase_done',
      phaseIndex: 1,
      summary: '',
      nextStepHint: '',
    });
  });

  it('parses PHASE_DONE signals appended after prose on the same line', () => {
    const result = parsePhaseSignal('已经确认当前内容，直接修改第一行。[PHASE_DONE phase=2]\n已完成：第一行已更新。\n[/PHASE_DONE]');

    expect(result).toEqual({
      type: 'phase_done',
      phaseIndex: 1,
      summary: '已完成：第一行已更新。',
      nextStepHint: '',
    });
  });

  it('prefers a later PHASE_DONE over an earlier TASK_START block in combined trace text', () => {
    const text = `[TASK_START name="更新 project.txt"]
Phase 1: 读取 project.txt
Phase 2: 编辑 project.txt
[/TASK_START]
已完成读取。
[PHASE_DONE phase=1]`;

    expect(parsePhaseSignal(text)).toEqual({
      type: 'phase_done',
      phaseIndex: 0,
      summary: '',
      nextStepHint: '',
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

  it('stripPhaseSignals removes TASK_CONTEXT blocks', () => {
    const text = `规划如下。\n[TASK_CONTEXT]\ngoal: x\n[/TASK_CONTEXT]\n请确认。`;
    expect(stripPhaseSignals(text)).toBe('规划如下。\n\n请确认。');
  });

  it('stripPhaseSignals hides an unfinished TASK_START block while streaming', () => {
    const text = `正在规划。\n[TASK_START name="修复渲染"]\nPhase 1: 定位 TUI\nPhase 2: 修复输出`;
    expect(stripPhaseSignals(text)).toBe('正在规划。');
  });

  it('stripPhaseSignals hides leaked raw phase plans', () => {
    const text = `Phase 1: **定位问题**\n1. **Markdown 未渲染** - system 消息保留原文\nPhase 2: 修复`;
    expect(stripPhaseSignals(text)).toBe('');
  });

  it('stripPhaseSignals hides leaked raw phase plans with parenthetical labels', () => {
    const text = `Phase 1（执行）：定位问题\nPhase 2（验证）：确认结果`;
    expect(stripPhaseSignals(text)).toBe('');
  });
});
