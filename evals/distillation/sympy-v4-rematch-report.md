**性质：本批是冻结后的诊断性重跑，不是 v0.2 的正式结论。**

# SymPy 族 fidelity v4 弹药正赛 · A-L 中期停批报告

- 日期：2026-07-23
- 状态：**STOPPED AT A-L CHECKPOINT**
- 计划：A-L ×3 + 同批 B ×3
- 实际：A-L ×3；B ×0
- 停批依据：A-L 的 `used_recall_ids` 全空，且题 3 resolved 后蒸馏为空；
  触发任务单“中期检查不通过则立即停、不烧 B 臂配额”。
- 仪器：`codex/distillation-fidelity-v4`
  @ `551ea0a8cabc7f170b20fd512c8f78a4cdb15055`
- 忽略目录中的原始现场：
  `evals/results/injection-experiment-v0.2/sympy-v4-rematch-20260723T2140-cst-551ea0a8-direct/`

> **仪器差异注**：本批萃取器为 fidelity v4，与 v0.2 原批（a5005ec 前）
> 存在仪器差异，跨批对比按此打折。

## 点火与快照复核

| 项 | 结果 |
|---|---|
| 题序 | `20442 → 24066 → 24213` |
| 模型 | `glm-5.2`，profile `zhipu-glm-5.2`，coding plan 直连 |
| 冻结采样 | `thinking=enabled`、`temperature=0`、`top_p=0.95`（不发送）、`do_sample=false`、`max_tokens=16384` |
| 出站审计 | 58/58 请求 `compliant=true`，均为 thinking enabled / temperature 0 / do_sample false |
| 数据 commit | `69611d31007e1c6731db8bd5b5c3f2d33f5bab6e` |
| 源 Arrow / saved Arrow | 均为 `b77fa3036c06219715a35e8088fee13b0b87bc957052546c3270caf38a325627` |
| harness | 官方 `swebench 4.1.0`；Docker 29.5.3 |
| worktree | 三题 `initialHead == expectedBaseCommit`；分别为 `1abbc0ac…` / `514579c6…` / `e8c22f6e…` |
| 记忆隔离 | A-L 从空 root 开始；题 1 before inventory 全空；主库未参与 |

## 中期闸门

| 题 | 注入核对 | 本批 v4 蒸馏 | `used_recall_ids` | 判定 |
|---|---|---|---|---|
| 1 · `sympy__sympy-20442` | 无 recall，符合第 1 题规则 | `If it does not, return None, which makes convert_to leave the original expression unchanged…`，`quality=high` | `[]`（无注入，预期） | 通过 |
| 2 · `sympy__sympy-24066` | injection 逐字包含题 1 admission 中的 lesson | `Added a dimensionless check mirroring get_dimensional_expr's all(i == 1 for i in args) logic.`；官方 resolved，但不是离线人工判卷的 `is_dimensionless()/Dimension(1)` 原文 | `[]` | **不通过**：注入发生但未申报使用，弹药内容偏离预期原文 |
| 3 · `sympy__sympy-24213` | injection 逐字包含此前三个 eligible 主 lesson，其中包括题 2 真修法及一条 `Treat tool error…` 过程 lesson | 空；`skipped_reason=distill_null_with_harness` | `[]` | **不通过**：注入发生但未申报使用；第三条 `equivalent_dims()` 弹药未产出 |

题 3 的直接原因不是 harness：该题 `resolved=true`，但轨迹没有任何
`tool_error`，现行 `findCausalPair` 无法为一杆进洞的成功轨迹构造
error→operation→verification 因果对，因而确定性返回 null。本批没有补种、
重跑、synthetic fallback 或现场修改门控。

## 逐 run 结果

等价标价使用现行公开口径：未缓存输入 ¥8/M、缓存输入 ¥2/M、输出 ¥28/M；
实际走 Coding Plan 配额，表中不是逐 run 实扣。

| 臂 | 题 | resolved | 轮次 | agent 时长 | 总 tokens | 阶梯触发 | 实际注入 | `used_recall_ids` | 等价标价 |
|---|---:|---:|---:|---:|---:|---:|---|---|---:|
| A-L | 20442 | 1 | 28 | 557.364s | 396,082 | 5 | 无 | `[]` | ¥1.196108 |
| A-L | 24066 | 1 | 19 | 1,231.874s | 369,131 | 3 | 题 1 lesson ×1 | `[]` | ¥1.329980 |
| A-L | 24213 | 1 | 11 | 117.446s | 102,728 | 0 | eligible lesson ×3 | `[]` | ¥0.330200 |
| B | 20442 | — | — | — | — | — | **未运行：中期闸门阻断** | — | ¥0 |
| B | 24066 | — | — | — | — | — | **未运行：中期闸门阻断** | — | ¥0 |
| B | 24213 | — | — | — | — | — | **未运行：中期闸门阻断** | — | ¥0 |

A-L 三题合计：3 resolved、58 轮、1,906.684s agent 时长、867,941
tokens、8 次阶梯触发、等价 ¥2.856288。现金增量为 ¥0，且等价值未触发
¥15 熔断线。

## 第 2、3 题冻结主分析口径

| 指标 | 本批 A-L | 本批 B | 是否可比较 |
|---|---:|---:|---|
| resolved | 2/2 | 未运行 | 否 |
| 轮次 | 30 | 未运行 | 否 |
| agent 时长 | 1,349.320s | 未运行 | 否 |
| 总 tokens | 471,859 | 未运行 | 否 |
| 阶梯触发 | 3 | 未运行 | 否 |
| 等价标价 | ¥1.660180 | 未运行 | 否 |
| 实际注入非空 | 2/2 | — | 仅操纵审计 |
| `used_recall` 非空 | 0/2 | — | **中期闸门失败** |

## H1 判读

冻结条款原文：

> A-L 相比 B,resolved 多至少 1 题 **或** 升级阶梯少至少 30% → 方向支持 H1。

逐项对照：

1. resolved 差：B 未运行，无法计算；
2. 升级阶梯差：B 未运行，无法计算 30% 阈值；
3. 因操纵闸门在 A-L 后合法熔断，禁止用 v0.2 旧 B 替代同批 B。

**H1 结论：不可判读**，不是“方向支持”，也不是“不支持”。若未来作者另开
新批并取得同仪器 B，结论仍只能标“方向性证据，非统计显著”。

## 三方对照

以下仅列第 2、3 题聚合，并始终附带仪器差异注。

| 批次 / 条件 | resolved | 轮次 | agent 时长 | tokens | 阶梯触发 | `used_recall` 非空 | 等价标价 |
|---|---:|---:|---:|---:|---:|---:|---:|
| v0.2 原批 A-L（坏弹药） | 2/2 | 34 | 306.484s | 404,345 | 7 | 0/2 | ¥1.339376 |
| 本批 A-L（fidelity v4） | 2/2 | 30 | 1,349.320s | 471,859 | 3 | 0/2 | ¥1.660180 |
| 本批 B | 未运行 | — | — | — | — | — | ¥0 |

> **仪器差异注**：本批萃取器为 fidelity v4，与 v0.2 原批（a5005ec 前）
> 存在仪器差异，跨批对比按此打折。尤其本批题 2 出现一次很长但最终成功的
> provider 响应，agent 时长不能直接归因给 lesson。

## 注入 / 申报 / 行为三层

| 层 | 结果 | 可作何种归因 |
|---|---|---|
| 注入 | 第 2、3 题均有真实 lesson 注入 | 操纵已到达 prompt |
| 申报 | 0/2；`used_recall_ids=[]` | 无模型自报使用证据 |
| 行为差 | 题 3 仅 11 轮且 0 阶梯，但同批 B 被闸门阻断 | 不能识别为 lesson 效果 |

因此不能把“注入存在”直接写成“lesson 被使用”，也不能把题 3 的低轮次写成
因果改善。

## 审计与边界

- A-L 三个 run 各自具备：`trace.json`、`events.jsonl`、`injection.txt`、
  `predictions.jsonl`、`records.json`、`admission.json`、
  `memory-inventory.json`、官方 harness summary 与 instance report。
- B 目录没有任何 run 文件；未复用 v0.2 原批 B。
- 未运行 A-K 或 C，未改冻结文档、门控、排序、主库、prompt 或采样。
- 未写入 v0.2 原结果目录；本批目录含 `-v4-` 标识。
- 本报告记录的是中期停批事实，**不满足“6 run 完成”的原完成定义**；
  这是硬停止规则的预期结果，不得用补跑掩盖。
