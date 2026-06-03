# Student-Agent Eval Baseline

This directory contains Harbor/Terminal-Bench-style local eval tasks for the
student-agent tool and task baseline.

Task layout:

- `instruction.md`: prompt sent to the agent.
- `task.toml`: task metadata used by the TypeScript harness and Inspect adapter.
- `environment/`: files copied into a temporary sandbox.
- `tests/test.sh`: verifier. It receives `SANDBOX_DIR`, `LOGS_DIR`, `REWARD_FILE`, and `REWARD_JSON_FILE`.
- `solution/solve.sh`: optional reference solution for `npm run eval:validate`.

Commands:

- `npm run eval:validate`: deterministic fixture validation, no model call.
- `npm run eval:baseline`: live baseline run, requires configured model API key.
- `npm run eval:baseline -- --task precise-edit`: run one task.
- `npm run eval:baseline -- --trials 3`: run multiple trials.

Scoring vocabulary:

- `correctness_score`: product-facing outcome. For most low-level file tasks, this is the main pass/fail signal and comes from `tests/test.sh`.
- `behavior_score`: engineering diagnostic. It records tool-use smells such as bash-for-cat, missing read-before-edit, repeated failed edits, or unfinished task state.
- `diagnostics`: investigation notes. They are not automatically product failures unless the task explicitly targets that behavior or the behavior caused wrong output.

Task review rule:

- For mechanical tasks such as `precise-edit`, `write-new-file`, or `test-driven-bug`, judge the task mainly by `correctness_score`.
- For strategy tasks such as `task-phase-flow`, `failure-recovery-edit-mismatch`, `bash-timeout`, or `avoid-overwrite-existing`, inspect both final correctness and diagnostics.
