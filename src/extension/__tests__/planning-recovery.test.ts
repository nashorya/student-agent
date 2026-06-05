import { describe, expect, it } from 'vitest';
import {
  buildPlanningRecoveryPromptQuestion,
  buildPlanningRecoveryMenu,
  buildPlanningRetryRequest,
  classifyPlanningFailure,
  mergePlanningRevision,
  parsePlanningRecoveryAnswer,
} from '../planning-recovery.js';

describe('planning recovery policy', () => {
  it('classifies broad glob FileGuard failures without exposing raw internals as the summary', () => {
    const failure = classifyPlanningFailure({
      reason: 'error',
      detail: new Error('[FileGuard] glob 模式过于宽泛，会扫描数千文件。请加上具体目录前缀。'),
    });

    expect(failure.kind).toBe('fileguard_glob_too_broad');
    expect(failure.userSummary).toBe('读取范围太宽');
    expect(failure.retryHint).toContain('更具体的目录');
    expect(failure.internalDetail).toContain('glob 模式过于宽泛');
  });

  it('classifies missing TASK_START as an invalid planning format', () => {
    const failure = classifyPlanningFailure({
      reason: 'missing-task-start',
      planText: '我会先看一下项目，然后再决定。',
    });

    expect(failure.kind).toBe('missing_task_start');
    expect(failure.userSummary).toBe('规划格式不完整');
    expect(failure.retryHint).toContain('TASK_START');
  });

  it('builds a two-choice recovery menu that is useful to the user', () => {
    const failure = classifyPlanningFailure({
      reason: 'error',
      detail: new Error('[FileGuard] pi-mono/ 是只读参考包，不要直接读取其文件。'),
    });

    expect(buildPlanningRecoveryMenu(failure)).toBe([
      '规划没成：参考包不可直接读取。',
      '下一步：',
      '  [1] 我换一种方式重试',
      '  [2] 我补充/改写任务描述',
      '  [q] 取消',
    ].join('\n'));
  });

  it('builds a prompt question that carries the recovery menu without needing a transcript message', () => {
    const failure = classifyPlanningFailure({
      reason: 'missing-task-start',
      planText: '我会先看一下项目。',
    });

    expect(buildPlanningRecoveryPromptQuestion(failure)).toBe([
      '规划没成：规划格式不完整。',
      '下一步：',
      '  [1] 我换一种方式重试',
      '  [2] 我补充/改写任务描述',
      '  [q] 取消',
      '选择 [1]: ',
    ].join('\n'));
  });

  it('parses retry, revise, and cancel answers', () => {
    expect(parsePlanningRecoveryAnswer('')).toBe('retry');
    expect(parsePlanningRecoveryAnswer('1')).toBe('retry');
    expect(parsePlanningRecoveryAnswer('重试')).toBe('retry');
    expect(parsePlanningRecoveryAnswer('2')).toBe('revise');
    expect(parsePlanningRecoveryAnswer('改写')).toBe('revise');
    expect(parsePlanningRecoveryAnswer('q')).toBe('cancel');
  });

  it('builds retry and revision requests with failure context for the next planning attempt', () => {
    const failure = classifyPlanningFailure({
      reason: 'error',
      detail: new Error('[FileGuard] 规划阶段最近 30 次工具调用中已读取 4 个文件（上限 3）。'),
    });

    expect(buildPlanningRetryRequest('重做 TUI', failure)).toContain('上一轮规划失败原因：规划读取次数超限');
    expect(buildPlanningRetryRequest('重做 TUI', failure)).toContain('不要继续读取文件');
    expect(mergePlanningRevision('重做 TUI', '只处理 src/tui-v2')).toContain('补充说明：\n只处理 src/tui-v2');
  });
});
