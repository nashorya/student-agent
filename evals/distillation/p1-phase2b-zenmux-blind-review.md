# P1 阶段 2b · 盲审表（ZenMux Sonnet 4.6）

- channel: ZenMux `https://zenmux.ai/api/v1` / model `anthropic/claude-sonnet-4.6`
- memory: `evals/results/swebench/openrouter-sonnet-tier-b-on-memory-p1prom-20260718-zenmux`
- main lessons（produce 时）: 13 (verified=7, candidate=6) → **审计后主库 0 / ephemeral 26**
- verified 占比 53.8%：**作废**（过程噪声误入，见 `p1-main-library-audit.json`）
- produce cost：本地 $0.74 **作废**；网关权威 **$2.41**
- 验收线: 主库 verified ≥50%；盲审 ≥3/5 可用 → **本批均未过**

| # | lesson 摘要 | 是否可用（作者 0/1） | 备注 |
|---|---|---|---|
| 1 | Treat tool error as a retry pattern: Traceback… | **0** | 过程噪声 |
| 2 | Treat tool error as a retry pattern: Hashline… | **0** | 过程噪声 |
| 3 | Treat tool error as a retry pattern: Traceback… WCS | **0** | 过程噪声 |
| 4 | Treat tool error as a retry pattern: Hashline… | **0** | 过程噪声 |
| 5 | Treat tool error as a retry pattern: Traceback… NDDataRef | **0** | 过程噪声 |

**盲审合计：0/5**。失败归因：**写入路径旁路真判据**（provisional / 假 exit-0），**非**「轨迹无料」（P0 已证有料）。knack 线不判死刑；P1 **重开验收**。

> 来源/confidence 对作者隐藏；对照见 `p1-phase2b-zenmux-blind-key.json`。

## 召回附记（非验收）

本批 usedRecallIds 均为空（n=6 如实记）。`knack_<uuid>` 主库条目来自 `KnacksManager`（`src/memory/knacks/manager.ts`）独立写入 `knacks.jsonl`，**非** lessons 门控泄漏。
