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
  workflow_status: 'executing',
  level: 3,
  working_memory: {
    goal: '让首页颜色更清晰',
    acceptance_criteria: ['颜色符合设计'],
    constraints: ['不改路由'],
    user_preferences: [],
    project_facts: [],
    open_questions: [],
    decisions: [],
    verification_results: ['build passed'],
    changed_files: ['src/App.tsx'],
    read_files: [],
    written_files: [],
    recent_errors: [],
  },
  requires_user_acceptance: true,
  requires_visual_review: true,
  verification_results: [],
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

  it('includes working memory and workflow status', () => {
    const prefix = buildTaskContextPrefix(makeTask());
    expect(prefix).toContain('[工作流状态] executing');
    expect(prefix).toContain('[目标] 让首页颜色更清晰');
    expect(prefix).toContain('颜色符合设计');
    expect(prefix).toContain('build passed');
  });

  it('includes tracked files and recent errors from working memory', () => {
    const prefix = buildTaskContextPrefix(makeTask({
      working_memory: {
        goal: '',
        acceptance_criteria: [],
        constraints: [],
        user_preferences: [],
        project_facts: [],
        open_questions: [],
        decisions: [],
        verification_results: [],
        changed_files: [],
        read_files: ['src/input.ts'],
        written_files: ['src/output.ts'],
        recent_errors: ['edit failed'],
      },
    }));

    expect(prefix).toContain('[已读取文件]');
    expect(prefix).toContain('src/input.ts');
    expect(prefix).toContain('[已写入文件]');
    expect(prefix).toContain('src/output.ts');
    expect(prefix).toContain('[最近错误]');
    expect(prefix).toContain('edit failed');
  });

  it('returns empty string when task is null', () => {
    expect(buildTaskContextPrefix(null)).toBe('');
  });
});
