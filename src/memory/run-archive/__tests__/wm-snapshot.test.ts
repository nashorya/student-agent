import { describe, expect, it } from 'vitest';
import { extractWorkingMemorySnapshot } from '../wm-snapshot.js';
import type { TaskWorkingMemory } from '../../tasks/types.js';

describe('extractWorkingMemorySnapshot', () => {
  it('extracts goal, phase, final step, completed todos, files, signals, errors, and evidence refs', () => {
    const snapshot = extractWorkingMemorySnapshot(workingMemory({
      todos: Array.from({ length: 10 }, (_, index) => ({
        id: `todo_${index + 1}`,
        content: `Completed todo ${index + 1}`,
        status: 'done',
        evidenceRefs: [`todo_ref_${index + 1}`],
        updatedAt: '2026-01-01T00:00:00.000Z',
      })),
      readFiles: [
        readFile('src/read-only.ts'),
        readFile('src/shared.ts'),
        readFile('src/read-only.ts'),
      ],
      writeFiles: [
        writeFile('src/shared.ts'),
        writeFile('src/written.ts'),
      ],
      recentSignals: [
        signal('sig_1', 'low', 'low signal skipped'),
        signal('sig_2', 'medium', 'medium signal kept'),
        signal('sig_3', 'high', 'high signal kept'),
      ],
      recentErrors: [
        error('err_1', 'edit_failed'),
        error('err_2', 'edit_failed'),
        error('err_3', 'hashline_stale'),
      ],
    }), 'task_1', 'run_1');

    expect(snapshot).toMatchObject({
      taskId: 'task_1',
      runId: 'run_1',
      goal: 'Ship run archive snapshots',
      phase: 'executing',
      finalStep: 'Finalize context recall',
      completedTodoCount: 10,
    });
    expect(snapshot.completedTodos).toHaveLength(8);
    expect(snapshot.completedTodos[0]).toEqual({
      id: 'todo_1',
      label: 'Completed todo 1',
      evidenceRefs: ['todo_ref_1'],
    });
    expect(snapshot.readFiles).toEqual(['src/read-only.ts', 'src/shared.ts']);
    expect(snapshot.writtenFiles).toEqual(['src/shared.ts', 'src/written.ts']);
    expect(snapshot.keyFiles).toEqual([
      { path: 'src/shared.ts', role: 'read_and_written' },
      { path: 'src/written.ts', role: 'written' },
      { path: 'src/read-only.ts', role: 'read' },
    ]);
    expect(snapshot.keySignalSummaries).toEqual(['medium signal kept', 'high signal kept']);
    expect(snapshot.errorPatterns).toEqual(['edit_failed', 'hashline_stale']);
    expect(snapshot.evidenceRefs).toEqual([
      'runs/run_1/events.jsonl',
      'runs/run_1/outcome.json',
    ]);
    expect(snapshot.createdAt).toEqual(expect.any(String));
  });

  it('caps key files, non-low signals, and unique error patterns', () => {
    const snapshot = extractWorkingMemorySnapshot(workingMemory({
      readFiles: Array.from({ length: 12 }, (_, index) => readFile(`src/read-${index}.ts`)),
      writeFiles: Array.from({ length: 8 }, (_, index) => writeFile(`src/write-${index}.ts`)),
      recentSignals: Array.from({ length: 7 }, (_, index) =>
        signal(`sig_${index}`, index % 2 === 0 ? 'medium' : 'high', `signal ${index}`),
      ),
      recentErrors: Array.from({ length: 7 }, (_, index) => error(`err_${index}`, `pattern_${index}`)),
    }), 'task_1', 'run_1');

    expect(snapshot.keyFiles).toHaveLength(10);
    expect(snapshot.keyFiles.slice(0, 8).every((file) => file.role === 'written')).toBe(true);
    expect(snapshot.keySignalSummaries).toEqual(['signal 0', 'signal 1', 'signal 2', 'signal 3', 'signal 4']);
    expect(snapshot.errorPatterns).toEqual(['pattern_0', 'pattern_1', 'pattern_2', 'pattern_3', 'pattern_4']);
  });

  it('handles empty working memory collections', () => {
    const snapshot = extractWorkingMemorySnapshot(workingMemory({
      todos: [],
      readFiles: [],
      writeFiles: [],
      recentSignals: [],
      recentErrors: [],
    }), 'task_empty', 'run_empty');

    expect(snapshot.completedTodos).toEqual([]);
    expect(snapshot.readFiles).toEqual([]);
    expect(snapshot.writtenFiles).toEqual([]);
    expect(snapshot.keyFiles).toEqual([]);
    expect(snapshot.keySignalSummaries).toEqual([]);
    expect(snapshot.errorPatterns).toEqual([]);
  });
});

function workingMemory(overrides: Partial<TaskWorkingMemory> = {}): TaskWorkingMemory {
  return {
    taskId: 'task_1',
    runId: 'run_1',
    goal: 'Ship run archive snapshots',
    phase: 'executing',
    currentStep: 'Finalize context recall',
    todos: [],
    readFiles: [],
    writeFiles: [],
    recentErrors: [],
    recentSignals: [],
    artifactRefs: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function readFile(path: string): TaskWorkingMemory['readFiles'][number] {
  return {
    path,
    ranges: [],
    lastReadAt: '2026-01-01T00:00:00.000Z',
  };
}

function writeFile(path: string): TaskWorkingMemory['writeFiles'][number] {
  return {
    path,
    tool: 'hashline_edit',
    summary: `Edited ${path}`,
    writtenAt: '2026-01-01T00:00:00.000Z',
  };
}

function signal(
  id: string,
  severity: TaskWorkingMemory['recentSignals'][number]['severity'],
  summary: string,
): TaskWorkingMemory['recentSignals'][number] {
  return {
    id,
    kind: 'tool_error',
    severity,
    summary,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function error(id: string, pattern: string): TaskWorkingMemory['recentErrors'][number] {
  return {
    id,
    source: 'tool',
    pattern,
    summary: pattern,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}
