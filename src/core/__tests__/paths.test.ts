import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { join } from 'node:path';
import { getProjectCwd, getProjectMemoryDir } from '../paths.js';

describe('paths', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.STUDENT_AGENT_CWD;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.STUDENT_AGENT_CWD;
    } else {
      process.env.STUDENT_AGENT_CWD = originalEnv;
    }
  });

  describe('getProjectCwd', () => {
    it('returns STUDENT_AGENT_CWD when set', () => {
      process.env.STUDENT_AGENT_CWD = '/tmp/some-project';
      expect(getProjectCwd()).toBe('/tmp/some-project');
    });

    it('falls back to process.cwd() when env is unset', () => {
      delete process.env.STUDENT_AGENT_CWD;
      expect(getProjectCwd()).toBe(process.cwd());
    });

    it('falls back to process.cwd() when env is empty string', () => {
      process.env.STUDENT_AGENT_CWD = '';
      expect(getProjectCwd()).toBe(process.cwd());
    });

    it('falls back to process.cwd() when env is whitespace only', () => {
      process.env.STUDENT_AGENT_CWD = '   ';
      expect(getProjectCwd()).toBe(process.cwd());
    });
  });

  describe('getProjectMemoryDir', () => {
    it('joins project cwd with "memory"', () => {
      process.env.STUDENT_AGENT_CWD = '/tmp/some-project';
      expect(getProjectMemoryDir()).toBe(join('/tmp/some-project', 'memory'));
    });

    it('uses process.cwd() based path when env is unset', () => {
      delete process.env.STUDENT_AGENT_CWD;
      expect(getProjectMemoryDir()).toBe(join(process.cwd(), 'memory'));
    });
  });
});
