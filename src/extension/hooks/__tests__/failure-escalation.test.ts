import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FailureEscalationContext } from '../failure-escalation.js';
import { _resetForTesting as resetSnapshotForTesting } from '../snapshot.js';
import type { PostToolCallContext } from '../../../core/pi-bridge/types.js';

function makeErrorContext(resultText: string): PostToolCallContext {
  return {
    toolName: 'exec_command',
    toolCallId: 'tool_1',
    args: { cmd: 'npm test' },
    isError: true,
    resultText,
  };
}

describe('failure escalation', () => {
  beforeEach(() => {
    resetSnapshotForTesting();
  });

  it('第二次连续失败时注入 Context7 文档', async () => {
    const ctx = new FailureEscalationContext({
      context7Client: {
        query: async () => ({
          libraryId: '/reactjs/react.dev',
          topic: 'unknown',
          content: 'React docs snippet',
          source: 'context7',
        }),
      },
    });
    ctx.initTask('修复 React hooks 测试失败', process.cwd());
    const hook = ctx.createHook();

    await hook(makeErrorContext('first React failure'));
    const decision = await hook(makeErrorContext('second React failure'));

    expect(decision?.terminate).toBe(false);
    expect(decision?.overrideContent).toContain('辅助诊断：已触发 Context7 文档检索');
    expect(decision?.overrideContent).toContain('/reactjs/react.dev');
    expect(decision?.overrideContent).toContain('React docs snippet');
  });

  it('Context7 不可用时降级为恢复建议', async () => {
    const ctx = new FailureEscalationContext({
      context7Client: {
        query: async () => {
          throw new Error('network down');
        },
      },
    });
    ctx.initTask('修复 Playwright 测试失败', process.cwd());
    const hook = ctx.createHook();

    await hook(makeErrorContext('first Playwright failure'));
    const decision = await hook(makeErrorContext('second Playwright failure'));

    expect(decision?.terminate).toBe(false);
    expect(decision?.overrideContent).toContain('没有可用文档可注入');
    expect(decision?.overrideContent).toContain('Context7 检索不可用');
  });

  it('edit 精确文本失败时第二次不触发 Context7，要求重新读取目标文件', async () => {
    const query = vi.fn();
    const ctx = new FailureEscalationContext({
      context7Client: { query },
    });
    ctx.initTask('调整首页推荐菜谱位置', process.cwd());
    const hook = ctx.createHook();
    const error = 'Could not find the exact text in src/pages/home/index.tsx. The oldText must match exactly including all whitespace and newlines.';

    await hook(makeErrorContext(error));
    const decision = await hook(makeErrorContext(error));

    expect(query).not.toHaveBeenCalled();
    expect(decision?.overrideContent).toContain('跳过 Context7');
    expect(decision?.overrideContent).toContain('先重新读取 src/pages/home/index.tsx');
    expect(decision?.overrideContent).toContain('不要再次提交同一段 oldText');
  });

  it('第一次失败时显示回滚成功结果', async () => {
    const ctx = new FailureEscalationContext({
      getLastSnapshotId: () => 'snap_1',
      restoreSnapshot: async () => {},
    });
    ctx.initTask('测试任务', process.cwd());
    const hook = ctx.createHook();

    const decision = await hook(makeErrorContext('failure'));

    expect(decision?.overrideContent).toContain('恢复动作：已自动回滚到工具调用前的状态（snapshot: snap_1）');
  });

  it('第一次失败时显示回滚失败原因', async () => {
    const ctx = new FailureEscalationContext({
      getLastSnapshotId: () => 'snap_2',
      restoreSnapshot: async () => {
        throw new Error('dirty worktree');
      },
    });
    ctx.initTask('测试任务', process.cwd());
    const hook = ctx.createHook();

    const decision = await hook(makeErrorContext('failure'));

    expect(decision?.overrideContent).toContain('恢复动作：自动回滚失败（snapshot: snap_2）：dirty worktree');
  });

  it('成功调用重置连续失败计数', async () => {
    const ctx = new FailureEscalationContext({});
    ctx.initTask('测试任务', process.cwd());
    const hook = ctx.createHook();

    // 第一次失败
    await hook(makeErrorContext('failure'));
    // 成功 → 重置计数
    await hook({ toolName: 'read_file', toolCallId: 'tool_2', args: {}, isError: false, resultText: 'ok' });
    // 再次失败 → 应该是 attempt 1（不是 attempt 2）
    const decision = await hook(makeErrorContext('another failure'));

    expect(decision?.terminate).toBe(false);
    // attempt 1 的输出包含恢复建议，不包含 Context7
    expect(decision?.overrideContent).not.toContain('Context7');
  });

  it('不同实例不共享状态', async () => {
    const ctx1 = new FailureEscalationContext({});
    const ctx2 = new FailureEscalationContext({});
    ctx1.initTask('任务1', process.cwd());
    ctx2.initTask('任务2', process.cwd());
    const hook1 = ctx1.createHook();
    const hook2 = ctx2.createHook();

    // ctx1 连续失败 2 次
    await hook1(makeErrorContext('failure 1'));
    await hook1(makeErrorContext('failure 2'));

    // ctx2 第一次失败 → 应该是 attempt 1，不受 ctx1 影响
    const decision = await hook2(makeErrorContext('failure'));
    expect(decision?.terminate).toBe(false);
    expect(decision?.overrideContent).not.toContain('Context7');
  });
});
