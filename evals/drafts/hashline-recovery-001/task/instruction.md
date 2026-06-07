# Chain Edit: Sequential Tag-Anchored Edits

In `src/config.ts`, make the following three changes in order:

1. Change `version: "1.0.0"` to `version: "2.0.0"`
2. Change `status: "draft"` to `status: "published"`
3. Change `owner: "dev"` to `owner: "prod"`

**Important**: After each successful edit, you must use the updated content tag (hash) for the next edit. Do not reuse the initial read tag for subsequent edits. If the file changes externally between your operations, re-read it before editing.

Do not modify any other lines in the file.