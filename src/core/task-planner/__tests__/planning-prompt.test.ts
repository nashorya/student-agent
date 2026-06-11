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

  it('requires real tool calls instead of describing intended actions', () => {
    const prompt = buildPhaseExecutionPrompt('任务', '读取并修改文件', 0, 2);

    expect(prompt).toContain('必须实际调用工具');
    expect(prompt).toContain('不要只用文字描述');
    expect(prompt).toContain('没有实际完成本 Phase 目标前，不要输出 PHASE_DONE');
  });

  it('keeps analysis and design phases read-only unless implementation is explicit', () => {
    const prompt = buildPhaseExecutionPrompt('架构理解', '分析 gateway.conf 路由加载流程，并设计动态热重载架构方案', 0, 2);

    expect(prompt).toContain('本 Phase 判定为分析/方案类');
    expect(prompt).toContain('不要修改任何文件');
    expect(prompt).toContain('结论、设计方案或审计结果');
    expect(prompt).toContain('不要调用 edit/write/apply_patch');
    expect(prompt).not.toContain('修改文件前必须先读取');
    expect(prompt).not.toContain('优先使用 apply_patch');
  });

  it('tells the model to use project-relative paths without asking the user', () => {
    const prompt = buildPhaseExecutionPrompt('任务', '读取 src/math.ts', 0, 2);

    expect(prompt).toContain('路径默认是相对项目根目录');
    expect(prompt).toContain('直接用 Phase 目标中的相对路径调用工具');
    expect(prompt).toContain('不要向用户询问路径格式');
  });
});
