# ADR-003 · v0.4x 优先级重排（基于 Tier B 数据）

- **日期**：2026-06-13
- **状态**：已采纳

## 背景

Tier B pilot（2026-06-12，OpenRouter Sonnet 4.6，astropy 6 题，1 seed）给出了首条
受控数据。在此之前，v0.4x 的组件优先级来自直觉；现在用数据重排，并把若干方向
显式 tombstone。

核心发现（详见 [benchmark-report-2026-06.md](../benchmark-report-2026-06.md) §5）：

1. **归档→召回→注入链路已跑通**（第 2 题起稳定召回 4 条）——管道本身不是瓶颈。
2. **零条 lesson 是"验证过的解法"**——31 条全是过程错误，无法产生质量收益。
3. **效率改善由单题离群值主导**——排除后 on 臂成本反升 14~18%。
4. **NO-GO 扩量**——病灶在写入层，扩样本前必须先修写入。

## 决策：v0.4x 组件优先级

### P0 · 离线蒸馏化验（零成本验证前提）

**做什么**：写脚本读 Tier B on 臂已有的 `events.jsonl`，从轨迹抽
"错误 → 后来哪步消除了它"的因果对，格式化为候选 knack，人工判质量。

**为什么 P0**：skill/knack 路线的全部投入建立在一个前提上——
"轨迹里存在可蒸馏的、被验证过的解法"。这是事实问题，不是观点问题。
化验结果好则前提成立，可放心建蒸馏管道；化验结果差则问题在更上游，
避免照着论文建一座空工厂。成本约等于零（读硬盘，不启动 agent）。

**验收**：产出 ≥3 条格式合法的候选 knack，人工评定至少 1 条"若注入第 4 题
能少走弯路"——则继续 P1；否则重新定位病灶。

**接口（tentative knack schema）**：
```jsonc
{
  "id": "knack-astropy-pytest-filterwarnings",
  "repo": "astropy",
  "symptom": "pytest 因 warning 配置报错（W::DeprecationWarning）",
  "verified_fix": "pytest -o 'filterwarnings=ignore::DeprecationWarning'",
  "evidence_task": "astropy-14182",          // 哪道题验证过
  "evidence_turn": 7,                         // 第几轮工具调用
  "compression_level": "knack",              // lesson / knack / rule
  "confidence": "verified"                   // verified / candidate
}
```

### P1 · Lesson 准入门控（batch distillation 管道）

**做什么**：在 lesson 写入时增加准入条件——lesson 必须包含
"验证过的解法"（tool call 取证 + exit 0）才能入库；否则降级为
ephemeral note，不归档、不跨任务传播。

旧行为（已 tombstone，见下）：把过程错误（"import 失败过"）当 lesson 写入。

实现路径：`LessonWriter` 在归档前做 causal pair 检查；
无法配对的记录标 `quality: low`，写入 `ephemeral/` 而非 `lessons/`。

**验收**：Tier B on 臂重跑，lesson 库里"verified" 占比 ≥ 50%；
质量分（人工盲审 5 条）≥ 3/5 可用。

### P2 · 召回排序去 recency 偏置

**状态**：已实现，正式协议见 [ADR-005](ADR-005-recall-ranking-protocol.md)。

**做什么**：当前召回按时间序取最近 N 条；改为按相关性（仓库 + 症状 embedding
相似度）排序，recency 降权为 tiebreaker。

**为什么 P2 不是 P1**：P1 解决"写入的都是垃圾"，P2 解决"好东西被旧垃圾
压着召不出来"——必须先有质量过关的 lesson 才值得调召回排序。

### P3 · 利用可观测（recall citation）

**做什么**：agent 在引用 lesson/knack 时，在 trace 里留 citation 标记
（`used_recall_ids: ["knack-xxx"]`）；harness 统计"召回但未引用"
vs "召回且引用"，作为下一轮 eval 的二级指标。

**为什么 P3**：Tier B 的核心审计盲点是"无模型实际利用的证据"；
没有 citation 就永远无法区分"有效利用"和"注入了但忽略了"。

### P4 · Requirement Ledger 完整版

延续现有 hardConstraints 机制，结构化为 Ledger：
每条约束有 ID、来源、验证方式、当前状态（open / satisfied / waived）。
完工后可替换掉 completion self-check 里的自由文本约束列举。

*优先级低于 P1-P3，因为 hardConstraints 已有应急兜底，不阻塞质量收益路径。*

### P5 · "较真税"治理（thoroughness budget）

overfull-hbox 案例表明穷举自查成本可达 600k-1.2M total。
需要机制让 agent 感知当前任务的"彻底性预算"，高精度任务开满、
日常任务收缩。实现方案待 P1-P3 稳定后设计。

---

## Tombstone（被否方向，勿重提）

| 方向 | 否决原因 |
|---|---|
| ⏸ 直接扩 lesson 量（更多 seed / 更多题）| 病灶在写入质量，扩量只放大噪声 |
| ⏸ 调优召回 top-k（从 4 → 8）| 同上，垃圾召更多仍是垃圾 |
| ⏸ 自建埋坑任务序列 | 设计成本高，说服力弱（见 ADR-002） |
| ⏸ self-running Claude Code 对比 | off-label，成本高，已转引公开数据（见 ADR-001）|

---

## 关联

- 数据来源：[ADR-002](ADR-002-learning-eval-protocol.md)，[benchmark-report-2026-06.md](../benchmark-report-2026-06.md)
- 触发此 ADR 的 bug：BUG-001（context runtime 未接入）、BUG-004（约束遵循）
- 下一个 ADR：ADR-004（knack schema 定稿，待离线化验结果后写）
