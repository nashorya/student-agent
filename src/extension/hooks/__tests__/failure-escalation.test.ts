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

function makeMutatingErrorContext(resultText: string): PostToolCallContext {
  return {
    toolName: 'exec_command',
    toolCallId: 'tool_1',
    args: { cmd: 'npm install playwright' },
    isError: true,
    resultText,
  };
}

function makeFileGuardBlockContext(toolCallId: string): PostToolCallContext {
  return {
    toolName: 'read_file',
    toolCallId,
    args: { path: 'src/extension/hooks/file-guard.ts' },
    isError: true,
    resultText: '[FileGuard] 本轮已读取 16 个文件，超出上限 15。停止 read。',
  };
}

function makeRiskGuardBlockContext(toolCallId: string): PostToolCallContext {
  return {
    toolName: 'exec_command',
    toolCallId,
    args: { cmd: 'rm -rf dist' },
    isError: true,
    resultText: '[RiskGuard] 用户拒绝或未确认，已阻断高风险工具调用。',
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

  it('FileGuard block 即使被 Pi 标记为 isError 也不进入失败升级', async () => {
    const query = vi.fn();
    const restoreSnapshot = vi.fn(async () => {});
    const ctx = new FailureEscalationContext({
      context7Client: { query },
      getLastSnapshotId: () => 'snap_1',
      restoreSnapshot,
    });
    ctx.initTask('测试任务', process.cwd());
    const hook = ctx.createHook();

    const firstBlock = await hook(makeFileGuardBlockContext('tool_block_1'));
    const secondBlock = await hook(makeFileGuardBlockContext('tool_block_2'));
    const realFailure = await hook(makeMutatingErrorContext('real failure'));

    expect(firstBlock).toBeUndefined();
    expect(secondBlock).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
    expect(restoreSnapshot).toHaveBeenCalledTimes(1);
    expect(realFailure?.terminate).toBe(false);
    expect(realFailure?.overrideContent).not.toContain('Context7');
    expect(realFailure?.overrideContent).toContain('恢复动作：已自动回滚到工具调用前的状态（snapshot: snap_1）');
  });

  it('RiskGuard block 即使被 Pi 标记为 isError 也不进入失败升级', async () => {
    const query = vi.fn();
    const restoreSnapshot = vi.fn(async () => {});
    const ctx = new FailureEscalationContext({
      context7Client: { query },
      getLastSnapshotId: () => 'snap_1',
      restoreSnapshot,
    });
    ctx.initTask('测试任务', process.cwd());
    const hook = ctx.createHook();

    const blocked = await hook(makeRiskGuardBlockContext('tool_risk_block'));
    const realFailure = await hook(makeMutatingErrorContext('real failure'));

    expect(blocked).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
    expect(restoreSnapshot).toHaveBeenCalledTimes(1);
    expect(realFailure?.overrideContent).not.toContain('Context7');
    expect(realFailure?.overrideContent).toContain('恢复动作：已自动回滚到工具调用前的状态（snapshot: snap_1）');
  });


  it('Context7 未配置时明确说明未触发检索', async () => {
    const ctx = new FailureEscalationContext();
    ctx.initTask('修复 Playwright 测试失败', process.cwd());
    const hook = ctx.createHook();

    await hook(makeErrorContext('first Playwright failure'));
    const decision = await hook(makeErrorContext('second Playwright failure'));

    expect(decision?.overrideContent).toContain('辅助诊断：未触发 Context7 文档检索。');
    expect(decision?.overrideContent).toContain('Context7 客户端未配置，未执行文档检索');
    expect(decision?.overrideContent).not.toContain('已尝试触发 Context7');
  });

  it('第二次普通工具失败不触发 Context7', async () => {
    const query = vi.fn();
    const ctx = new FailureEscalationContext({
      context7Client: { query },
    });
    ctx.initTask('读取项目文件', process.cwd());
    const hook = ctx.createHook();
    const ordinaryToolError: PostToolCallContext = {
      toolName: 'write',
      toolCallId: 'tool_write',
      args: { path: 'src/output.ts', content: 'bad content' },
      isError: true,
      resultText: 'write failed',
    };

    await hook(ordinaryToolError);
    const decision = await hook({ ...ordinaryToolError, toolCallId: 'tool_write_2', resultText: 'write failed again' });

    expect(query).not.toHaveBeenCalled();
    expect(decision?.overrideContent).toContain('这是工具操作问题，不触发 Context7 文档检索');
  });

  it('第二次编译或测试报错会触发 Context7', async () => {
    const query = vi.fn(async () => ({
      libraryId: '/microsoft/typescript',
      topic: 'unknown',
      content: 'TypeScript docs snippet',
      source: 'context7' as const,
    }));
    const ctx = new FailureEscalationContext({
      context7Client: { query },
    });
    ctx.initTask('修复 TypeScript 编译错误', process.cwd());
    const hook = ctx.createHook();

    const compileError = 'npx tsc --noEmit\nsrc/index.ts(1,1): error TS2307: Cannot find module x';
    await hook(makeErrorContext(compileError));
    const decision = await hook(makeErrorContext(compileError));

    expect(query).toHaveBeenCalled();
    expect(decision?.overrideContent).toContain('辅助诊断：已触发 Context7 文档检索');
    expect(decision?.overrideContent).toContain('TypeScript docs snippet');
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
    expect(decision?.overrideContent).toContain('改用 apply_patch');
  });

  it('第一次失败时显示回滚成功结果', async () => {
    const getLastSnapshotId = vi.fn((toolCallId?: string) => toolCallId === 'tool_1' ? 'snap_1' : null);
    const ctx = new FailureEscalationContext({
      getLastSnapshotId,
      restoreSnapshot: async () => {},
    });
    ctx.initTask('测试任务', process.cwd());
    const hook = ctx.createHook();

    const decision = await hook(makeMutatingErrorContext('failure'));

    expect(decision?.overrideContent).toContain('恢复动作：已自动回滚到工具调用前的状态（snapshot: snap_1）');
    expect(getLastSnapshotId).toHaveBeenCalledWith('tool_1');
  });

  it('非写入命令失败即使存在快照也不执行回滚', async () => {
    const restoreSnapshot = vi.fn(async () => {});
    const ctx = new FailureEscalationContext({
      getLastSnapshotId: () => 'snap_1',
      restoreSnapshot,
    });
    ctx.initTask('测试任务', process.cwd());
    const hook = ctx.createHook();

    const decision = await hook(makeErrorContext('test failure'));

    expect(restoreSnapshot).not.toHaveBeenCalled();
    expect(decision?.overrideContent).toContain('恢复动作：没有可用快照，未执行自动回滚。');
  });

  it('失败工具没有自己的快照时不回滚最近一次其他工具快照', async () => {
    const restoreSnapshot = vi.fn(async () => {});
    const ctx = new FailureEscalationContext({
      getLastSnapshotId: (toolCallId?: string) => toolCallId === 'tool_previous' ? 'snap_previous' : null,
      restoreSnapshot,
    });
    ctx.initTask('测试任务', process.cwd());
    const hook = ctx.createHook();

    const decision = await hook(makeErrorContext('read failure'));

    expect(restoreSnapshot).not.toHaveBeenCalled();
    expect(decision?.overrideContent).toContain('恢复动作：没有可用快照，未执行自动回滚。');
  });

  it('只读 shell 探测未命中不计入失败升级，也不回滚', async () => {
    const restoreSnapshot = vi.fn(async () => {});
    const ctx = new FailureEscalationContext({
      getLastSnapshotId: () => 'snap_1',
      restoreSnapshot,
    });
    ctx.initTask('测试任务', process.cwd());
    const hook = ctx.createHook();

    const probeMiss = await hook({
      toolName: 'exec_command',
      toolCallId: 'tool_probe',
      args: { cmd: 'rg 早餐 dist' },
      isError: true,
      resultText: 'Command exited with code 1',
    });
    const realFailure = await hook(makeMutatingErrorContext('real failure'));

    expect(probeMiss).toEqual({
      overrideContent: [
        '只读探测未命中，不作为工具故障处理。',
        '命令：rg 早餐 dist',
        '请根据这个结果继续缩小路径、关键词或检查候选文件是否存在；不要触发回滚或重新规划。',
      ].join('\n'),
      isError: false,
      terminate: false,
    });
    expect(realFailure?.overrideContent).not.toContain('Context7');
    expect(restoreSnapshot).toHaveBeenCalledTimes(1);
  });

  it('只读工具失败不触发回滚或 Context7', async () => {
    const restoreSnapshot = vi.fn(async () => {});
    const ctx = new FailureEscalationContext({
      getLastSnapshotId: () => 'snap_1',
      restoreSnapshot,
    });
    ctx.initTask('测试任务', process.cwd());
    const hook = ctx.createHook();

    const decision = await hook({
      toolName: 'read_file',
      toolCallId: 'tool_read',
      args: { path: 'missing.ts' },
      isError: true,
      resultText: 'ENOENT: no such file or directory',
    });

    expect(decision?.isError).toBe(false);
    expect(decision?.overrideContent).toContain('只读探测未命中');
    expect(restoreSnapshot).not.toHaveBeenCalled();
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

    const decision = await hook(makeMutatingErrorContext('failure'));

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
