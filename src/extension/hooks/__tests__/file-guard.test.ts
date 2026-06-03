import { describe, it, expect, vi } from 'vitest';
import { createFileGuardHook } from '../file-guard.js';
import type { PreToolCallContext } from '../../../core/pi-bridge/types.js';

function makeContext(
  toolName: string,
  args: unknown,
  toolCallId = 'tool_1',
): PreToolCallContext {
  return {
    toolName,
    toolCallId,
    args,
  };
}

describe('file guard', () => {
  it('repeated FileGuard blocks do not abort the session', async () => {
    const abort = vi.fn();
    const guard = createFileGuardHook({ abort });
    guard.setMode('planning');

    const first = await guard.hook(makeContext('ls', { path: '.' }, 'tool_1'));
    const second = await guard.hook(makeContext('ls', { path: '.' }, 'tool_2'));
    const third = await guard.hook(makeContext('ls', { path: '.' }, 'tool_3'));

    expect(first).toMatchObject({ block: true });
    expect(second).toMatchObject({ block: true });
    expect(third).toMatchObject({ block: true });
    expect(abort).not.toHaveBeenCalled();
  });

  it('allows the documented pi-mono coding-agent README exception', async () => {
    const guard = createFileGuardHook({ abort: vi.fn() });

    await expect(guard.hook(makeContext('read_file', {
      path: 'pi-mono/packages/coding-agent/README.md',
    }))).resolves.toBeUndefined();

    const blocked = await guard.hook(makeContext('read_file', {
      path: 'pi-mono/packages/coding-agent/src/core/tools/edit.ts',
    }));
    expect(blocked).toMatchObject({ block: true });
  });

  it('uses configured planning and normal read limits', async () => {
    const guard = createFileGuardHook(
      { abort: vi.fn() },
      { planningMaxReads: 1, normalMaxReads: 2, readWindow: 10 },
    );

    guard.setMode('planning');
    expect(await guard.hook(makeContext('read_file', { path: 'a.ts' }, 'tool_1'))).toBeUndefined();
    const planningBlock = await guard.hook(makeContext('read_file', { path: 'b.ts' }, 'tool_2'));
    expect(planningBlock).toMatchObject({ block: true });
    expect(planningBlock?.reason).toContain('上限 1');

    guard.setMode('normal');
    expect(await guard.hook(makeContext('read_file', { path: 'a.ts' }, 'tool_3'))).toBeUndefined();
    expect(await guard.hook(makeContext('read_file', { path: 'b.ts' }, 'tool_4'))).toBeUndefined();
    const normalBlock = await guard.hook(makeContext('read_file', { path: 'c.ts' }, 'tool_5'));
    expect(normalBlock).toMatchObject({ block: true });
    expect(normalBlock?.reason).toContain('上限 2');
  });

  it('applies read limits within a sliding recent-tool window', async () => {
    const guard = createFileGuardHook(
      { abort: vi.fn() },
      { planningMaxReads: 1, normalMaxReads: 2, readWindow: 3 },
    );

    expect(await guard.hook(makeContext('read_file', { path: 'a.ts' }, 'tool_1'))).toBeUndefined();
    expect(await guard.hook(makeContext('read_file', { path: 'b.ts' }, 'tool_2'))).toBeUndefined();
    expect(await guard.hook(makeContext('grep', { pattern: 'x', path: 'src' }, 'tool_3'))).toBeUndefined();
    expect(await guard.hook(makeContext('grep', { pattern: 'y', path: 'src' }, 'tool_4'))).toBeUndefined();

    const decision = await guard.hook(makeContext('read_file', { path: 'c.ts' }, 'tool_5'));

    expect(decision).toBeUndefined();
  });
});
