import { describe, it, expect } from 'vitest';
import { buildTaskContextPrefix } from '../task-context-builder.js';
import type { Task } from '../../../memory/tasks/types.js';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task_1',
  name: '调整首页颜色',
  active_phase_index: 1,
  phases: [
    { id: 'p0', description: '分析 CSS', status: 'completed', retry_count: 0, feedbacks: [], created_at: '' },
    { id: 'p1', description: '修改颜色值', status: 'in_progress', retry_count: 2,
      feedbacks: ['颜色还是不对', '微信里还是灰色'], created_at: '' },
  ],
  status: 'active',
  created_at: '',
  ...overrides,
});

describe('buildTaskContextPrefix', () => {
  it('includes task name and current phase', () => {
    const prefix = buildTaskContextPrefix(makeTask());
    expect(prefix).toContain('调整首页颜色');
    expect(prefix).toContain('Phase 2');
    expect(prefix).toContain('修改颜色值');
  });

  it('includes retry count when > 0', () => {
    const prefix = buildTaskContextPrefix(makeTask());
    expect(prefix).toContain('2 次');
  });

  it('includes previous feedbacks', () => {
    const prefix = buildTaskContextPrefix(makeTask());
    expect(prefix).toContain('颜色还是不对');
  });

  it('returns empty string when task is null', () => {
    expect(buildTaskContextPrefix(null)).toBe('');
  });
});
