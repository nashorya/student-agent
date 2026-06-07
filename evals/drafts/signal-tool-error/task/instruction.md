# Tool Error Signal Capture

The project in `src/` has a data processing utility. Your task:

1. Read `src/process.ts` to understand the current implementation.
2. Fix the value extraction bug so missing `value` fields are handled deterministically as `0`.
3. Add a new export function `sumValues` that takes the same array type and returns the sum of all `value` fields (treating undefined as 0).
4. Deliberately run one harmless failing verification command so the tool-error path is exercised, then continue the task.
5. Write `tool-error-signal-report.md` in the project root with this exact structure:

```
## Tool Error Signal Report
- Tool error count: 1
- Provenance non-null: yes
- Main task continued after error: yes
```

The report must reflect the signal pipeline event. Do not create or edit reward files, grader files, or test files.
