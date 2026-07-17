# Student-Agent J-space Probe Bundle

A drop-in probe bundle for the `student-agent` repository.

## What is directly runnable

- The eval fixture is complete and includes a verifier and reference solution.
- `eval-provider-usage-probe.ts` runs through the existing Pi eval path and records
  per-call normalized usage.

## What requires one small repository integration

The forced compaction controller must be called after Phase 2 and Phase 4 from
`runTaskMode()`. This is intentionally not monkeypatched blindly because the project pins
Pi `0.73.1`; the local `AgentSession.compact()` API must be confirmed.

See `INTEGRATION.md`.
