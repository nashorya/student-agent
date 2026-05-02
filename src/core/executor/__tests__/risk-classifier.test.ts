import { describe, it, expect } from 'vitest';
import { classify } from '../risk-classifier.js';

describe('classify', () => {
  describe('HIGH_RISK_TOOL_PATTERN matches', () => {
    it.each([
      ['delete_file', {}],
      ['rm_old_logs', {}],
      ['unlink_symlink', {}],
      ['drop_table', {}],
    ])('toolName "%s" → high', (toolName, input) => {
      expect(classify(toolName, input)).toBe('high');
    });
  });

  describe('_destroy in toolName', () => {
    it('toolName "session_destroy" → high', () => {
      expect(classify('session_destroy', {})).toBe('high');
    });

    it('toolName "resource_destroy_all" → high', () => {
      expect(classify('resource_destroy_all', {})).toBe('high');
    });
  });

  describe('bash with high-risk commands', () => {
    it('bash with "rm -r /tmp/foo" → high', () => {
      expect(classify('bash', { command: 'rm -r /tmp/foo' })).toBe('high');
    });

    it('bash with "DROP TABLE users;" → high', () => {
      expect(classify('bash', { command: 'DROP TABLE users;' })).toBe('high');
    });

    it('bash with "DELETE FROM orders WHERE id=1" → high', () => {
      expect(classify('bash', { command: 'DELETE FROM orders WHERE id=1' })).toBe('high');
    });

    it('bash with "echo foo > /etc/hosts" → high', () => {
      expect(classify('bash', { command: 'echo foo > /etc/hosts' })).toBe('high');
    });

    it('bash with "mv /tmp/foo /dev/null" → high', () => {
      expect(classify('bash', { command: 'mv /tmp/foo /dev/null' })).toBe('high');
    });

    it('bash with safe command "ls -la" → low', () => {
      expect(classify('bash', { command: 'ls -la' })).toBe('low');
    });

    it('bash with "rm" (no -r) → low', () => {
      expect(classify('bash', { command: 'rm somefile.txt' })).toBe('low');
    });

    it('bash with no command field → low', () => {
      expect(classify('bash', {})).toBe('low');
    });

    it('bash with non-string command → low', () => {
      expect(classify('bash', { command: 42 })).toBe('low');
    });
  });

  describe('db/migration tool names', () => {
    it('toolName "db_write_record" → high', () => {
      expect(classify('db_write_record', {})).toBe('high');
    });

    it('toolName "sql_exec_query" → high', () => {
      expect(classify('sql_exec_query', {})).toBe('high');
    });

    it('toolName "migrate_users" → high', () => {
      expect(classify('migrate_users', {})).toBe('high');
    });

    it('toolName "run_migrate" → high', () => {
      expect(classify('run_migrate', {})).toBe('high');
    });
  });

  describe('clearly low-risk tools', () => {
    it.each([
      ['read_file', {}],
      ['list_dir', {}],
      ['grep', { pattern: 'foo', path: '/src' }],
      ['get_user', { id: '123' }],
      ['search_docs', {}],
    ])('toolName "%s" → low', (toolName, input) => {
      expect(classify(toolName, input)).toBe('low');
    });
  });
});
