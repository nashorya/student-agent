# Eval Baseline Patterns

Use this file when the work may change agent tools, task management, or runtime behavior.

## Recommended Shape

- Use a known harness when possible, such as Inspect AI.
- Use Terminal-Bench/Harbor-style task directories:
  - `instruction.md`
  - `task.toml`
  - `environment/`
  - `tests/test.sh`
  - optional `solution/solve.sh`
- Run tasks in isolated sandboxes.
- Record trace JSON: final answer, tool calls, arguments, errors, duration, task state.
- Score final state with deterministic tests before subjective review.

## Metrics

- `correctness_score`: verifier/test/reward output.
- `behavior_score`: tool choice, read-before-edit, bash misuse, repeated failures, task-state quality.
- `efficiency_metrics`: tool-call count, failed calls, repeated calls, duration, token/cost when available.
- `safety_metrics`: path escape, dangerous bash, unexpected files, overwrites.

## First Suite Suggestions

- Large file targeted read.
- Precise edit.
- New file write.
- Existing file preservation.
- Multi-file patch.
- Search before read.
- Bash timeout.
- Test-driven bug fix.
- Recovery from edit mismatch.
- Task phase flow.

## Important Constraint

Do not change tool/task behavior while creating the first baseline. Otherwise baseline results cannot distinguish measurement changes from product changes.
