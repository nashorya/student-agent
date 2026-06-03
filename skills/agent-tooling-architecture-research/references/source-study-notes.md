# Source Study Notes

Use this file when comparing coding-agent repositories or tool systems.

## Dimensions To Inspect

- Tool contract: schema, validation, permission checks, read-only flags, concurrency safety, output caps, rendering, telemetry.
- File read: path rules, binary/image/PDF handling, pagination, size limits, read-state tracking.
- File edit/write/patch: read-before-write, stale checks, diff preview, exact replacement, multi-file support, atomicity, history, diagnostics.
- Bash/process: timeout, background jobs, PTY, command safety, read-only classification, output persistence, process polling/cancel.
- Search/listing: grep/glob/ls tools, rg usage, hidden-dir policy, output truncation.
- Permissions/sandbox: path boundary, dangerous command handling, approvals, rollback.
- Task management: statuses, phases, owners, blockers, parent/child relationships, persistence, recovery, cancellation.
- Subagents: worktrees, isolation, merge/conflict behavior, read-only agents.
- Tool discovery: tool search, deferred tools, plugin/MCP integration.
- Eval/observability: transcript logs, deterministic graders, behavior scorers, task fixtures, baseline comparison.

## Prior Source Observations

These are memory-like notes from one study pass. Refresh sources when current accuracy matters.

### pengchengneo/Claude-Code

- Tool contract centered on `Tool.ts`: schema, prompt, input validation, permission checks, `isReadOnly`, `isConcurrencySafe`, max result size, path matching, result mapping, and UI rendering.
- File tools include read state, offset/limit, stale-file checks, exact replacement, read-before-edit/write discipline, notebook/PDF/image handling, and LSP/editor notification.
- Bash discourages using shell for cat/grep/find-style operations when dedicated tools exist. It classifies read-only commands, supports permissions/sandboxing, background execution, progress, and persistent output.
- Task features include Todo-style checklists plus richer task objects with status, owner, blockers, metadata, hooks, verification nudges, and subagent support.
- Bun appeared to be package manager/runtime/build tooling, not the core tool scheduler.

### opencode-ai/opencode

- Go implementation with tools under `internal/llm/tools`.
- Tool interface uses `ToolInfo`, `ToolResponse`, `ToolCall`, and `BaseTool`.
- Bash has timeout, banned commands, safe read-only classification, permission flow, persistent shell, and output truncation.
- Edit/write/view/patch enforce read-before-modify, stale checks via mod time, diffs, history versions, and diagnostics.
- Patch supports multi-file changes with read/stale/new-file checks and permission per change.
- Agent tool can launch read-only subagents with limited tools.

### openclaw/openclaw

- Tool descriptor/planner layer separates descriptors, availability, executors, ownership, diagnostics, and visibility.
- Agent tool construction pipeline applies workspace policy, sandbox bridge, provider policy, hooks, schema normalization, deferred tools, plugin/MCP tools, and tool search controls.
- `exec` supports host target, env/workdir/PTY/elevated/background/yield/timeouts, approvals, safe bins, sandbox dispatch, process registry, and script preflight.
- Apply patch supports add/update/delete/move, workspace path enforcement, symlink/alias checks, and summary output.
- Task registry models queued/running/succeeded/failed/timed_out/cancelled/lost, owners, scope, parent flows, child sessions, run IDs, delivery status, cancellation, and retry.

### NousResearch/hermes-agent

- Python tool registry supports schema, handler, toolset, check functions, max result size, discovery, dispatch, and error sanitization.
- Toolsets compose terminal/process, file read/write/patch/search, browser, todo, memory, session search, clarify, delegation, cron, and messaging.
- File operations track reads, staleness, line endings/BOM, lint/LSP diagnostics, search fallback, and path safety.
- Terminal tool supports local/docker/ssh/modal/singularity/daytona, foreground/background, process registry, watch patterns, PTY, sudo handling, dangerous-command approval, output truncation, and redaction.
- Tool executor handles sequential/concurrent execution, tool-search unwrap, guardrails, checkpoints before mutation, callbacks, budget, and repeated-failure/no-progress controls.
