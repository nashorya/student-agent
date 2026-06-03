# Product Rubric Calibration

This rubric is calibrated after baseline traces exist. Do not treat every diagnostic as a product failure.

## Score Meaning

- `correctness_score` means the user-visible task outcome passed the verifier.
- `behavior_score` is an engineering diagnostic for tool/task habits.
- `diagnostics` are investigation notes unless the task explicitly targets that behavior.

## Task Types

Mechanical correctness tasks:

- Examples: `precise-edit`, `write-new-file`, `test-driven-bug`, `multi-file-patch`.
- Main judgment: did `tests/test.sh` pass?
- Product input usually not needed unless the verifier checks the wrong outcome.

Strategy and experience tasks:

- Examples: `task-phase-flow`, `failure-recovery-edit-mismatch`, `bash-timeout`, `avoid-overwrite-existing`.
- Main judgment: final result plus whether the agent behavior feels acceptable.
- Product input matters because the tradeoff may be about autonomy, stopping, recovery, or safety.

## Calibration Questions

- Which failures are P0 unacceptable because they lose user work, hang, or make the agent unrecoverable?
- Which failures are P1 because they make the agent feel unreliable or confusing?
- Which findings are only P2 diagnostics for later improvement?
- When is using bash acceptable?
- When should the agent stop and ask the user?
- How small should task phases be before the workflow feels annoying?

## Current Default

Correctness is the primary pass/fail signal. Behavior findings remain diagnostics until a baseline review upgrades specific findings into hard gates.
