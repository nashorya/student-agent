# Stale File Edit Recovery

In `src/app.ts`, change the line `status: draft` to `status: reviewed`.

**Important**: You must read the file first to get its current content tag before editing. If the file was modified after your read, your edit anchor will be stale and the edit will be rejected. If that happens, read the file again and retry with the updated tag.

After the edit succeeds, write `hashline-report.md` in the project root with these fields:

- Stale rejection count
- Signal store event count
- Re-read after rejection
- Retry edit succeeded

Do not modify any other lines in the source file.
