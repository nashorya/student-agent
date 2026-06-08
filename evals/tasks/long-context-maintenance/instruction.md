请在 task 模式下完成一个较长的订阅计费维护任务。这个任务故意包含较多上下文、多个文件和固定验收输出，用来测试长任务下的上下文管理能力。

现有文件：

- `src/types.ts`：定义 Plan、Account、InvoiceLine、Invoice 类型
- `src/plans.ts`：定义 3 个套餐 starter/pro/enterprise
- `src/accounts.ts`：定义 4 个客户账号
- `src/billing.ts`：包含 `normalizeUsage`、`calculateInvoice`、`summarizeAccounts` 三个占位函数
- `src/report.ts`：包含 `renderRenewalReport` 占位函数
- `src/main.ts`：入口文件，目前只输出占位文案
- `docs/billing-rules.md`：计费规则说明
- `docs/ops-checklist.md`：运维检查清单，需要补充本次流程

请按以下 5 个阶段完成，每完成一个阶段输出 PHASE_DONE 信号。

**Phase 1：阅读规则和数据**

阅读 `docs/billing-rules.md`、`src/types.ts`、`src/plans.ts`、`src/accounts.ts`，确认套餐、客户、税率、折扣和报告格式。不要修改这些规则和数据文件。

**Phase 2：实现计费核心**

在 `src/billing.ts` 中实现：

1. `normalizeUsage(usageGb)`：负数按 0 处理，其余向上取整。
2. `calculateInvoice(account, plan)`：
   - paused 账号不收费，subtotal/tax/total 都是 0，flags 包含 `paused`
   - 基础费用为 `plan.monthlyPrice`
   - 超出 seats 的部分按每席 ¥8 计费
   - usageGb 先经过 normalizeUsage，超出 includedUsageGb 的部分按 `overageRatePerGb` 计费
   - trial 账号在税前打 5 折，增加一条负数折扣 line，flags 包含 `trial`
   - 税率：EU 20%，US 8%，APAC 10%
   - subtotal、tax、total 都保留两位小数
   - 如果有超额用量，flags 包含 `overage`
   - 如果有超额 seats，flags 包含 `seats`
3. `summarizeAccounts(accounts, plans)`：为每个账号匹配 plan 并计算 invoice；未知 plan 或 paused 账号不进入汇总。

**Phase 3：实现报告渲染**

在 `src/report.ts` 中实现 `renderRenewalReport(accounts, plans)`，报告必须包含：

```text
Renewal Report
- Acme Co: Pro - ¥159.60 (overage,seats)
- Beta Studio: Starter - ¥15.66 (trial)
- Cobalt Labs: Enterprise - ¥409.32 (overage,seats)
Grand total: ¥584.58
At-risk accounts: Acme Co, Cobalt Labs
```

注意：paused 账号 Delta Works 不应出现在报告中。
报告中的 flags 顺序必须固定为：`overage` 在 `seats` 前，`trial` 单独显示。

**Phase 4：更新入口和运维文档**

更新 `src/main.ts`，调用 `renderRenewalReport(accounts, plans)` 并输出报告。

更新 `docs/ops-checklist.md`，必须加入两条检查项：

- `Run renewal report with npx tsx src/main.ts`
- `Review overage and seats flags before sending invoices`

**Phase 5：验证**

运行 `npx tsx src/main.ts`，确认输出和 Phase 3 的固定报告一致。

请先规划阶段再执行，每完成一个阶段输出 PHASE_DONE 信号。
