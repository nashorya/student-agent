# Gap And Decision Matrix

Use this matrix before implementation.

| Area | Current Evidence | Reference Pattern | Gap | Decision |
|---|---|---|---|---|
| Tool contract | What the repo exposes today | Unified schema/permission/output/runtime contract | Missing or fragmented behavior | Add runtime / modify wrappers / defer |
| File read | Current read behavior and limits | Pagination, size caps, non-text handling, read tracking | Inefficient reads or missing safety | Modify read or add search first |
| Edit/write/patch | Current mutation behavior | Read-before-write, stale checks, diff, patch | Wrong edits, overwrites, fragile oldText | Add patch / strengthen edit-write |
| Bash/process | Current shell behavior | Timeouts, background process, PTY, safe classifier | Hangs, output loss, bash overuse | Add process / restrict bash / improve exec |
| Search/listing | Existing grep/glob/ls support | Dedicated rg/glob/list tools | Bash used for discovery | Add search tools |
| Permissions | Current guards | Path boundary, approval, dangerous commands, rollback | Unsafe or annoying approvals | Adjust guardrails |
| Task management | Current task state | Registry, status, blockers, ownership, recovery | Chaotic phases or lost state | Redesign task registry |
| Eval | Current tests/benchmarks | Harness, task fixtures, trace scoring | No baseline | Build eval first |

## Decision Rules

- If failures cannot be reproduced, build eval baseline first.
- If tools share the same missing concerns, introduce a unified tool runtime rather than patching each tool independently.
- If only argument aliases or prompts fail, prefer small wrapper changes.
- If bash is doing read/search/list work, add dedicated tools before restricting bash too hard.
- If task state is not queryable/recoverable/cancellable, treat task management as its own subsystem, not a prompt tweak.
- If product tradeoffs are unresolved, defer hard scorer thresholds until baseline transcripts are reviewed.
