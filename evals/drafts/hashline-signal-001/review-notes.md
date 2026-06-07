# Review Notes — hashline-signal-001

## Construct

This eval measures **rejection signal provenance integrity**: when a stale-tag edit is rejected, the signal store must produce a rejection event with non-empty provenance and evidence reference fields. The construct is "rejection signals carry full traceability metadata" (integration property), not "a rejection signal is written" (implementation detail) nor "the file edit succeeds" (which is a separate concern tested by hashline-stale-reject).

## Instruction ↔ Environment ↔ Tests Correspondence

| Instruction says | Environment provides | Tests verify |
|---|---|---|
| Read file, then edit `enabled: false` → `true` | `src/pipeline.ts` with `enabled: false` | `enabled: true` present, `enabled: false` absent |
| If stale rejection occurs, verify signal provenance | (signal store is an external system) | `signal-audit.md` exists with required fields |
| Report findings in `signal-audit.md` | (instruction specifies format) | Audit file contains Rejection count, Provenance non-null, EvidenceRef non-null |
| Do not modify other lines | `PIPELINE_NAME`, `verbose: true` | PIPELINE_NAME and verbose unchanged |

## Risks and Potential Issues

### Grader too broad
The current test.sh verifies the required audit values (`Rejection count: 1`, provenance `yes`, evidenceRef `yes`), but those values are still written by the agent. A real Hashline integration test must compare them against the trusted signal store rather than accepting the report as source of truth.

### Grader too broad (fabrication)
The test cannot distinguish a fabricated audit from one derived from the actual signal store. An agent could write "yes" for all fields without checking anything. This is a fundamental limitation of structural testing; only Hashline integration with write-protected signal store resolves it.

### Instruction complexity
This eval requires the agent to perform two distinct tasks: (1) edit the file and (2) inspect and report on the signal store. If the agent only does task 1, it will fail. This dual requirement is intentional — the construct is about signal provenance, not just file editing.

### Dependency on signal store
The eval's pass condition depends on the signal store being populated by the Hashline rejection. If the harness injects a stale-tag scenario externally, the agent may not observe a rejection at all (the edit might succeed if the harness does not modify the file between read and edit). This draft assumes the harness will externally modify the file after the agent's read.

## Draft Status

**Current status: DRAFT_BLOCKED.** It has NOT been through:
- Independent static audit (ABA optional)
- Formal verifier validation
- Agent trials
- Human review
- CommitGate

It MUST NOT be marked `HARNESS_READY` or promoted to `evals/specs/` or `evals/tasks/` until all gate requirements are met.

### Key flags for independent evaluators
1. The structural test cannot verify that signal provenance and evidenceRef are actually non-null in the trusted store — it only checks that the agent reported the required values. A real Hashline integration test must cross-check against the signal store.
2. The "fabricated audit" exploit is still possible if the verifier trusts `signal-audit.md`. This is the most critical gap.
3. The instruction explicitly asks the agent to inspect the signal store, which assumes the agent has access to a signal store API. If the harness does not provide this API, the eval is not executable.
