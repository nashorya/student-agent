# Review Notes — hashline-recovery-001

## Construct

This eval measures **consecutive file edit integrity via hash tag chaining**: when the same file is edited multiple times in sequence, each edit must use the content tag returned by the previous operation, and all edits must succeed without stale-tag rejections. The construct is "sequential anchored edits preserve content integrity" (correctness property), not "the agent calls edit three times" (implementation detail).

## Instruction ↔ Environment ↔ Tests Correspondence

| Instruction says | Environment provides | Tests verify |
|---|---|---|
| Change version "1.0.0" → "2.0.0" | `src/config.ts` with `version = "1.0.0"` | `"2.0.0"` present, `"1.0.0"` absent |
| Change status "draft" → "published" | `src/config.ts` with `status = "draft"` | `"published"` present, `"draft"` absent |
| Change owner "dev" → "prod" | `src/config.ts` with `owner = "dev"` | `"prod"` present, `"dev"` absent |
| Use updated tag for each subsequent edit | (not tested structurally) | Hashline integration would verify tag chaining |
| Do not modify other lines | `APP_NAME = "chain-fixture"` | APP_NAME unchanged |

## Risks and Potential Issues

### Grader too broad
The current test.sh only checks final file content. It does NOT verify that the three edits were performed sequentially using Hashline tags. An agent could rewrite the entire file in one operation and pass. A full Hashline integration test would check `chain_edit_success_count == 3` and `hashline_rejection_count == 0` from the signal store.

### Grader too narrow
The test requires exact string matches (e.g., `version.*=.*"2.0.0"`). Formatting differences like `version = "2.0.0"` (extra space) could fail the regex. This is intentional for a deterministic eval.

### State leakage risk
If the sandbox is not cleaned between runs, a previous solution's output could persist. The harness must ensure `environment/` is freshly copied for each trial.

### Chain edit specificity
This eval tests the simplest chain (3 sequential edits on non-overlapping lines). It does not test overlapping edits, interleaved external modifications, or tag exhaustion. Broader chain scenarios are left to the case catalog.

## Draft Status

**Current status: DRAFT_BLOCKED.** It has NOT been through:
- Independent static audit (ABA optional)
- Formal verifier validation
- Agent trials
- Human review
- CommitGate

It MUST NOT be marked `HARNESS_READY` or promoted to `evals/specs/` or `evals/tasks/` until all gate requirements are met.

### Key flags for independent evaluators
1. The structural test verifies final content but not the chaining mechanism. A full Hashline integration test is needed to confirm tag progression.
2. The adversarial "reorder-edits-override" case passes structurally by rewriting the entire file — this is a known gap that only Hashline integration can close.
3. The chain length is 3 edits; longer chains and edge cases (LRU eviction mid-chain) are separate eval cases.
