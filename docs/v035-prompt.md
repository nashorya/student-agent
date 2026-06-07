# v0.35: Working Memory Expansion

## Goal

Extend `TaskWorkingMemory` with file-tracking and error-tracking fields, hook them into the read/edit tools so they auto-populate, and ensure the active task's working memory survives agent restarts (it already persists in tasks.json — just verify the restart path reads it back).

No XState. No new runtime. Just expand the existing TasksManager.

## Context

- Task system: `src/memory/tasks/types.ts` (86 lines), `src/memory/tasks/manager.ts` (451 lines)
- Tests: `src/memory/tasks/__tests__/manager.test.ts` (125 lines)
- Read/edit tools with hashline: `src/core/pi-bridge/student-file-tools.ts`
- Session factory wiring: `src/core/pi-bridge/session-factory.ts`
- Main entry point: `src/extension/index.ts` — look for `tasksMgr.getActive()` calls to understand how active task is consumed

## Step 1: Extend TaskWorkingMemory type

File: `src/memory/tasks/types.ts`

Add these fields to the `TaskWorkingMemory` interface:

```typescript
// Files the agent has read during this task (deduplicated paths)
read_files: string[];
// Files the agent has written/edited during this task (deduplicated paths)
written_files: string[];
// Recent errors encountered during this task (capped at 10, newest last)
recent_errors: string[];
```

## Step 2: Update TasksManager

File: `src/memory/tasks/manager.ts`

1. Update `normalizeWorkingMemory()` to include the 3 new fields with empty array defaults.

2. Update `mergeWorkingMemory()` to merge the 3 new fields using `mergeUnique` for `read_files` and `written_files`. For `recent_errors`, append and cap at 10:

```typescript
recent_errors: capArray(
  [...current.recent_errors, ...(patch.recent_errors ?? [])].filter(Boolean),
  10
),
```

3. Add a helper:

```typescript
function capArray(arr: string[], max: number): string[] {
  return arr.length > max ? arr.slice(arr.length - max) : arr;
}
```

4. Add two convenience methods to `TasksManager`:

```typescript
async trackFileRead(taskId: string, filePath: string): Promise<void> {
  await this.updateWorkingMemory(taskId, { read_files: [filePath] });
}

async trackFileWrite(taskId: string, filePath: string): Promise<void> {
  await this.updateWorkingMemory(taskId, { written_files: [filePath] });
}

async trackError(taskId: string, error: string): Promise<void> {
  await this.updateWorkingMemory(taskId, { recent_errors: [error] });
}
```

## Step 3: Hook into read/edit tools

File: `src/core/pi-bridge/student-file-tools.ts`

The read and edit tool definitions need access to `TasksManager` to track file operations.

1. Add a `tasksManager` option to both `ReadToolHashlineOptions` and `EditToolHashlineOptions`:

```typescript
export interface ReadToolHashlineOptions {
  store?: SnapshotStore;
  tasksManager?: TasksManager;  // NEW
}

export interface EditToolHashlineOptions {
  store?: SnapshotStore;
  fs?: Filesystem;
  tasksManager?: TasksManager;  // NEW
}
```

2. In the read tool's `execute` wrapper (the hashline-enabled branch), after recording in the snapshot store, add:

```typescript
if (tasksManager && typeof filePath === 'string') {
  const activeTask = await tasksManager.getActive();
  if (activeTask) {
    tasksManager.trackFileRead(activeTask.id, filePath).catch(() => {});
  }
}
```

Use fire-and-forget (`.catch(() => {})`) — file tracking is best-effort and must not block the read.

3. In the edit tool's `execute` wrapper, after a successful edit (both the hashline-validated path and the base fallback path), add similar tracking:

```typescript
if (tasksManager) {
  const editPath = extractEditPath(input);
  if (editPath) {
    const activeTask = await tasksManager.getActive();
    if (activeTask) {
      tasksManager.trackFileWrite(activeTask.id, editPath).catch(() => {});
    }
  }
}
```

4. For error tracking, in the edit tool's catch blocks (both hashline rejection and base edit errors), add:

```typescript
if (tasksManager) {
  const activeTask = await tasksManager.getActive();
  if (activeTask) {
    const msg = err instanceof Error ? err.message : String(err);
    tasksManager.trackError(activeTask.id, msg.slice(0, 200)).catch(() => {});
  }
}
```

## Step 4: Wire up in session-factory

File: `src/core/pi-bridge/session-factory.ts`

Pass the `TasksManager` instance to the read and edit tool constructors:

```typescript
import { TasksManager } from '../../memory/tasks/manager.js';
// ...
const tasksManager = TasksManager.getInstance();
// ...
createStudentReadToolDefinition(cwd, { store: hashlineStore, tasksManager }),
createStudentEditToolDefinition(cwd, { store: hashlineStore, fs: hashlineFs, tasksManager }),
```

Check how `TasksManager.getInstance()` is called elsewhere in the file or in `index.ts` to follow the same pattern. It's a singleton, so just call `getInstance()`.

## Step 5: Restart recovery verification

The active task's working memory already persists in `tasks.json` and is loaded on startup via `tasksMgr.getActive()`. Verify this works:

1. Read `src/extension/index.ts` and find where `tasksMgr.getActive()` is called on startup or when a user message arrives.
2. Confirm that `working_memory` (including the new fields) is available after restart.
3. If the active task's working memory is surfaced in the prompt (check `src/core/task-planner/task-context-builder.ts`), ensure the new fields are included in the rendered output.

## Step 6: Tests

File: `src/memory/tasks/__tests__/manager.test.ts`

Add tests for:

1. `trackFileRead` adds to `read_files` (deduplicated)
2. `trackFileWrite` adds to `written_files` (deduplicated)
3. `trackError` appends to `recent_errors` and caps at 10
4. `normalizeWorkingMemory` handles missing new fields gracefully (returns empty arrays)
5. `mergeWorkingMemory` merges new fields correctly

## Constraints

- Do NOT install XState or any new dependency
- Do NOT modify the TaskWorkflowStatus enum or add new workflow states
- Do NOT change the task lifecycle flow in `extension/index.ts`
- Keep all file tracking best-effort (fire-and-forget, never block tool execution)
- The `recent_errors` array must be capped at 10 entries to prevent unbounded growth
- All new fields must have empty array defaults so existing tasks.json files remain compatible
- Run `npx tsc --noEmit` to verify no type errors after all changes
- Run `npx vitest run src/memory/tasks/__tests__/manager.test.ts` to verify tests pass
