import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redirectConsoleForTUI } from '../console-redirect.js';

describe('redirectConsoleForTUI', () => {
  let tmpDir: string;
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'student-agent-console-'));
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function readLog(date = '2026-05-20'): string {
    return readFileSync(join(tmpDir, `runtime-${date}.log`), 'utf8');
  }

  it('console.log 被重定向到日志文件而不是 stdout', () => {
    cleanup = redirectConsoleForTUI({ logDir: tmpDir, dateString: '2026-05-20' });
    console.log('hello world');
    // 强制 flush（cleanup 会 end stream）
    cleanup();
    cleanup = null;
    const content = readLog();
    expect(content).toContain('[log] hello world');
  });

  it('console.warn / info / debug 都被劫持', () => {
    cleanup = redirectConsoleForTUI({ logDir: tmpDir, dateString: '2026-05-20' });
    console.warn('warn-msg');
    console.info('info-msg');
    console.debug('debug-msg');
    cleanup();
    cleanup = null;
    const content = readLog();
    expect(content).toContain('[warn] warn-msg');
    expect(content).toContain('[info] info-msg');
    expect(content).toContain('[debug] debug-msg');
  });

  it('console.error 也被重定向，避免污染全屏 TUI', () => {
    const originalError = console.error;
    cleanup = redirectConsoleForTUI({ logDir: tmpDir, dateString: '2026-05-20' });
    expect(console.error).not.toBe(originalError);
    console.error('fatal-looking error');
    cleanup();
    cleanup = null;
    expect(console.error).toBe(originalError);
    expect(readLog()).toContain('[error] fatal-looking error');
  });

  it('支持 printf-style 占位符', () => {
    cleanup = redirectConsoleForTUI({ logDir: tmpDir, dateString: '2026-05-20' });
    console.log('count=%d name=%s', 42, 'foo');
    cleanup();
    cleanup = null;
    const content = readLog();
    expect(content).toContain('count=42 name=foo');
  });

  it('cleanup 后 console.log 恢复原始行为', () => {
    const original = console.log;
    cleanup = redirectConsoleForTUI({ logDir: tmpDir, dateString: '2026-05-20' });
    expect(console.log).not.toBe(original);
    cleanup();
    cleanup = null;
    expect(console.log).toBe(original);
  });

  it('重复调用 redirectConsoleForTUI 是幂等的（只 patch 一次）', () => {
    const original = console.log;
    const cleanup1 = redirectConsoleForTUI({ logDir: tmpDir, dateString: '2026-05-20' });
    const patched = console.log;
    const cleanup2 = redirectConsoleForTUI({ logDir: tmpDir, dateString: '2026-05-20' });
    // 第二次调用不应再次 patch
    expect(console.log).toBe(patched);
    // 两个 cleanup 都应该能恢复
    cleanup2();
    expect(console.log).toBe(original);
    // cleanup1 在 stream 已 end 后调用应当无副作用
    cleanup1();
    expect(console.log).toBe(original);
    cleanup = null;
  });
});
