import { describe, expect, it } from 'vitest';
import {
  formatRecallActivity,
  formatReflectActivity,
  formatSignalActivity,
} from '../project-memory.js';

describe('project-memory formatters', () => {
  it('formats signal / reflect / recall lines', () => {
    expect(formatSignalActivity({
      id: 's1',
      kind: 'tool_error',
      severity: 'high',
      summary: 'bash failed',
      recoveryHint: 'retry with smaller scope',
      createdAt: '2026-01-01T00:00:00.000Z',
    })).toContain('tool_error [high]');

    expect(formatReflectActivity({
      patternsExtracted: 2,
      promotedCount: 1,
      knacksPromoted: 1,
    })).toContain('升级 1 个 knack');

    expect(formatRecallActivity([
      { kind: 'knack', summary: 'prefer vitest' },
      { kind: 'preference', summary: 'concise' },
      { kind: 'knack', summary: 'other' },
    ])).toMatch(/3 injected/);
  });
});
