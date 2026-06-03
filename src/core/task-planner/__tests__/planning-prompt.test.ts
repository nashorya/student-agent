import { describe, expect, it } from 'vitest';
import { buildPhaseExecutionPrompt, buildPlanningPrompt, buildPlanningRepairPrompt } from '../planning-prompt.js';

describe('buildPlanningPrompt', () => {
  it('requires at least execution and verification phases even for small tasks', () => {
    const prompt = buildPlanningPrompt('更新 project.txt');

    expect(prompt).toContain('至少拆成“执行”和“验证”两个 Phase');
    expect(prompt).toContain('[TASK_CONTEXT]');
  });
});

describe('buildPlanningRepairPrompt', () => {
  it('reprompts invalid plans without allowing tools or file edits', () => {
    const prompt = buildPlanningRepairPrompt('更新 project.txt');

    expect(prompt).toContain('上一轮输出没有形成 2 至 5 个有效 Phase');
    expect(prompt).toContain('不要读取文件，不要调用工具，不要修改文件');
    expect(prompt).toContain('[TASK_CONTEXT]');
    expect(prompt).toContain('[TASK_START name="简短任务名称"]');
  });
});

describe('buildPhaseExecutionPrompt', () => {
  it('uses external 1-based phase numbers in PHASE_DONE signals', () => {
    const phase1Prompt = buildPhaseExecutionPrompt('任务', '第一步', 0, 3);
    const phase3Prompt = buildPhaseExecutionPrompt('任务', '第三步', 2, 3);

    expect(phase1Prompt).toContain('[PHASE_DONE phase=1]');
    expect(phase1Prompt).toContain('[/PHASE_DONE]');
    expect(phase3Prompt).toContain('[PHASE_DONE phase=3]');
  });

  it('recommends apply_patch for structural file edits', () => {
    const prompt = buildPhaseExecutionPrompt('任务', '修改文件', 0, 1);

    expect(prompt).toContain('优先使用 apply_patch');
    expect(prompt).toContain('edit 只用于小范围');
  });

  it('requires uncertainty when tool failures make checks unverified', () => {
    const prompt = buildPhaseExecutionPrompt('任务', '审计并验证', 0, 1);

    expect(prompt).toContain('区分“已验证事实”和“失败/未验证检查”');
    expect(prompt).toContain('不要仅凭失败工具输出给出确定审计结论');
  });
});
