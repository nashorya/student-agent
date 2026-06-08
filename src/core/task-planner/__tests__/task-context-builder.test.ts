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
    taskId: 'task_1',
    runId: 'run_1',
    goal: '让首页颜色更清晰',
    phase: 'executing',
    currentStep: '修改颜色值',
    todos: [{ id: 'todo_1', content: '颜色符合设计', status: 'pending', updatedAt: '' }],
    readFiles: [],
    writeFiles: [{ path: 'src/App.tsx', tool: 'hashline_edit', summary: 'Updated src/App.tsx', writtenAt: '' }],
    recentErrors: [],
    recentSignals: [
      { id: 'sig_1', kind: 'constraint', summary: '不改路由', severity: 'medium', createdAt: '' },
    ],
    artifactRefs: [
      { id: 'artifact_1', kind: 'verification_result', summary: 'build passed' },
    ],
    updatedAt: '',
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
        taskId: 'task_1',
        runId: 'run_1',
        goal: '',
        phase: 'executing',
        currentStep: '',
        todos: [],
        readFiles: [{ path: 'src/input.ts', ranges: [], lastReadAt: '' }],
        writeFiles: [{ path: 'src/output.ts', tool: 'hashline_edit', summary: 'Updated src/output.ts', writtenAt: '' }],
        recentErrors: [{ id: 'err_1', source: 'runtime', pattern: 'edit failed', summary: 'edit failed', createdAt: '' }],
        recentSignals: [],
        artifactRefs: [],
        updatedAt: '',
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
