# Tier B OpenRouter Sonnet 学习序列（2026-06-12）

## 口径

- 模型：OpenRouter `anthropic/claude-sonnet-4.6`，API 为
  `openai-completions`。
- 单价：input `$3/M`、output `$15/M`、cache read `$0.3/M`、
  cache write `$3.75/M`。
- 顺序：6938 → 7746 → 12907 → 14182 → 14365 → 14995。
- on：六题共享同一 `--memory-dir`；off：每题使用全新 memory dir。
- 新跑的 10 个 run 使用 commit `53adbd418ab0b6d0c62dcb4dbf128808724ca22b`。
  12907/14182 off 复用 Tier A，commit 为
  `acfafa2b023d09c4ccae931293cf6945f8e121ad`。这是预算批准的复用口径，
  也意味着本轮不是完全同 commit 的严格 A/B。
- 每臂仅 1 seed；官方 SWE-bench harness 按单实例 `--instance_ids`
  判分。以下成本为 trace 按官方单价计算的 `costUsd`。

## 逐题结果

三元组均为 `inputTokens / totalTokens / turns`。

| 题目 | off resolved | off 三元组 | off cost | off cache read | on resolved | on 三元组 | on cost | on cache read |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 6938 | 1 | 6,688 / 86,802 / 11 | $0.1186 | 73.67% | 1 | 9,220 / 123,643 / 14 | $0.1371 | 83.15% |
| 7746 | 0 | 30,048 / 275,149 / 20 | $0.3332 | 81.09% | 0 | 32,092 / 365,366 / 24 | $0.4081 | 82.68% |
| 12907 | 1 | 14,035 / 168,143 / 14 | $0.2200 | 79.43% | 1 | 22,932 / 171,386 / 13 | $0.2120 | 77.34% |
| 14182 | 1 | 39,355 / 486,207 / 34 | $0.4322 | 86.85% | 1 | 38,268 / 501,003 / 30 | $0.5950 | 86.75% |
| 14365 | 0 | 21,736 / 165,651 / 12 | $0.2152 | 75.34% | 0 | 16,094 / 186,456 / 12 | $0.2035 | 85.78% |
| 14995 | 1 | 46,280 / 769,995 / 49 | $0.5900 | 90.05% | 1 | 22,584 / 223,804 / 18 | $0.2501 | 82.85% |

## 聚合

| 指标 | off | on | on 相对 off |
|---|---:|---:|---:|
| resolved | 4/6 | 4/6 | 持平 |
| inputTokens | 158,142 | 141,190 | -10.72% |
| totalTokens | 1,951,947 | 1,571,658 | -19.48% |
| turns | 140 | 111 | -20.71% |
| trace cost | $1.9091 | $1.8058 | -5.41% |
| 聚合 cache read 占 prompt input | 85.12% | 83.81% | -1.31 pp |

10 个新 run 的 OpenRouter 账户累计从 `$4.54712565` 增至最终结算的
`$7.26958710`，实际增量 `$2.72246145`，未触发 `$9.50` 熔断。

聚合效率改善由 14995 单题主导。排除 14995 后，on 相对 off 为：
input `+6.03%`、total tokens `+14.04%`、turns `+2.20%`、trace cost
`+17.94%`。因此不能把总表的下降直接归因于跨任务学习。

## ADR-002 三项审计

### 召回审计

- 6938 是序列首题，召回 0 条，符合预期。
- 7746 起的五题均召回 4 条：通常为 3 条工具错误 knack，加上一条前题
  working-memory snapshot。说明“归档 → 索引 → 下一题注入”链路已实战跑通。
- trace 中没有模型显式引用这些经验的证据。14995 虽从 49 turns 降到 18，
  但召回内容是前题 QDP/import 错误与快照，和 mask 修复没有直接语义关系，
  故只能记为相关性，不能记为因果收益。

### 重复错误对账

- 已召回的错误类别仍会重复出现：7746 召回 import/hashline/sed 错误后仍有
  5 次工具错误；14995 召回环境错误后仍有 5 次工具错误。
- 12907、14182、14365 的 on 臂工具错误数较对应 off 略低，但样本仅 1 seed，
  且没有可观察证据证明是 recall 被实际采用。
- 矩阵原预测的 `-o filterwarnings` lesson 未被写入或命中，本轮不能验证该
  可证伪预测。

### 污染检查

- 共享目录最终写入 31 条 signals、31 条 lessons、31 条 knacks；大量内容是
  临时环境 import 失败、stale hashline 和命令语法错误。
- 后续题稳定召回这些低语义相关项，说明当前排序偏向“最近的工具失败”，
  存在明显的记忆污染和 prompt 占用风险。
- 本轮未出现 on resolved 低于 off，因此尚无质量污染实证；但 reward 也没有
  提升，不能据此扩量。

## 结论

本轮证明了学习生命周期和跨任务 recall 管道可运行，但没有证明质量收益：
两臂均为 `4/6`。效率结果对 14995 高度敏感，1 seed 下不足以构成学习曲线证据。

Tier B 当前结论为 **NO-GO 扩量**：不启动 django 序列或 seed 2。下一步应先
改进 lesson/knack 的准入与召回排序，过滤瞬时环境错误，并增加“是否被实际使用”
的可观察证据；完成后再用同一六题、同 commit 重跑。

## 产物

- 结果：`evals/results/swebench/openrouter-sonnet-tier-b-{on,off}-*/`
- on 共享记忆：
  `evals/results/swebench/openrouter-sonnet-tier-b-on-memory-20260612/`
- 官方报告：各结果目录下 `harness-report.json`
