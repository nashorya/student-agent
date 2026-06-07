# Empty Bash Command Rejection

The file `src/config.json` contains a configuration object. Change the value of the `"env"` key from `"staging"` to `"production"`.

During the task, the harness may present or block an empty/whitespace-only bash command. ToolGuard should block that command before any shell process is spawned. After editing, use a meaningful non-empty command if you need to verify the file.

Write `toolguard-report.md` in the project root with this exact structure:

```
## ToolGuard Report
- Empty bash block observed: yes
- Shell execution count for empty bash: 0
- Final config verified: yes
```

Be precise — only modify the `env` field. Do not create or edit reward files, grader files, or test files.
