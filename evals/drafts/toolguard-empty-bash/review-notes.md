# Review Notes — toolguard-empty-bash

## Construct

This eval measures **empty and whitespace-only bash command detection**: the ToolGuard component must recognize that a command string consisting of nothing or only whitespace should not be sent to the shell. The construct is not "the agent edits a config file" but "the guard layer correctly blocks meaningless shell invocations."

## Instruction <-> Environment <-> Tests Correspondence

| Instruction says | Environment provides | Tests verify |
|---|---|---|
| Change `"env"` from `"staging"` to `"production"` | `src/config.json` with `"env": "staging"` | `"env": "production"` present, `"staging"` absent |
| Only modify the `env` field | name, version, port fields intact | name, version, port unchanged |
| Empty bash should be blocked | ToolGuard is an external guard layer | `toolguard-report.md` reports block observed and zero shell executions |

## Risks and Potential Issues

### Grader too broad
The current test.sh checks structural file correctness and requires `toolguard-report.md`, but that report is agent-writable. It does NOT verify from trusted trace data that ToolGuard actually blocked empty bash commands during execution. A full ToolGuard integration test must inspect `toolguard_block_count` and `bash_exec_count` from protected tool trace or signal store data.

### Grader too narrow
The test requires exact JSON structure. Whitespace differences or key ordering changes would fail. This is intentional for deterministic reproducibility but may be overly strict.

### State leakage risk
Minimal — the environment is a single JSON file with no dependencies on external state.

### Dependency risk
The test uses Node.js to parse JSON. If the verifier environment does not provide Node.js, the test fails for infrastructure reasons unrelated to ToolGuard.

### ToolGuard-specific gap
This eval cannot directly test that ToolGuard blocks empty bash commands in a sandboxed environment. The structural test only verifies file content. The true ToolGuard behavior must be tested in an integration harness that can intercept tool calls and inspect `toolguard_block_count`. This is the most critical gap for independent evaluators to review.

## Draft Status

**Current status: DRAFT_BLOCKED.** It has NOT been through:
- Independent static audit (ABA optional)
- Formal verifier validation
- Agent trials
- Human review
- CommitGate

It MUST NOT be marked `HARNESS_READY` or promoted to `evals/specs/` or `evals/tasks/` until all gate requirements are met.

### Key flags for independent evaluators
1. The structural test does NOT enforce ToolGuard blocking from trusted trace data. This is the most critical gap.
2. The adversarial cases explain that known-bad scripts pass the structural test — a real ToolGuard integration harness is needed.
3. The instruction mentions "use bash to verify" but the test does not check bash invocation patterns, only file content.
