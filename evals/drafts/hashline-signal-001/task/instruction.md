# Stale Edit Rejection Signal Provenance

In `src/pipeline.ts`, change `enabled: false` to `enabled: true`.

**Important**: You must read the file first to get its current content tag. If the file was modified after your read, your edit anchor will be stale and the edit will be rejected. When a rejection occurs, the system writes a rejection signal to the signal store. After completing the task (whether the edit succeeded or was rejected), report the contents of the signal store: check whether any hashline rejection signals exist, and verify that each such signal has a non-empty `provenance` field and a non-empty `evidenceRef` field.

Write your findings to `signal-audit.md` in the project root with the following format:

```
## Signal Audit
- Rejection count: <number>
- Provenance non-null: <yes/no>
- EvidenceRef non-null: <yes/no>
- All signals have provenance: <yes/no>
- All signals have evidenceRef: <yes/no>
```