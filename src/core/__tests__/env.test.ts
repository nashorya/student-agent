import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadEnvFile,
  loadEnvLayersPreservingAmbient,
  parseEnvFile,
} from '../env.js';

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

  it('分层加载时保留启动环境变量的最高优先级', async () => {
    const globalDir = join(tmpDir, 'global');
    const projectDir = join(tmpDir, 'project');
    await Promise.all([
      mkdir(globalDir, { recursive: true }),
      mkdir(projectDir, { recursive: true }),
    ]);
    await writeFile(join(globalDir, '.env'), [
      'STUDENT_AGENT_BASE_URL=https://global.example/v1',
      'GLOBAL_ONLY=global',
    ].join('\n'));
    await writeFile(join(projectDir, '.env'), [
      'STUDENT_AGENT_BASE_URL=https://project.example/v1',
      'GLOBAL_ONLY=project',
    ].join('\n'));
    process.env.STUDENT_AGENT_BASE_URL = 'https://ambient.example/v1';
    delete process.env.GLOBAL_ONLY;

    await loadEnvLayersPreservingAmbient(async () => {
      await loadEnvFile({ cwd: globalDir, override: true });
      await loadEnvFile({ cwd: projectDir, override: true });
    });

    expect(process.env.STUDENT_AGENT_BASE_URL).toBe('https://ambient.example/v1');
    expect(process.env.GLOBAL_ONLY).toBe('project');
  });
});
