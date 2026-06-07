# Snapshot Store: Read-then-Edit Integrity

In `src/store.ts`, change the value of `logLevel` from `"debug"` to `"info"`.

**Important**: You must read the file first to obtain its content tag before editing. The content tag you receive from reading the file is the snapshot reference you must use when editing. If the file changes between your read and your edit, the tag will be stale and the edit will be rejected — in that case, re-read the file and retry.

After completing the edit, write a brief confirmation to `snapshot-report.md` in the project root:

```
## Snapshot Report
- File read: yes/no
- Content tag received: yes/no
- Edit succeeded: yes/no
- Tag used for edit matched read tag: yes/no
```

Do not modify any other lines in the file.