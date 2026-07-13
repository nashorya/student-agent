# ADR-006 · Recall Citation 与成功归因

- **日期**：2026-07-13
- **状态**：已采纳

## 背景

ADR-003 P3 要求区分“召回内容已注入”和“模型实际采用了召回内容”。P2 已能记录
injection 和 ranking，但注入本身不能证明利用，更不能证明利用导致任务成功。

## 决策

### 四层术语

1. **injected**：knack 进入 limited recall bundle 并出现在 eval prompt。
2. **cited / used**：assistant 发出 citation，且 ID 属于该 message 对应 prompt 的 allowlist。
3. **verified use**：valid citation 对应的任务通过外部 verifier/harness。
4. **credited reuse**：verified use 通过幂等 ledger 更新 `reuseCount`。

报告不得把 citation 写成不可伪造的因果证明；它是模型自报告的利用证据。

### Citation 协议

仅在 eval mode 中，knack 以 `[recall:<id>] <summary>` 渲染。当且仅当该 knack
materially informs 当前动作时，assistant 发出：

```text
[[used_recall:<id>]]
```

collector 按 assistant message 解析 marker，并与同 ordinal context trace 中实际注入的
knack ID 对账。未知 ID、非 knack ID、无匹配 trace 的 citation 均标 invalid，永不 credit。
marker 从最终用户输出中清除。

### Audit artifact

run-level `recallAudit` 包含：

- `injected_recall_ids`
- `cited_recall_ids`
- `used_recall_ids`
- `invalid_recall_ids`
- message-level `citation_events`
- `utilization_rate`

Run Archive 增加 `recall_citation` event；outcome 独立记录
`verificationStatus: pending | passed | failed`，不得把 agent process success 当作 correctness。

### 成功归因

只有以下交集可获得 reuse credit：

```text
valid citation ∩ injected knack ∩ verifier passed
```

credit key 为 `(knackId, taskId, runId, verificationRef)`。重复 reconciliation 不得重复增加
`reuseCount`。普通 eval 在内联 verifier 后 reconciliation；SWE-bench 在官方
`harness-report.json.resolved_ids` 返回后运行 `eval:recall:reconcile`。

### 生命周期边界

P3 首版仍不启用 ADR-004 的自动 candidate/deprecated 阈值。citation 是自报告信号，需要
至少一轮真实校准后再决定“多次注入但未 citation”是否足以降级。

## 被否方案

- **注入即视为使用**：无法区分 ignored recall。
- **agent 正常结束即视为成功**：SWE 官方 harness 尚未运行，存在错误 credit。
- **对 final output 做语义猜测**：不可复现且容易误判。
- **首版新增 recall-used tool**：增加 tool schema 和接线面；文本 marker 已足够完成审计化验。
- **P3 立即自动 deprecated**：缺少真实利用率校准数据。

## 验证

- 6938/12907 shaped fixtures 覆盖 prompt ID、marker、allowlist、pending、resolved 和幂等 credit。
- invalid citation 不进入 `used_recall_ids`。
- marker 不出现在 final output。
- standard/heavy top-k 保持 3/5。

## 关联

- 前置：[ADR-003](ADR-003-v04x-priority-reorder.md)、[ADR-005](ADR-005-recall-ranking-protocol.md)
- 实现：`src/memory/recall/citation.ts`、`src/memory/knacks/recall-credit-manager.ts`、
  `src/evals/recall-credit-reconciler.ts`
- 后续：基于真实 citation 数据校准 ADR-004 生命周期阈值
