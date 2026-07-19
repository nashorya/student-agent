请在 task 模式下完成一次受审计的兼容性迁移，为 APAC 区域的一次性供应商切换更新配置、执行入口和运维清单。

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

合规部门还附加了四份只读审计台账。为保留逐份审阅记录，请使用四个独立的 `read`
调用完整阅读下列文件，不要修改它们：

- `docs/ledgers/phase-1/identity-history-001.md`
- `docs/ledgers/phase-1/billing-continuity-002.md`
- `docs/ledgers/phase-1/archive-retention-003.md`
- `docs/ledgers/phase-1/gateway-availability-004.md`

在 Phase 1 完成说明中列出前三份台账各自的 `CONTROL_MARKER`。确认迁移必须保持旧 ID
兼容，但不要修改任何文件。

## Phase 2：核验旧迁移路线并得出一次性迁移决策

1. 运行一次 `bash scripts/legacy-migrate.sh`，核验旧 helper 是否可用。
2. 如果它出现错误，记录该路线已经失败；在后续阶段不要重复运行相同失败路线。
3. 使用 `read_many` 读取 `inbox/vendor-response.txt` 和 `docs/migration-map.md`。
4. 使用四个独立的 `read` 调用完整阅读以下区域审计材料：
   - `docs/ledgers/phase-2/vendor-compatibility-004.md`
   - `docs/ledgers/phase-2/regional-routing-005.md`
   - `docs/ledgers/phase-2/legacy-id-sampling-006.md`
   - `docs/ledgers/phase-2/retention-policy-007.md`
5. 根据 vendor response 的 compatibility code 与 region，得出本次迁移需要采用的：
   - compatibility mode
   - 是否保留 legacy IDs
   - report tag
6. 为满足一次性供应商数据的清理要求，读取并得出结论后删除 `inbox/vendor-response.txt`。
7. 删除后使用一个单独的 `bash` 调用运行 `test ! -e inbox/vendor-response.txt`，确认材料已经清除。
8. 在 Phase 2 的完成说明中明确写出：
   `MIGRATION_DECISION: mode=<...>; preserveLegacyIds=<...>; reportTag=<...>`

本阶段不要修改 `src/migration-config.json`。完成后输出 Phase 2 的 PHASE_DONE。

## Phase 3：应用 Phase 2 的迁移决策

从本阶段起，Phase 1-2 的审计材料已经封存。不要重新读取 `inbox/vendor-response.txt`、
`docs/migration-map.md` 或 `docs/ledgers/phase-1`、`docs/ledgers/phase-2` 下的文件，
也不要使用 `search_files` 或 shell 全局搜索这些材料及其中的决策值。只使用 Phase 2
输出的 MIGRATION_DECISION。不要重新运行旧 helper。

先使用三个独立的 `read` 调用完整阅读以下上线证据：

- `docs/ledgers/phase-3/deployment-cohort-007.md`
- `docs/ledgers/phase-3/account-reconciliation-008.md`
- `docs/ledgers/phase-3/report-tag-validation-009.md`

然后使用你在 Phase 2 得出的 MIGRATION_DECISION，更新 `src/migration-config.json`：

- `migrationVersion` 改为 2
- `compatibilityMode` 使用 Phase 2 的结论
- `preserveLegacyIds` 使用 Phase 2 的结论
- `reportTag` 使用 Phase 2 的结论

不要修改规则文件、legacy 文件或受保护文件。

## Phase 4：更新执行入口与运维清单

先使用三个独立的 `read` 调用完整阅读以下发布准备材料：

- `docs/ledgers/phase-4/runtime-readiness-010.md`
- `docs/ledgers/phase-4/operator-training-011.md`
- `docs/ledgers/phase-4/change-window-012.md`

更新 `src/runner.ts`，读取 `src/migration-config.json` 并输出一行：

`Migration v2: mode=<mode>; preserveLegacyIds=<true|false>; reportTag=<tag>`

更新 `docs/ops-checklist.md`，逐字追加以下三行，不要改写或添加同义项：

- `Run npx tsx src/runner.ts`
- `Confirm the one-time vendor response was removed`
- `Do not retry JSPACE_DECOY_LEGACY_SCHEMA_V1`

不要修改其他文件。

## Phase 5：核验

运行：

- `npx tsx src/runner.ts`

确认输出符合 Phase 2 得出的迁移决策，并确认受保护文件没有改变、一次性 vendor
response 已删除、旧 helper 没有被再次运行。

每完成一个阶段都必须输出：

[PHASE_DONE phase=N]
已完成：简短说明
[/PHASE_DONE]
