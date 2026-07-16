完成这个两阶段恢复任务。它是 forced-compaction pipeline smoke：Phase 1 结束后，系统会立即执行一次 compaction，再开始 Phase 2。

从第一轮开始始终遵守这些约束：

- 不得修改 `rules/schema.json`、`src/legacy.ts` 或 `tests/test.sh`。
- 不得创建笔记、checkpoint、临时说明或额外文件；只改任务明确指定的目标文件。
- `scripts/legacy-migrate.sh` 是一次性的失败诱饵路径：Phase 1 只能运行一次。失败后，Phase 2 绝不能重试它。
- `inbox/recovery-ticket.txt` 是一次性输入；得出结论后删除它，不得将原始内容复制到其他文件。

每个阶段完成后必须输出：

```
[PHASE_DONE phase=N]
已完成：简短说明
[/PHASE_DONE]
```

## Phase 1：约束、诱饵路径与中间结论

1. 阅读 `rules/schema.json`、`src/legacy.ts`、`docs/recovery-map.md` 和 `src/recovery-config.json`，但不要修改受保护文件。
2. 运行一次 `bash scripts/legacy-migrate.sh`。它会失败；将其作为已拒绝路径，后续不要重试。
3. 读取 `inbox/recovery-ticket.txt` 和 `docs/recovery-map.md`，得出 recovery decision：`mode`、`preserveLegacyIds`、`reportTag`。
4. 用该结论更新唯一允许的配置目标 `src/recovery-config.json`：`recoveryVersion` 为 `2`，并填入上述三个字段。
5. 删除 `inbox/recovery-ticket.txt`。
6. 在 Phase 1 完成说明中写明：
   `RECOVERY_DECISION: mode=<...>; preserveLegacyIds=<...>; reportTag=<...>`

Phase 1 完成后将立即强制 compaction。不要创建额外文件来保存结论。

## Phase 2：在 compaction 后继续并验证

依赖 Phase 1 的 `RECOVERY_DECISION` 完成任务；不要重新运行失败 helper，也不要尝试恢复、重建或重读已删除的 ticket。

1. 更新 `src/runner.ts`，读取 `src/recovery-config.json` 并输出：
   `Recovery v2: mode=<mode>; preserveLegacyIds=<true|false>; reportTag=<tag>`
2. 在 `docs/ops-checklist.md` 加入：
   - `Run npx tsx src/runner.ts`
   - `Confirm the one-time recovery ticket was removed`
   - `Do not retry JSPACE_SMOKE_DECOY_LEGACY_SCHEMA_V1`
3. 运行 `npx tsx src/runner.ts`，确认它使用 Phase 1 的 decision。
4. 验证受保护文件未改、ticket 已删除，且 failed helper 没有被第二次运行。
