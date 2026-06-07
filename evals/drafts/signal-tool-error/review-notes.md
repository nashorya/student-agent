# Review Notes — signal-tool-error

## Construct

This eval measures **tool error signal capture and provenance tracking**: when a tool execution fails, the signal pipeline must intercept the failure, create a signal record with non-empty provenance (identifying which tool failed and when), and make that signal queryable for downstream components like `recentErrors`. The construct is not "the agent fixes a TypeScript bug" but "the system captures and records tool failure signals with sufficient metadata for traceability."

## Instruction <-> Environment <-> Tests Correspondence

| Instruction says | Environment provides | Tests verify |
|---|---|---|
| Fix the `r.value` bug (undefined handling) | `src/process.ts` with `data.map(r => r.value)` | extractValues uses `?? 0`, optional chaining, or equivalent |
| Add `sumValues` export function | Type definition for `DataItem` | `sumValues` function exists, is exported, and handles undefined |
| Trigger one harmless tool error and continue | signal pipeline is an external system | `tool-error-signal-report.md` reports count/provenance/continuation |

## Risks and Potential Issues

### Grader too broad
The test uses regex patterns to check for null/undefined handling (`r.value ?? 0`, `r?.value`, etc.). Some edge cases:
- `r.value || 0` would pass the regex but is semantically different (falsy values like 0 would map to 0, which is fine for numbers but inconsistent with `??`)
- The test does not verify the actual runtime behavior of `sumValues` — only that it references values somehow

### Grader too narrow
The test requires `sumValues` to be exported and reference `.value` or use `reduce`. A `for`-loop implementation that doesn't use these patterns might fail the grep check even if correct. The alternative-valid case shows a filter-map-reduce approach that passes, but other valid implementations (e.g., `for (const item of data)`) might not.

### State leakage risk
The environment is a single TypeScript file with no external dependencies. State leakage between trials is unlikely given proper sandbox cleanup.

### Dependency risk
The test uses bash with grep/sed for verification. TypeScript compilation is NOT checked — the test only verifies syntactic patterns in the source code, not type correctness. This is acceptable for a deterministic eval but weaker than a full TypeScript compilation check.

### Signal pipeline gap (most critical)
This eval's structural test checks `tool-error-signal-report.md`, but that report is agent-writable. A full signal pipeline integration test must query trusted `signal_tool_error_count`, `signal_provenance_non_null_count`, and `main_task_running` values from the signal store or tool trace. This gap exists because the current deterministic sandbox test cannot observe protected signal pipeline state directly. This is the primary concern for independent evaluators.

## Draft Status

**Current status: DRAFT_BLOCKED.** It has NOT been through:
- Independent static audit (ABA optional)
- Formal verifier validation
- Agent trials
- Human review
- CommitGate

It MUST NOT be marked `HARNESS_READY` or promoted to `evals/specs/` or `evals/tasks/` until all gate requirements are met.

### Key flags for independent evaluators
1. The structural test does NOT enforce signal pipeline provenance from trusted data. This is the most critical gap — the eval's named construct (tool error signal capture) is only approximated by an agent-writable report.
2. The test uses regex patterns for TypeScript correctness, which is weaker than type-checking.
3. The instruction mentions error handling but the task is purely structural. A better eval would require the agent to actually trigger a tool error and verify its capture.
