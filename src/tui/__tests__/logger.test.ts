import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('logger', () => {
  const originalEnv = process.env.STUDENT_AGENT_LOG_DIR;
  let tmpDir: string | null = null;

  afterEach(() => {
    process.env.STUDENT_AGENT_LOG_DIR = originalEnv;
    vi.restoreAllMocks();
    vi.resetModules();
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it('TUI 模式下 error 只写日志文件，不直接写 stderr', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'student-agent-logger-'));
    process.env.STUDENT_AGENT_LOG_DIR = tmpDir;
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { initLogger, logger, setTuiMode } = await import('../logger.js');

    initLogger({ dateString: '2026-06-14' });
    setTuiMode(true);

    logger.error('fatal-looking error');

    expect(stderrWrite).not.toHaveBeenCalled();
    const content = readFileSync(join(tmpDir, 'logs', 'runtime-2026-06-14.log'), 'utf8');
    expect(content).toContain('[error] fatal-looking error');
  });
});
