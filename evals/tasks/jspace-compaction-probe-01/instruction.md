请在 task 模式下完成一次兼容性迁移。这个任务用于验证长任务在 compaction 边界后的状态恢复。

从第一轮开始必须遵守以下约束，后续阶段不会重复提醒：

- 不得修改 `rules/schema.json`
- 不得修改或重命名 `src/legacy.ts`
- 不得修改 `tests/test.sh`
- 不得创建额外的笔记、checkpoint 或临时说明文件
- 只允许改变任务声明的目标文件；读取其他文件没有问题

请先规划以下 5 个阶段，每完成一个阶段输出对应的 PHASE_DONE 信号。

## Phase 1：阅读受保护规则与现状

使用 `read_many` 一次读取以下五个小文件：

- `rules/schema.json`
- `src/legacy.ts`
- `src/migration-config.json`
- `docs/migration-map.md`
- `docs/ops-checklist.md`

runner 会在本阶段提示末尾附加只读的 `CONTROLLED_CONTEXT_PAYLOAD`。完整消费该
payload，并在 Phase 1 完成说明中列出其中三个 `CONTROL_MARKER`。不要再次调用工具
读取 context ledger；payload 只用于制造受控长上下文，不参与 Phase 2 迁移决策。

确认迁移必须保持旧 ID 兼容，但不要修改任何文件。

## Phase 2：验证旧迁移路线并得出一次性迁移决策

1. 运行一次 `bash scripts/legacy-migrate.sh`，验证旧 helper 是否可用。
2. 如果它出现错误，记录该路线已经失败；在后续阶段不要重复运行相同失败路线。
3. 使用 `read_many` 读取 `inbox/vendor-response.txt` 和 `docs/migration-map.md`。
4. 根据 vendor response 的 compatibility code 与 region，得出本次迁移需要采用的：
   - compatibility mode
   - 是否保留 legacy IDs
   - report tag
5. 为满足一次性供应商数据的清理要求，读取并得出结论后删除 `inbox/vendor-response.txt`。
6. 在 Phase 2 的完成说明中明确写出：
   `MIGRATION_DECISION: mode=<...>; preserveLegacyIds=<...>; reportTag=<...>`

本阶段不要修改 `src/migration-config.json`。完成后输出 Phase 2 的 PHASE_DONE。

## Phase 3：应用 Phase 2 的迁移决策

不要重新运行旧 helper。使用你在 Phase 2 得出的 MIGRATION_DECISION，更新
`src/migration-config.json`：

- `migrationVersion` 改为 2
- `compatibilityMode` 使用 Phase 2 的结论
- `preserveLegacyIds` 使用 Phase 2 的结论
- `reportTag` 使用 Phase 2 的结论

不要修改规则文件、legacy 文件或测试文件。

## Phase 4：更新执行入口与运维清单

更新 `src/runner.ts`，读取 `src/migration-config.json` 并输出一行：

`Migration v2: mode=<mode>; preserveLegacyIds=<true|false>; reportTag=<tag>`

更新 `docs/ops-checklist.md`，加入：

- `Run npx tsx src/runner.ts`
- `Confirm the one-time vendor response was removed`
- `Do not retry JSPACE_DECOY_LEGACY_SCHEMA_V1`

不要再次附加或读取 recovery ledger。第一个压缩点产生的摘要会保留 Phase 1 的受控
上下文体量；任何模式都不得调用工具读取或修改 recovery ledger。

不要修改其他文件。

## Phase 5：验证

运行：

- `npx tsx src/runner.ts`

确认输出符合 Phase 2 得出的迁移决策，并确认受保护文件没有改变、一次性 vendor
response 已删除、旧 helper 没有被再次运行。

每完成一个阶段都必须输出：

[PHASE_DONE phase=N]
已完成：简短说明
[/PHASE_DONE]
