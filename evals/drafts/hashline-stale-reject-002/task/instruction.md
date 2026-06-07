# Batch Stale Edit Recovery Across Multiple Files

You need to update configuration values in three files:

1. In `src/db.ts`, change `port: 3000` to `port: 5432`
2. In `src/cache.ts`, change `ttl: 60` to `ttl: 300`
3. In `src/auth.ts`, change `retries: 3` to `retries: 5`

**Important**: You must read each file first to get its current content tag before editing. If a file was modified after your read, your edit anchor will be stale and the edit will be rejected. If that happens, re-read the file and retry with the updated tag.

After the retry edits succeed, write `hashline-batch-report.md` in the project root with these fields:

- Stale rejection count
- Signal store event count
- Re-read all files after rejection
- Retry edits succeeded

Do not modify any other lines in any source file.
