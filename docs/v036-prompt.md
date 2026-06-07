# v0.36: ToolGuard Hook v0

## Goal

Create a new `tool-guard.ts` hook that blocks agent bad behaviors before tool execution. Register it into the existing hook chain in `index.ts`, alongside FileGuard and RiskGuard.

## Context

- Existing hooks to study as reference:
  - `src/extension/hooks/file-guard.ts` — same pattern: export a factory, return `{ hook, reset }`
  - `src/extension/hooks/risk-guard.ts` — same pattern
- Hook type: `src/core/pi-bridge/types.ts` — `PreToolCallContext` (toolName, toolCallId, args) and `PreToolCallDecision` (block, reason)
- Hook chain in `src/extension/index.ts` lines 246-253 — guards run in sequence, first block wins
- ProtectedEvalEvent emitter: `src/core/hashline/event-emitter.ts` — `emitProtectedEvent()`
- Hashline store: available via `src/core/pi-bridge/session-factory.ts` but ToolGuard doesn't need it directly

## Step 1: Create `src/extension/hooks/tool-guard.ts`

Read `src/extension/hooks/file-guard.ts` first to understand the pattern, then create a new file following the same structure.

### Interface

```typescript
import type { PreToolCallContext, PreToolCallDecision } from '../../core/pi-bridge/types.js';

export interface ToolGuard {
  hook: (ctx: PreToolCallContext) => Promise<PreToolCallDecision | undefined>;
  reset: () => void;
}

export function createToolGuardHook(): ToolGuard { ... }
```

### Rule 1: Empty bash block

Block bash/shell tool calls where the command is empty or whitespace-only.

Detection:
```typescript
const SHELL_TOOLS = new Set(['bash', 'shell', 'terminal', 'exec_command']);
// ...
if (SHELL_TOOLS.has(toolName)) {
  const command = extractCommand(ctx.args);  // extract "command" field from args
  if (!command || command.trim() === '') {
    // emit ProtectedEvalEvent + block
  }
}
```

Block reason: `'[ToolGuard:empty_bash] 空命令已阻断。请提供具体的 shell 命令。'`

### Rule 2: Natural language bash block

Block bash/shell calls where the command is natural language instead of a valid shell command.

Detection heuristic — the command matches natural language patterns:
```typescript
const NL_BASH_PATTERNS = [
  /^(please|help|can you|could you|i want|i need|let's|show me|tell me|explain)/i,
  /^(创建|删除|修改|查看|帮我|请|运行|执行|打开).{0,5}(一个|这个|那个|文件|目录|项目)/,
  // A command that contains no shell metacharacters and has 5+ space-separated words
  // where none of the words look like flags (--xxx) or paths (/xxx or ./xxx)
];
```

Also check: if the command has no shell metacharacters (`|`, `>`, `<`, `;`, `&&`, `||`, `$`, `` ` ``) AND has 5+ space-separated words AND none start with `-` or `/` or `.`, it's likely natural language.

Block reason: `'[ToolGuard:nl_bash] 自然语言命令已阻断。bash 工具只接受 shell 命令，不是自然语言描述。'`

### Rule 3: Broad glob block

Block glob/search tools that use overly broad patterns without a directory prefix.

Detection:
```typescript
// Matches patterns like "**/*.ts", "**/*.tsx", "*/*.js" without a specific directory prefix
const BROAD_GLOB_RE = /^(?:\.\/)?\*{1,2}[/\\]/;
```

Apply this rule to tools: `glob`, `search_files`, `find`, `list_files`

Check the `pattern` or `glob` argument field. If the pattern starts with `**/` or `*/` (with or without `./` prefix) and has no directory prefix before the wildcard, block it.

Block reason: `'[ToolGuard:broad_glob] 过于宽泛的 glob 模式已阻断。请添加具体目录前缀，例如 src/core/**/*.ts 而非 **/*.ts。'`

### Rule 4: Patch retry guard

Block repeated edit attempts on the same file with the same failure kind without re-reading.

Track state:
```typescript
interface EditAttempt {
  path: string;
  failureKind: string;  // e.g. "old_text_not_found", "mismatch"
  timestamp: number;
}
let recentFailures: EditAttempt[] = [];  // capped at 20
let recentReads: Set<string> = new Set();  // paths read since last failure
```

Logic:
- On read tool call (`read`, `read_file`): add the path to `recentReads`
- On edit tool call (`edit`, `apply_patch`): check if there's a recent failure for the same path with the same failureKind, AND the path is NOT in `recentReads` since that failure. If so, block.
- Track failures from the PostToolCallContext (afterToolCall). But since ToolGuard is a beforeToolCall hook, it can only check past state. So:
  - When an edit is NOT blocked, record its path. If the edit later fails (detected in afterToolCall/escalation), record the failure.
  - For simplicity in v0: just track consecutive edit calls to the same path. If the agent calls edit on the same file twice in a row without a read in between, AND the previous call was to the same path, block with a warning.

Simplified v0 detection:
```typescript
let lastEditPath: string | null = null;
let lastEditBlocked: boolean = false;

// On edit tool:
const editPath = extractPath(ctx.args);
if (editPath && editPath === lastEditPath && !recentReads.has(editPath)) {
  // Same file, no re-read since last edit → block
  recentReads.clear();
  lastEditBlocked = true;
  // block
}
lastEditPath = editPath;

// On read tool:
const readPath = extractPath(ctx.args);
if (readPath) recentReads.add(readPath);
```

Block reason: `'[ToolGuard:patch_retry] 未重新读取就重复编辑同一文件已阻断。请先 re-read 文件再重试编辑。'`

### ProtectedEvalEvent emission

For each block, emit a ProtectedEvalEvent before returning the block decision:

```typescript
import { emitProtectedEvent } from '../../core/hashline/index.js';

// Example for empty_bash:
emitProtectedEvent({
  source: 'toolguard',
  type: 'block',
  path: '',
  evidenceRef: ctx.toolCallId,
  blocked: true,
  provenance: { ruleName: 'empty_bash', command: command ?? '' },
});
```

Use the correct `ruleName` for each rule: `'empty_bash'`, `'nl_bash'`, `'broad_glob'`, `'patch_retry'`.

### reset()

Clear all internal state (recentReads, lastEditPath, recentFailures, etc.). Called when a new task starts.

## Step 2: Register in `src/extension/index.ts`

1. Import `createToolGuardHook` from `'./hooks/tool-guard.js'`

2. Create the instance next to fileGuard and riskGuard (around line 239):

```typescript
const toolGuard = createToolGuardHook();
```

3. Add it to the hook chain (around line 247). Insert it BEFORE fileGuard — ToolGuard rules are cheaper and should run first:

```typescript
onBeforeToolCall: async (ctx) => {
  const toolGuardDecision = await toolGuard.hook(ctx);
  if (toolGuardDecision?.block) return toolGuardDecision;
  const guardDecision = await fileGuard.hook(ctx);
  if (guardDecision?.block) return guardDecision;
  const riskDecision = await riskGuard.hook(ctx);
  if (riskDecision?.block) return riskDecision;
  return snapshotHook(ctx);
},
```

4. Add `resetToolGuard: toolGuard.reset` to the returned object, and call `toolGuard.reset()` wherever `fileGuard.reset()` is called.

## Step 3: Tests

Create `src/extension/hooks/__tests__/tool-guard.test.ts`

Test cases:

1. Empty bash: `{ toolName: 'bash', args: { command: '' } }` → blocked with `empty_bash`
2. Empty bash (whitespace): `{ toolName: 'bash', args: { command: '   ' } }` → blocked
3. Normal bash: `{ toolName: 'bash', args: { command: 'ls -la' } }` → not blocked
4. Natural language bash: `{ toolName: 'bash', args: { command: 'please create a new file called test' } }` → blocked with `nl_bash`
5. Normal bash with flags: `{ toolName: 'bash', args: { command: 'grep -rn "hello" src/' } }` → not blocked
6. Broad glob: `{ toolName: 'glob', args: { pattern: '**/*.ts' } }` → blocked with `broad_glob`
7. Scoped glob: `{ toolName: 'glob', args: { pattern: 'src/core/**/*.ts' } }` → not blocked
8. Patch retry without re-read: call edit on `a.ts`, then edit on `a.ts` again without read → blocked with `patch_retry`
9. Patch retry with re-read: call edit on `a.ts`, then read `a.ts`, then edit `a.ts` → not blocked
10. reset() clears state: after triggering patch_retry state, call reset(), then same edit pattern → not blocked

## Constraints

- Follow the same pattern as `file-guard.ts` — factory function returning `{ hook, reset }`
- All blocks emit ProtectedEvalEvent via `emitProtectedEvent()`
- Block reasons are in Chinese (consistent with existing guards)
- The natural language detection should be conservative — it's better to let a borderline command through than to block a valid command
- Do NOT modify `file-guard.ts` or `risk-guard.ts`
- Do NOT modify `types.ts`
- Run `npx tsc --noEmit` to verify no type errors
- Run `npx vitest run src/extension/hooks/__tests__/tool-guard.test.ts` to verify tests pass
