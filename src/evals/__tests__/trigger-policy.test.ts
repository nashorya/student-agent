import { describe, expect, it } from 'vitest';
import { classifyWorkflowIntent } from '../../core/task-planner/intent-classifier.js';

describe('Eval v2 trigger policy slice', () => {
  it.each([
    '这个命令怎么用？',
    '只解释一下这个文件怎么工作，先别改',
    '我想了解 task 状态机是什么？',
    '测试这么多吗，主要是 eval 那部分吗',
    '测试这么多，主要是哪些，是 eval 吗',
    '你有多少代码量，多少 commit',
    '这个结果说明什么',
  ])('does not enter full task/plan for simple questions: %s', (input) => {
    expect(classifyWorkflowIntent(input, null)).toMatchObject({
      type: 'continue',
      level: 0,
      requiresPlan: false,
    });
  });

  it.each([
    '请制定计划，分阶段改造 task runtime',
    '开任务，进入 task 模式实现这个多文件改造',
  ])('enters full plan mode for explicit plan requests: %s', (input) => {
    expect(classifyWorkflowIntent(input, null)).toMatchObject({
      type: 'new_task',
      level: 3,
      requiresPlan: true,
    });
  });

  it('keeps clear low-risk edits below full plan mode', () => {
    expect(classifyWorkflowIntent('帮我更新 README 的一句文案', null)).toMatchObject({
      type: 'new_task',
      level: 1,
      requiresPlan: false,
    });
  });

  it('keeps explicit eval repair in full plan mode', () => {
    expect(classifyWorkflowIntent('帮我修复 eval 测试', null)).toMatchObject({
      type: 'new_task',
      level: 3,
      requiresPlan: true,
    });
  });

  it('marks frontend work as visual/user-review work', () => {
    expect(classifyWorkflowIntent('帮我调整首页按钮布局', null)).toMatchObject({
      type: 'new_task',
      level: 3,
      requiresPlan: true,
      requiresUserAcceptance: true,
      requiresVisualReview: true,
    });
  });
});
