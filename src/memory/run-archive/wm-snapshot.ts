import type { TaskWorkingMemory } from '../tasks/types.js';
import type { WorkingMemorySnapshot } from './types.js';

export function extractWorkingMemorySnapshot(
  wm: TaskWorkingMemory,
  taskId: string,
  runId: string,
): WorkingMemorySnapshot {
  const doneTodos = wm.todos.filter((todo) => todo.status === 'done');
  const readFiles = unique(wm.readFiles.map((file) => file.path)).slice(0, 10);
  const writtenFiles = unique(wm.writeFiles.map((file) => file.path)).slice(0, 10);

  return {
    taskId,
    runId,
    goal: wm.goal ?? '',
    phase: wm.phase ?? '',
    finalStep: wm.currentStep ?? '',
    completedTodos: doneTodos.slice(0, 8).map((todo) => ({
      id: todo.id,
      label: todo.content,
      evidenceRefs: todo.evidenceRefs,
    })),
    completedTodoCount: doneTodos.length,
    readFiles,
    writtenFiles,
    keyFiles: buildKeyFiles(readFiles, writtenFiles),
    keySignalSummaries: wm.recentSignals
      .filter((signal) => signal.severity !== 'low')
      .map((signal) => signal.summary)
      .slice(0, 5),
    errorPatterns: unique(wm.recentErrors.map((error) => error.pattern)).slice(0, 5),
    evidenceRefs: [
      `runs/${runId}/events.jsonl`,
      `runs/${runId}/outcome.json`,
    ],
    createdAt: new Date().toISOString(),
  };
}

function buildKeyFiles(
  readFiles: string[],
  writtenFiles: string[],
): WorkingMemorySnapshot['keyFiles'] {
  const readSet = new Set(readFiles);
  const writtenSet = new Set(writtenFiles);
  const readAndWritten = writtenFiles
    .filter((path) => readSet.has(path))
    .map((path) => ({ path, role: 'read_and_written' as const }));
  const writtenOnly = writtenFiles
    .filter((path) => !readSet.has(path))
    .map((path) => ({ path, role: 'written' as const }));
  const readOnly = readFiles
    .filter((path) => !writtenSet.has(path))
    .map((path) => ({ path, role: 'read' as const }));

  return [...readAndWritten, ...writtenOnly, ...readOnly].slice(0, 10);
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}
