# v0.35 Part 2: XState Workflow State Machine

## Goal

Replace the manual `task.workflow_status = 'xxx'` assignments in `TasksManager` with an XState v5 state machine that enforces legal transitions. Invalid transitions should be logged and ignored (not crash). The rest of the codebase (`extension/index.ts`, etc.) should not change — `TasksManager` remains the public API.

## Context

- XState v5 (`xstate@5.31.0`) is already installed in `package.json`, but currently unused
- `src/memory/tasks/types.ts` defines `TaskWorkflowStatus` (22 states)
- `src/memory/tasks/manager.ts` (476 lines) — all status changes go through either `updateWorkflowStatus()` or direct assignment in methods like `completePhase()`, `incrementRetry()`, etc.
- `src/extension/index.ts` calls `tasksMgr.updateWorkflowStatus(id, 'executing')` and `createTask({workflowStatus: 'planning'})` — these callers must not change

## Current transition map (extracted from code)

These are the actual transitions that occur today:

```
createTask → awaiting_plan_approval (default) or planning or executing (yolo)

awaiting_plan_approval → executing          (user approves plan)
planning → executing                        (plan complete, auto-transition)
executing → retrying                        (incrementRetry)
executing → visual_review                   (completePhase, last phase, requires visual)
executing → user_review                     (completePhase, last phase, requires acceptance)
executing → completed                       (completePhase, last phase, no review needed)
executing → blocked                         (blockTask)
executing → failed                          (updateWorkflowStatus)
retrying → executing                        (retry accepted, re-execute)
visual_review → revision_requested          (requestRevision)
user_review → revision_requested            (requestRevision)
visual_review → accepted                    (acceptTask)
user_review → accepted                      (acceptTask)
accepted → completed                        (completeTask)
revision_requested → executing              (revision starts)
blocked → executing                         (unblock)
any → cancelled                             (cancelActiveTask)
```

## Step 1: Create the state machine definition

Create a new file: `src/memory/tasks/workflow-machine.ts`

Use XState v5 `setup().createMachine()` API. The machine:

- Has states matching `TaskWorkflowStatus` values (only the ones actually used — see transition map above)
- Accepts events like `{ type: 'APPROVE' }`, `{ type: 'EXECUTE' }`, `{ type: 'COMPLETE_PHASE' }`, `{ type: 'RETRY' }`, `{ type: 'BLOCK' }`, `{ type: 'REQUEST_REVISION' }`, `{ type: 'ACCEPT' }`, `{ type: 'COMPLETE' }`, `{ type: 'CANCEL' }`, `{ type: 'FAIL' }`, `{ type: 'UNBLOCK' }`
- Each state only allows specific transitions (see map above)
- `cancelled` is a final state (or allow re-entry to handle edge cases)
- `completed` is a final state
- Export the machine definition AND a helper to create an actor from it

Important XState v5 API notes:
- Use `import { setup, createActor } from 'xstate'`
- Machine is created with `setup({}).createMachine({ ... })`
- Actor is created with `createActor(machine, { snapshot: restoredSnapshot })` for rehydration
- Use `actor.getSnapshot().value` to get current state
- Use `actor.send({ type: 'EVENT_NAME' })` to send events
- In v5, states are defined under `states: { ... }` and transitions under `on: { ... }` inside each state

Also export a mapping function:

```typescript
/** Map a TaskWorkflowStatus string to the event needed to transition TO that status. */
export function workflowStatusToEvent(targetStatus: TaskWorkflowStatus): { type: string } | null
```

This mapping is needed so `updateWorkflowStatus(id, 'executing')` can be translated to `actor.send({ type: 'EXECUTE' })`.

The mapping:

```
'executing'            → { type: 'EXECUTE' }
'retrying'             → { type: 'RETRY' }
'blocked'              → { type: 'BLOCK' }
'failed'               → { type: 'FAIL' }
'visual_review'        → { type: 'COMPLETE_PHASE' }  // same event, machine decides target
'user_review'          → { type: 'COMPLETE_PHASE' }
'revision_requested'   → { type: 'REQUEST_REVISION' }
'accepted'             → { type: 'ACCEPT' }
'completed'            → { type: 'COMPLETE' }
'cancelled'            → { type: 'CANCEL' }
'planning'             → { type: 'PLAN' }
'awaiting_plan_approval' → { type: 'AWAIT_APPROVAL' }
```

## Step 2: Integrate into TasksManager

File: `src/memory/tasks/manager.ts`

1. Import the machine and helper from `./workflow-machine.js`

2. Add a private map of active actors per task:

```typescript
private actors: Map<string, ActorRefFrom<typeof workflowMachine>> = new Map();
```

3. Add a private method to get or create an actor for a task:

```typescript
private getOrCreateActor(task: Task): ActorRefFrom<typeof workflowMachine> {
  let actor = this.actors.get(task.id);
  if (!actor) {
    // Create actor initialized to the task's current workflow_status
    actor = createActor(workflowMachine, {
      snapshot: workflowMachine.resolveState({ value: task.workflow_status }),
    });
    actor.start();
    this.actors.set(task.id, actor);
  }
  return actor;
}
```

Note: `resolveState` in XState v5 — check the actual API. The goal is to create an actor that starts in the state matching `task.workflow_status`. If `resolveState` doesn't exist in v5, use `machine.createMachine` with `initial` set dynamically, or use the `snapshot` option of `createActor`. Read the xstate source in `node_modules/xstate` to find the correct v5 API for rehydration.

4. Modify `updateWorkflowStatus()`:

```typescript
async updateWorkflowStatus(taskId: string, status: TaskWorkflowStatus): Promise<void> {
  await this._write(async (file) => {
    const task = file.tasks.find((t) => t.id === taskId);
    if (!task) return;

    const event = workflowStatusToEvent(status);
    if (!event) {
      // Unknown target status — fall through to direct assignment (backward compat)
      task.workflow_status = status;
      return;
    }

    const actor = this.getOrCreateActor(task);
    const before = actor.getSnapshot().value;
    actor.send(event);
    const after = actor.getSnapshot().value as TaskWorkflowStatus;

    if (after === before && after !== status) {
      // Transition was not accepted — log warning but don't crash
      console.warn(
        `[TasksManager] Invalid workflow transition: ${before} → ${status} (event: ${event.type}). Ignored.`
      );
      return;
    }

    task.workflow_status = after;

    // Preserve existing side effects
    if (after === 'executing') {
      const phase = task.phases[task.active_phase_index];
      if (phase && phase.status === 'pending') phase.status = 'in_progress';
    }
    if (after === 'cancelled') {
      task.status = 'cancelled';
      file.active_task_id = null;
    }
    if (after === 'failed') {
      task.status = 'failed';
    }
    if (after === 'completed') {
      completeTaskInFile(file, task, 'Workflow marked completed.');
    }
  });
}
```

5. Also update the direct `task.workflow_status = 'retrying'` assignments inside `incrementRetry()`, `completePhase()`, `requestRevision()`, `acceptTask()`, `blockTask()`, `cancelActiveTask()` to use the actor:

For each method, replace the direct assignment with:

```typescript
const actor = this.getOrCreateActor(task);
actor.send({ type: 'RETRY' });  // or the appropriate event
task.workflow_status = actor.getSnapshot().value as TaskWorkflowStatus;
```

If the transition fails (state doesn't change), log a warning but still proceed with the rest of the method logic — the state machine is advisory, not blocking. This ensures backward compatibility.

6. Clean up actors when a task completes or is cancelled:

```typescript
this.actors.delete(task.id);
```

## Step 3: Tests

File: `src/memory/tasks/__tests__/workflow-machine.test.ts` (new file)

Test the state machine directly:

1. Valid transitions: `awaiting_plan_approval → EXECUTE → executing` ✅
2. Valid transitions: `executing → RETRY → retrying → EXECUTE → executing` ✅
3. Valid transitions: `executing → COMPLETE_PHASE → user_review → ACCEPT → accepted → COMPLETE → completed` ✅
4. Invalid transition: `completed → EXECUTE` should stay in `completed` (no crash)
5. Invalid transition: `awaiting_plan_approval → RETRY` should stay in `awaiting_plan_approval`
6. Cancel from any state: send `CANCEL` from `executing`, `planning`, `retrying` — all should reach `cancelled`
7. Rehydration: create actor with initial state `retrying`, send `EXECUTE`, verify it reaches `executing`

Also update `src/memory/tasks/__tests__/manager.test.ts`:

8. Test that `updateWorkflowStatus` with invalid transition logs warning and doesn't change status
9. Test that normal flow still works end-to-end through the manager

## Constraints

- Do NOT change any file outside `src/memory/tasks/` — `extension/index.ts` and other callers must keep calling `updateWorkflowStatus(id, status)` exactly as before
- The XState machine is ADVISORY — invalid transitions log warnings, never throw
- Do NOT add new workflow states or remove existing ones
- If you can't figure out XState v5 rehydration API, read `node_modules/xstate/src` to find the correct method. Key files: `node_modules/xstate/src/createActor.ts`, `node_modules/xstate/src/StateMachine.ts`
- Run `npx tsc --noEmit` to verify no type errors
- Run `npx vitest run src/memory/tasks/` to verify all tests pass
- Import from `'xstate'`, not `'xstate/lib/...'`
