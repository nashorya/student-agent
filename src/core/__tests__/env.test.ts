import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFile, parseEnvFile } from '../env.js';

describe('env loader', () => {
  let tmpDir: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'student-env-test-'));
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('parseEnvFile 支持注释、export、引号和行内注释', () => {
    const parsed = parseEnvFile([
      '# comment',
      'ANTHROPIC_BASE_URL=https://relay.example/v1 # relay',
      'export CONTEXT7_API_KEY="ctx7-key" # secret',
      "SINGLE_QUOTED='literal value'",
      'EMPTY=',
    ].join('\n'));

    expect(parsed).toEqual({
      ANTHROPIC_BASE_URL: 'https://relay.example/v1',
      CONTEXT7_API_KEY: 'ctx7-key',
      SINGLE_QUOTED: 'literal value',
      EMPTY: '',
    });
  });

  it('loadEnvFile 默认不覆盖已有环境变量', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://existing.example';
    delete process.env.CONTEXT7_API_KEY;
    await writeFile(join(tmpDir, '.env'), [
      'ANTHROPIC_BASE_URL=https://relay.example/v1',
      'CONTEXT7_API_KEY=ctx7-key',
    ].join('\n'));

    const loaded = await loadEnvFile({ cwd: tmpDir });

    expect(loaded?.keys).toEqual(['CONTEXT7_API_KEY']);
    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://existing.example');
    expect(process.env.CONTEXT7_API_KEY).toBe('ctx7-key');
  });

  it('文件不存在时返回 null', async () => {
    await expect(loadEnvFile({ cwd: tmpDir })).resolves.toBeNull();
  });
});
