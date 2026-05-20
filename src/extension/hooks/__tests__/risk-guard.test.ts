import { describe, expect, it, vi } from 'vitest';
import { createRiskFingerprint, createRiskGuardHook, type ConfirmationProviderRef } from '../risk-guard.js';
import type { ConfirmationProvider } from '../../../core/executor/types.js';
import type { PreToolCallContext } from '../../../core/pi-bridge/types.js';

function makeContext(toolName: string, args: unknown): PreToolCallContext {
  return {
    toolName,
    toolCallId: 'tool_1',
    args,
  };
}

function makeProvider(decision: Awaited<ReturnType<ConfirmationProvider['confirm']>>): ConfirmationProvider {
  return {
    confirm: vi.fn(async () => decision),
  };
}

describe('risk guard', () => {
  it('passes low-risk tools without confirmation', async () => {
    const provider = makeProvider(false);
    const ref: ConfirmationProviderRef = { current: provider };
    const guard = createRiskGuardHook({ confirmationProviderRef: ref });

    const decision = await guard.hook(makeContext('read_file', { path: 'src/index.ts' }));

    expect(decision).toBeUndefined();
    expect(provider.confirm).not.toHaveBeenCalled();
  });

  it('allows a high-risk call once when confirmation returns true', async () => {
    const provider = makeProvider(true);
    const ref: ConfirmationProviderRef = { current: provider };
    const guard = createRiskGuardHook({ confirmationProviderRef: ref });

    const decision = await guard.hook(makeContext('exec_command', { cmd: 'rm -rf dist' }));

    expect(decision).toBeUndefined();
    expect(provider.confirm).toHaveBeenCalledTimes(1);
  });

  it('blocks high-risk calls when confirmation is denied', async () => {
    const provider = makeProvider(false);
    const ref: ConfirmationProviderRef = { current: provider };
    const guard = createRiskGuardHook({ confirmationProviderRef: ref });

    const decision = await guard.hook(makeContext('bash', { command: 'drop table users' }));

    expect(decision).toMatchObject({ block: true });
    expect(decision?.reason).toContain('[RiskGuard]');
    expect(decision?.reason).toContain('已阻断高风险工具调用');
  });

  it('blocks high-risk calls without an interactive provider', async () => {
    const ref: ConfirmationProviderRef = { current: null };
    const guard = createRiskGuardHook({ confirmationProviderRef: ref });

    const decision = await guard.hook(makeContext('bash', { command: 'sudo rm -rf /tmp/foo' }));

    expect(decision).toMatchObject({ block: true });
    expect(decision?.reason).toContain('没有可用的交互确认通道');
  });

  it('blocks high-risk calls when confirmation throws', async () => {
    const provider: ConfirmationProvider = {
      confirm: vi.fn(async () => {
        throw new Error('prompt closed');
      }),
    };
    const ref: ConfirmationProviderRef = { current: provider };
    const guard = createRiskGuardHook({ confirmationProviderRef: ref });

    const decision = await guard.hook(makeContext('bash', { command: 'chmod 777 /etc/passwd' }));

    expect(decision).toMatchObject({ block: true });
    expect(decision?.reason).toContain('确认过程失败');
  });

  it('caches always-allow decisions for the same session fingerprint', async () => {
    const provider = makeProvider('always');
    const ref: ConfirmationProviderRef = { current: provider };
    const guard = createRiskGuardHook({ confirmationProviderRef: ref });
    const ctx = makeContext('exec_command', { cmd: 'RM   -RF   dist' });

    expect(await guard.hook(ctx)).toBeUndefined();
    expect(await guard.hook(makeContext('exec_command', { cmd: 'rm -rf dist' }))).toBeUndefined();
    expect(provider.confirm).toHaveBeenCalledTimes(1);
  });

  it('creates stable fingerprints for object args', () => {
    expect(createRiskFingerprint('delete_file', { b: 2, a: 1 }))
      .toBe(createRiskFingerprint('delete_file', { a: 1, b: 2 }));
  });
});
