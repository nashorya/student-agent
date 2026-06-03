import { beforeEach, describe, it, expect, vi } from 'vitest';
import { classifyIntent, classifyWorkflowIntent, isInformationalFollowUp, isMetaQuestion } from '../intent-classifier.js';

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: vi.fn(),
}));

import { completeSimple } from '@mariozechner/pi-ai';

const mockModel = { id: 'test', api: 'anthropic', provider: 'anthropic' } as any;

describe('classifyIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns deterministic new_task with workflow metadata', async () => {
    const result = await classifyIntent('帮我改首页的颜色', null, mockModel);
    expect(result).toMatchObject({
      type: 'new_task',
      level: 3,
      requiresPlan: true,
      requiresUserAcceptance: true,
      requiresVisualReview: true,
    });
    expect(completeSimple).not.toHaveBeenCalled();
  });

  it('falls back to LLM for ambiguous new task with extracted name', async () => {
    vi.mocked(completeSimple).mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"type":"new_task","task_name":"修改首页颜色方案"}' }],
    } as any);
    const result = await classifyIntent('需要处理一下这个事情', null, mockModel);
    expect(result).toMatchObject({
      type: 'new_task',
      taskName: '修改首页颜色方案',
      level: 2,
      requiresPlan: false,
    });
  });

  it('returns continue when LLM says continue', async () => {
    vi.mocked(completeSimple).mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"type":"continue"}' }],
    } as any);
    const result = await classifyIntent('好的，继续', '修改首页', mockModel);
    expect(result).toMatchObject({ type: 'continue', level: 0, requiresPlan: false });
  });

  it('falls back to continue on LLM error', async () => {
    vi.mocked(completeSimple).mockRejectedValueOnce(new Error('network'));
    const result = await classifyIntent('随便说一句', null, mockModel);
    expect(result.type).toBe('continue');
  });

  it('short-circuits meta questions without calling LLM', async () => {
    const result = await classifyIntent('我想让你学习某个网站的设计，该怎么做', null, mockModel);

    expect(result).toMatchObject({ type: 'continue', level: 0 });
    expect(completeSimple).not.toHaveBeenCalled();
  });
});

describe('classifyWorkflowIntent', () => {
  it('keeps simple analysis at level 0', () => {
    expect(classifyWorkflowIntent('只分析一下这个文件怎么工作，先别改', null)).toMatchObject({
      type: 'continue',
      level: 0,
    });
  });

  it.each([
    '测试这么多吗，主要是 eval 那部分吗',
    '测试这么多，主要是哪些，是 eval 吗',
    '你有多少代码量，多少 commit',
    '这个结果说明什么',
  ])('keeps informational/stat follow-up at level 0: %s', (input) => {
    expect(classifyWorkflowIntent(input, null)).toMatchObject({
      type: 'continue',
      level: 0,
      requiresPlan: false,
    });
  });

  it('still treats explicit eval test fixes as planned engineering work', () => {
    expect(classifyWorkflowIntent('帮我修复 eval 测试', null)).toMatchObject({
      type: 'new_task',
      level: 3,
      requiresPlan: true,
    });
  });

  it('uses level 3 for explicit plan requests', () => {
    expect(classifyWorkflowIntent('请制定计划，分阶段改造 task runtime', null)).toMatchObject({
      type: 'new_task',
      level: 3,
      requiresPlan: true,
    });
  });

  it('reserves level 4 for long-running or subagent requests', () => {
    expect(classifyWorkflowIntent('开一个跨 session 的长期任务，后面让子代理继续', null)).toMatchObject({
      type: 'new_task',
      level: 4,
      requiresPlan: true,
    });
  });
});

describe('isInformationalFollowUp', () => {
  it.each([
    '测试这么多吗，主要是 eval 那部分吗',
    '测试这么多，主要是哪些，是 eval 吗',
    '你有多少代码量，多少 commit',
    '这个结果说明什么',
  ])('allows planning fallback for Q&A/stat prompts: %s', (input) => {
    expect(isInformationalFollowUp(input)).toBe(true);
  });

  it.each([
    '修复 eval 测试',
    '请制定计划，分阶段改造 task runtime',
    '开任务，进入 task 模式实现这个多文件改造',
  ])('does not allow planning fallback for task prompts: %s', (input) => {
    expect(isInformationalFollowUp(input)).toBe(false);
  });
});

describe('isMetaQuestion', () => {
  it.each([
    '我想让你学习某个网站的设计，该怎么做',
    '怎么使用 design study 技能？',
    '你能不能学习网页风格？',
    '这个命令怎么触发',
  ])('detects meta question: %s', (input) => {
    expect(isMetaQuestion(input)).toBe(true);
  });

  it.each([
    '帮我改首页颜色',
    '实现登录页面',
    '修复 Failed to load 错误',
  ])('does not treat task request as meta question: %s', (input) => {
    expect(isMetaQuestion(input)).toBe(false);
  });
});
