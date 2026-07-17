# ADR-007 · J-space 压缩恢复线 NO-GO

- **日期**：2026-07-17
- **状态**：已采纳（NO-GO）

## 背景

`jspace-compaction-probe-01` 在 Pi 内置机制的真实有损路径上完成两轮正式运行。
最终决策运行中，plain 臂在每 run 两次强制压缩、prompt token 下降
44.6%–89.3% 的条件下取得 3/3 verifier 满分。按预注册 GO gate，未测出需要
External J-space 才能补偿的压缩失忆，因此本线判定 NO-GO。

## 决议

不实施 v0.4x-A 的 External J-space、Requirement Ledger、Minimal Active Projection、
compaction checkpoint 与逐轮 patch。保留现有回归探针和历史设计文档，只在重开条件
触发时重新运行探针并裁决。

## 依据

- 首次正式运行：
  `evals/results/jspace-compaction/2026-07-17T03-34-19-383Z/summary.json`
- 最终决策运行：
  `evals/results/jspace-compaction/2026-07-17T03-45-10-714Z/summary.json`
- Eval spec：`spec-augmented.json`
- Review notes：`review-notes-augmented.md`
- 可运行 fixture：`evals/tasks/jspace-compaction-probe-01/`

最终决策运行中 plain 臂 3/3 的 `verifierScore=1`、`runValidity=complete`；两次边界
的 prompt token 和消息数均有效下降，峰值保持在预注册窗口内。

## Scope 限定

GLM-5.2 + thinking、pi 0.73.1 内置压缩(keepRecentTokens=20000)、jspace-compaction-probe-01 任务族、峰值 66-76k、每 run 两次强制压缩、n=3。

本结论不外推到其他模型、Pi 后继版本、更高压缩次数或明显更大的任务规模，也不形成
current 臂整体效果主张。

## 重开条件

触发任一条件时，先重跑回归探针，再重新裁决：

1. 迁移 pi 后继版本；
2. 更换生产模型；
3. 任务需 ≥3 次压缩或上下文远超本次量级；
4. 出现关键状态不落盘的任务形态。

## 附带发现

残缺工作记忆在压缩后可能劣于无记忆。最终决策运行的 current seed 2 在 Phase 2
后读取 `.jspace-current-memory/tasks.json`；其中 todo 只含截断至 500 字符、止于
Phase 1 的 instruction，`hardConstraints` 为空。随后轨迹出现封存材料搜索、遗漏
Phase 4 逐字 checklist 和重复运行旧 helper。

该问题在决策点材料中编号为 BUG-006；因仓库已有历史 BUG-006，buglog 使用唯一 ID
BUG-011 登记并保持 OPEN。它属于现有注入层缺陷，不构成新建 Requirement Ledger 的依据。

## 对 ADR-003 的影响

1. P4(Requirement Ledger)条目由本 ADR 关闭；
2. 勘误：ADR-003 中“hardConstraints 兜底已存在”的前提经 eval 证伪（实际为空，见
   BUG-011；决策点编号 BUG-006），该前提由 bug 修复恢复成立，而非由新建 Ledger 满足；
3. P0-P3 排序不变，因本线关闭成为唯一主线，前移执行。

## 关联

- [ADR-003](ADR-003-v04x-priority-reorder.md)
- [External J-space 架构评审](external_jspace_architecture_review.md)
- [v0.4/v0.4x roadmap](../student-agent-v0.4-v0.4x-alignment-roadmap-final.md)
- [Bug 档案](../buglog.md)
