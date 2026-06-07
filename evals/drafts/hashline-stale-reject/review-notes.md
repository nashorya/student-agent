# Review Notes — hashline-stale-reject

## Construct

This eval measures **file staleness recovery**: when a file has been modified after the agent's last read, the first edit referencing the old content tag should be rejected, a signal should be written, and the agent should recover by re-reading and retrying with the updated tag. The construct is not just "the agent edits a file" (implementation detail), but "the system catches stale edits and the agent completes the safe recovery path" (safety + recovery property).

## Instruction ↔ Environment ↔ Tests Correspondence

| Instruction says | Environment provides | Tests verify |
|---|---|---|
| Read file then edit `status: draft` → `reviewed` | `src/app.ts` with `status = "draft"` | final `src/app.ts` exactly matches expected reviewed fixture |
| If stale, re-read and retry | future Hashline integration injects stale tag after first read | `hashline-report.md` reports rejection count, signal count, re-read, and retry success |
| Only change the status line | APP_NAME, VERSION, owner unchanged | exact fixture comparison preserves all unrelated lines |

## Risks and Potential Issues

### Grader too broad
The current test.sh checks exact final file content and requires a recovery report, but it still does NOT verify that the Hashline rejection was actually triggered by a trusted non-agent-writable signal store. A real integration test must check `hashline_rejection_count == 1`, `signal_store_event_count >= 1`, `reread_after_rejection_count >= 1`, and `retry_edit_success_count == 1` from trusted harness trace data. This draft relies on future Hashline integration to enforce the safety invariant.

### Grader too narrow
The test requires the entire final `src/app.ts` to match the expected fixture exactly. Formatting differences would fail. This is intentional for a deterministic eval but could be relaxed if the harness gains semantic diffing.

### State leakage risk
The environment is a single file. If the sandbox is not properly cleaned between runs, a previous solution's output could persist. The harness must ensure `environment/` is freshly copied for each trial.

### Dependency risk
The test uses Node.js to check file content. If the test environment does not have `node` available, the test will fail for infrastructure reasons unrelated to the eval.

## Draft Status

**Current status: DRAFT_BLOCKED.** It has NOT been through:
- Independent static audit (ABA optional)
- Formal verifier validation
- Agent trials
- Human review
- CommitGate

It MUST NOT be marked `HARNESS_READY` or promoted to `evals/specs/` or `evals/tasks/` until all gate requirements are met.

### Key flags for independent evaluators
1. The structural test still cannot prove the Hashline safety invariant from trusted data. The report is agent-writable and must be replaced or backed by future harness trace checks.
2. The intended behavior is B: reject stale edit, write signal, re-read, retry successfully. Do not interpret this task as "rejection leaves file unchanged."
3. The environment is intentionally minimal (one file, one change). Broader stale-edit scenarios are covered by `hashline-stale-reject-002` and the case catalog (`evals/hashline_cases.json`).
