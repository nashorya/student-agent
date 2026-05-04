import { describe, it, expect, beforeEach } from 'vitest';
import { getLastSnapshotId, requiresSnapshot, _resetForTesting } from '../snapshot.js';
import type { PreToolCallContext } from '../../../core/pi-bridge/types.js';

function ctx(toolName: string, args: unknown = {}): PreToolCallContext {
  return {
    toolName,
    toolCallId: 'tool_1',
    args,
  };
}

describe('snapshot hook classification', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it('只读工具不需要 snapshot', () => {
    expect(requiresSnapshot(ctx('read_file', { path: 'src/index.ts' }))).toBe(false);
    expect(requiresSnapshot(ctx('grep', { pattern: 'test' }))).toBe(false);
    expect(requiresSnapshot(ctx('context7_query', { library: 'react' }))).toBe(false);
  });

  it('写入和 shell 工具需要 snapshot', () => {
    expect(requiresSnapshot(ctx('write_file', { path: 'src/index.ts' }))).toBe(true);
    expect(requiresSnapshot(ctx('apply_patch', {}))).toBe(true);
    expect(requiresSnapshot(ctx('exec_command', { cmd: 'npm install playwright' }))).toBe(true);
  });

  it('未知工具按参数保守判定：明确只读放行，否则要求 snapshot', () => {
    expect(requiresSnapshot(ctx('custom_tool', { cmd: 'cat package.json' }))).toBe(false);
    expect(requiresSnapshot(ctx('custom_tool', { cmd: 'echo hi > file.txt' }))).toBe(true);
    expect(requiresSnapshot(ctx('custom_tool', { payload: { anything: true } }))).toBe(true);
  });

  it('自定义工具名不会因宽泛 read/run 正则误判', () => {
    expect(requiresSnapshot(ctx('read_and_write', { mode: 'dry-run' }))).toBe(true);
    expect(requiresSnapshot(ctx('execute_readonly_query', { sql: 'select 1' }))).toBe(false);
  });

  it('重置测试状态会清空 lastSnapshotId', () => {
    expect(getLastSnapshotId()).toBeNull();
  });
});
