import { describe, expect, it } from 'vitest';
import { loadEvalTasks, parseTaskToml } from '../task-loader.js';

describe('eval task loader', () => {
  it('parses supported task.toml fields', () => {
    expect(parseTaskToml([
      'id = "sample"',
      'title = "Sample Task"',
      'mode = "task"',
      'timeout_seconds = 120',
      'tags = ["a", "b"]',
      'expected_files = ["src/a.ts"]',
    ].join('\n'))).toEqual({
      id: 'sample',
      title: 'Sample Task',
      mode: 'task',
      timeout_seconds: 120,
      tags: ['a', 'b'],
      expected_files: ['src/a.ts'],
    });
  });

  it('loads the checked-in eval suite', async () => {
    const tasks = await loadEvalTasks();
    expect(tasks.length).toBeGreaterThanOrEqual(10);
    expect(tasks.map((task) => task.id)).toContain('task-phase-flow');
    expect(tasks.map((task) => task.id)).toContain('long-context-maintenance');
    expect(tasks.every((task) => task.expectedFiles.length > 0)).toBe(true);
  });
});
