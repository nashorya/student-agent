import { describe, it, expect, beforeEach } from 'vitest';
import { getLastSnapshotId, requiresSnapshot, toolMayMutate, _resetForTesting } from '../snapshot.js';
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
    expect(requiresSnapshot(ctx('ls', { path: 'src' }))).toBe(false);
    expect(requiresSnapshot(ctx('find', { path: 'src', pattern: '*.ts' }))).toBe(false);
    expect(requiresSnapshot(ctx('glob', { pattern: '**/*.ts' }))).toBe(false);
    expect(requiresSnapshot(ctx('context7_query', { library: 'react' }))).toBe(false);
    expect(requiresSnapshot(ctx('get-library-docs', { library: 'react' }))).toBe(false);
  });

  it('写入工具需要 snapshot', () => {
    expect(requiresSnapshot(ctx('write_file', { path: 'src/index.ts' }))).toBe(true);
    expect(requiresSnapshot(ctx('edit', { path: 'src/index.ts', oldText: 'a', newText: 'b' }))).toBe(true);
    expect(requiresSnapshot(ctx('apply_patch', {}))).toBe(true);
  });

  it('只读 bash 不需要 snapshot', () => {
    expect(requiresSnapshot(ctx('exec_command', { cmd: 'rg "FileGuard" src' }))).toBe(false);
    expect(requiresSnapshot(ctx('bash', { command: 'git status --short' }))).toBe(false);
    expect(requiresSnapshot(ctx('shell', { script: 'npx tsc --noEmit' }))).toBe(false);
  });

  it('可能写入的 bash 需要 snapshot', () => {
    expect(requiresSnapshot(ctx('exec_command', { cmd: 'npm install playwright' }))).toBe(true);
    expect(requiresSnapshot(ctx('bash', { command: 'echo hi > out.txt' }))).toBe(true);
    expect(requiresSnapshot(ctx('shell', { script: 'sed -i s/foo/bar/ src/index.ts' }))).toBe(true);
    expect(requiresSnapshot(ctx('terminal', { command: 'git reset --hard HEAD~1' }))).toBe(true);
  });

  it('未知工具默认不需要 snapshot，除非参数明确表示写入', () => {
    expect(requiresSnapshot(ctx('custom_tool', { cmd: 'cat package.json' }))).toBe(false);
    expect(requiresSnapshot(ctx('custom_tool', { cmd: 'echo hi > file.txt' }))).toBe(true);
    expect(requiresSnapshot(ctx('custom_tool', { path: 'src/index.ts', content: 'new file' }))).toBe(true);
    expect(requiresSnapshot(ctx('custom_tool', { payload: { anything: true } }))).toBe(false);
    expect(toolMayMutate('unknown_tool', { payload: { anything: true } })).toBe(false);
  });

  it('自定义工具名不会因宽泛 read/run 正则误判', () => {
    expect(requiresSnapshot(ctx('read_and_write', { mode: 'dry-run' }))).toBe(true);
    expect(requiresSnapshot(ctx('execute_readonly_query', { sql: 'select 1' }))).toBe(false);
  });

  it('重置测试状态会清空 lastSnapshotId', () => {
    expect(getLastSnapshotId()).toBeNull();
  });
});
