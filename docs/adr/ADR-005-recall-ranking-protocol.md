# ADR-005 · Recall Ranking Protocol（P2）

- **日期**：2026-07-13
- **状态**：已采纳

## 背景

ADR-003 P2 要求消除 knack 召回的 recency 偏置。P1 的受控验证中，
Astropy 12907 对应的 verified knack 已存在于库中，却在通用 top-8 截断和
knack top-3 限制之间被新近但无关的条目挤出。ADR-004 已定义生命周期字段，
但运行时导入器此前没有保留这些字段，也没有专用排序协议。

## 决策

### 1. 先资格过滤，再排序

schema v1 knack 至少满足一项才可进入排序：

1. normalized repository identity 精确匹配；
2. embedding similarity ≥ 0.55；
3. embedding 不可用时 lexical similarity ≥ 0.12。

旧 schema knack 保持向后兼容，不因缺少新字段被直接丢弃。

### 2. 稳定排序 tuple

eligible knack 按以下 tuple 降序排列：

1. `reuseCount`（上限 10）；
2. verified/validated confidence；
3. repository match；
4. semantic similarity；
5. anti-repeat（`lastInjectedTask === currentTaskId` 时为 0）；
6. 通用 Recall Scoring v2 total；
7. id 字典序。

createdAt 不再给 knack 提供正向 freshness bonus。其他 memory kind 继续使用现有
通用六维评分，避免扩大冻结契约的变更面。

### 3. 相似度与降级

相似度文本为 `repo + symptom + fixSummary + summary`，query 包含 repository、
goal、current step、recent errors 和 recent signals。配置 embedding key 时优先使用
OpenAI-compatible provider；未配置或调用失败时使用 deterministic lexical overlap。
provider 失败只产生诊断，不阻断 Context Assembly。

### 4. 候选池与 top-k

MemoryStore 返回最多 64 个 bounded candidates；Router 按 kind 分组并完成 knack
专用排序后，Context Assembly 才应用既有 tier limits。standard 仍为 3 个 knack，
heavy 仍为 5 个，不以扩大 top-k 掩盖排序错误。

### 5. 注入状态与 P3 边界

真正进入 limited recall bundle 的 knack 以 `(knackId, taskId, runId)` 幂等记录：
`injectedCount += 1`、`lastInjectedTask = taskId`。在 P3 的 `used_recall_ids` citation
上线前，不执行“多次注入但 reuse 为 0”自动降级或 deprecated；当前系统还不能区分
“未使用”和“使用但未留下引用证据”。

### 6. 可观测性

ranking trace 暴露 `repoMatch`、`similarity`、`similaritySource`、`reuseCount`、
`confidence`、`antiRepeat`、`eligible` 和 `rankReason`；candidate pool 暴露 limit、
scanned、eligible knack 和 truncation 指示。

## 被否方案

- **embedding 作为唯一排序信号**：离线和 provider 故障时不可用。
- **createdAt 越新越优先**：正是 P2 要消除的偏置。
- **扩大 top-k**：增加 token 消耗且不解决相关性错误。
- **P2 自动 deprecated**：P3 citation 尚未提供真实利用证据。

## 验证

- 6938/12907 形状的 deterministic fixtures 必须进入未扩大的 standard top-3。
- 高 reuse 但 repo 与症状均不相关的条目必须资格失败。
- 同 task/run 重建 L1 不得重复增加 injection count。
- preferences、doc findings 和通用六维 RecallScore 行为保持现有测试覆盖。

## 图关系

> 机读约定见 `docs/chronicle-graph-contracts.md` / `knowledge-graph.ts` 头注释。

- **defines** → `phase:P2` · 召回排序去 recency 偏置

## 关联

- 前置：[ADR-003](ADR-003-v04x-priority-reorder.md)、[ADR-004](ADR-004-knack-schema-v1.md)
- 后续：[ADR-006](ADR-006-recall-citation-and-credit.md)（P3 recall citation 与成功归因，已采纳）
- 实现：`src/memory/recall/knack-ranking.ts`、`src/memory/embedding/`、
  `src/memory/recall/jsonl-memory-store.ts`、`src/memory/recall/recall-router.ts`
