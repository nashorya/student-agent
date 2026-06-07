# Review Notes — hashline-snapshot-001

## Construct

This eval measures **snapshot creation on file read**: when the agent reads a file, the SnapshotStore must create a snapshot record with a content tag, and that tag must enable subsequent tag-anchored edits. The construct is "a read operation creates a usable snapshot for future edit anchoring" (correctness property), not "read_range returns a tag" (implementation detail).

## Instruction ↔ Environment ↔ Tests Correspondence

| Instruction says | Environment provides | Tests verify |
|---|---|---|
| Read file first, get content tag | `src/store.ts` with `logLevel = "debug"` | `snapshot-report.md` has "File read" and "Content tag received" fields |
| Edit `logLevel: "debug"` → `"info"` using tag | `src/store.ts` editable | `"info"` present, `"debug"` absent |
| Write confirmation report | (instruction specifies format) | `snapshot-report.md` exists with all four required fields |
| Do not modify other lines | `STORE_NAME`, `verbose`, `MAX_CONNECTIONS`, `TIMEOUT_MS` | These fields unchanged |

## Risks and Potential Issues

### Grader too broad
The test checks that the report claims the required `yes` values, but the report is still agent-writable. A real Hashline integration test would verify that SnapshotStore actually contains a snapshot record and that the reported tag relationship is true.

### Grader too broad (fabrication)
Same as hashline-signal-001: the agent can fabricate the report without actually checking the snapshot mechanism. Only Hashline integration with a write-protected SnapshotStore API resolves this.

### Dual responsibility
The agent must both (1) edit the file correctly and (2) report on the snapshot mechanism. This tests two things at once. If the agent fails task 2, it fails the entire eval even if task 1 succeeds. This is intentional — the construct is about snapshot provenance, not just file editing.

### Minimal scope
This eval tests the most basic snapshot scenario: one read, one edit. It does not test LRU eviction, multi-file snapshots, concurrent reads, or snapshot invalidation. These are covered by `hashline-snapshot-002` and other cases in the catalog.

## Draft Status

**Current status: DRAFT_BLOCKED.** It has NOT been through:
- Independent static audit (ABA optional)
- Formal verifier validation
- Agent trials
- Human review
- CommitGate

It MUST NOT be marked `HARNESS_READY` or promoted to `evals/specs/` or `evals/tasks/` until all gate requirements are met.

### Key flags for independent evaluators
1. The structural test cannot verify that a snapshot was actually created in SnapshotStore — it only checks that the agent wrote a report claiming one was. This is the most critical gap.
2. The "known-bad" adversarial case (edit-without-read) passes structurally. Hashline integration must enforce read-before-edit at the mechanism level.
3. The eval depends on the agent having access to a mechanism to observe SnapshotStore records. If the harness does not provide this, the instruction cannot be fulfilled truthfully.
