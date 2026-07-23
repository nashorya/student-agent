**性质：本批是冻结后的诊断性重跑，不是 v0.2 的正式结论。**

# SymPy 族 fidelity v4 · A-L ×3 + B ×3 完整诊断报告

- 日期：2026-07-23
- 状态：**COMPLETE（6/6 run；官方 harness 全部 resolved）**
- 题序：`20442 → 24066 → 24213`
- 原始现场（`.gitignore` 内）：
  `evals/results/injection-experiment-v0.2/sympy-v4-rematch-20260723T2140-cst-551ea0a8-direct/`
- A-L 仪器：`551ea0a8cabc7f170b20fd512c8f78a4cdb15055`
- B 仪器：`eb57102c190b37a3f0ec3dab60b381886db65530`

> **仪器差异注（跨批）**：本批萃取器为 fidelity v4，与 v0.2 原批
> （a5005ec 前）存在仪器差异，跨批对比按此打折。
>
> **观测层差异注（本批内）**：A-L 与 B 的 Git commit 不完全相同。B 从
> `26ccab7e` 增加了逐条 provider 响应去敏归档与 ¥15 等价成本熔断，因此
> manifest 记为 `eb57102c`；两项均为观测/停批设施，没有改 prompt、context
> 组装、provider 请求体、采样或模型收到的响应。B 的 63/63 出站请求审计与
> A-L 冻结字段一致，但严格的“同一 commit”条件并未满足，因而本批比较仍须
> 保留这一可复核折扣。

## 配置、快照与操纵复核

| 项 | 结果 |
|---|---|
| 模型 | `glm-5.2`，profile `zhipu-glm-5.2`，Coding Plan 直连 |
| 冻结采样 | `thinking=enabled`、`temperature=0`、`top_p=0.95`（不发送）、`do_sample=false`、`max_tokens=16384` |
| 出站审计 | A-L 58/58、B 63/63 请求 `compliant=true`；均为 thinking enabled / temperature 0 / do_sample false |
| 数据 commit | `69611d31007e1c6731db8bd5b5c3f2d33f5bab6e` |
| 源 Arrow / saved Arrow | 均为 `b77fa3036c06219715a35e8088fee13b0b87bc957052546c3270caf38a325627` |
| harness | 官方 `swebench 4.1.0`；Docker 29.5.3；六题次均无 harness error |
| worktree | 六题次 `initialHead == expectedBaseCommit`；三题依次为 `1abbc0ac…` / `514579c6…` / `e8c22f6e…` |
| 记忆隔离 | A-L 与 B 各自从独立空 root 开始；主库未参与 |
| B 臂定义 | 三题均走 `context_runtime`，`injectionMode=off`；管线照常蒸馏/入库，prompt 无 recall 段 |
| provider 正文归档 | B 侧 63/63 条 HTTP 200 正文已去敏落盘，52 条含 thinking；凭证模式扫描通过 |
| 熔断 | B 等价总价 ¥5.382072，未触发 ¥15 熔断 |

## A-L 注入与 citation 事实

作者已对本批 A-L 弹药作人工判卷，并确认题 2、3 的注入快照到达 prompt。
实际快照为：

| 题 | 实际注入 | `used_recall_ids` |
|---|---|---|
| 20442 | 无，符合第 1 题规则 | `[]`（预期） |
| 24066 | 题 1 lesson：`convert_to` 不满足精确转换时返回 `None`，保留原表达式 | `[]` |
| 24213 | 三条 eligible lesson：上述 `convert_to`；题 2 的 dimensionless 检查；一条 patch/tool-error 重试过程 lesson | `[]` |

此前 citation 分诊已确认：题 2、3 的规则段完整在 cache breakpoint 后，
`truncated=[]`、compaction 均为 0；两题所有 assistant 消息都没有写出
`[[used_recall:...]]`。因此原始三分仍是“② 模型未申报”，不是解析器漏采，
但“未申报”不能等同于“未使用”。

## 逐 run 结果

等价标价口径：未缓存输入 ¥8/M、缓存输入 ¥2/M、输出 ¥28/M。实际走
Coding Plan 配额，表中不是逐 run 实扣。

| 臂 | 题 | resolved | 轮次 | agent 时长 | 总 tokens | 阶梯触发 | 实际注入 | `used_recall_ids` | 等价标价 |
|---|---:|---:|---:|---:|---:|---:|---|---|---:|
| A-L | 20442 | 1 | 28 | 557.364s | 396,082 | 5 | 无 | `[]` | ¥1.196108 |
| A-L | 24066 | 1 | 19 | 1,231.874s | 369,131 | 3 | 题 1 lesson ×1 | `[]` | ¥1.329980 |
| A-L | 24213 | 1 | 11 | 117.446s | 102,728 | 0 | eligible lesson ×3 | `[]` | ¥0.330200 |
| B | 20442 | 1 | 21 | 433.983s | 249,182 | 0 | 无 | `[]`（无注入） | ¥0.822776 |
| B | 24066 | 1 | 33 | 1,497.758s | 1,401,510 | 6 | 无 | `[]`（无注入） | ¥4.249824 |
| B | 24213 | 1 | 9 | 124.525s | 92,604 | 0 | 无 | `[]`（无注入） | ¥0.309472 |

A-L 三题合计：3 resolved、58 轮、1,906.684s、867,941 tokens、8 次
阶梯、等价 ¥2.856288。B 三题合计：3 resolved、63 轮、2,056.266s、
1,743,296 tokens、6 次阶梯、等价 ¥5.382072。

## 第 2、3 题冻结主分析口径

| 指标 | 本批 A-L | 本批 B | A-L 相对 B |
|---|---:|---:|---:|
| resolved | 2/2 | 2/2 | 持平 |
| 轮次 | 30 | 42 | 少 28.571% |
| agent 时长 | 1,349.320s | 1,622.283s | 少 16.826% |
| 总 tokens | 471,859 | 1,494,114 | 少 68.419% |
| 阶梯触发 | 3 | 6 | **少 50.000%** |
| 等价标价 | ¥1.660180 | ¥4.559296 | 少 63.587% |
| 实际注入非空 | 2/2 | 0/2 | 操纵符合定义 |
| `used_recall` 非空 | 0/2 | 不适用 | A-L 未申报 |

### H1 判读

冻结条款原文：

> A-L 相比 B,resolved 多至少 1 题 **或** 升级阶梯少至少 30% → 方向支持 H1。

逐项对照：

1. resolved：`2/2 vs 2/2`，没有多至少 1 题；
2. 升级阶梯：`3 vs 6`，A-L 少 50%，达到“至少少 30%”；
3. 两个分支为“或”，第二个分支单独成立。

**H1 结论：方向支持。** 这是 n 小、每格一次轨迹下的**方向性证据，非统计
显著**；不应写成稳定因果效应。

## citation 可靠性推断

按跑前公证三分，结果明确落 **(b) 归因手段不可靠**：

- A-L 题 2、3 的合格弹药与 citation 规则均确认到达，但申报为 0/2；
- 同批 B 取得同样的 2/2 resolved，却在冻结过程指标上有 6 次阶梯；
- A-L 的 3 次阶梯比 B 少 50%，达到 H1 的 30% 参照刻度；轮次和 tokens
  也分别少 28.571% 与 68.419%；
- 因此，0 citation 与已观察到的行为差不一致，不能继续把
  `used_recall_ids` 当作唯一归因依据。

**BUG-014 升级处置**：后续实验以行为差为主、citation 为辅；v0.2 既有
Django 与 SymPy 批次中的 citation/`used_recall` 数字统一加可信度折扣。
该推断仍不单独证明 lesson 导致行为差：端到端噪声、单格 n=1 和本批内观测
commit 差异都要求保留因果折扣。

## 三方对照

以下只比较第 2、3 题聚合。

| 批次 / 条件 | resolved | 轮次 | agent 时长 | tokens | 阶梯触发 | `used_recall` 非空 | 等价标价 |
|---|---:|---:|---:|---:|---:|---:|---:|
| v0.2 原批 A-L（坏弹药） | 2/2 | 34 | 306.484s | 404,345 | 7 | 0/2（可信度折扣） | ¥1.339376 |
| 本批 A-L（fidelity v4 弹药） | 2/2 | 30 | 1,349.320s | 471,859 | 3 | 0/2（未申报） | ¥1.660180 |
| 本批 B | 2/2 | 42 | 1,622.283s | 1,494,114 | 6 | 不适用 | ¥4.559296 |

> **仪器差异注**：v0.2 原批使用 a5005ec 前萃取器，本批为 fidelity v4，
> 跨批比较按此打折。A-L 题 2 的 1,231.874s 与 B 题 2 的 1,497.758s
> 都含单次长 provider 响应；不能把时长差直接归因给 lesson。

## 异常值、蒸馏盲区与边界

- B 题 2 单题贡献 1,401,510 tokens、¥4.249824 和 6 次阶梯，是 B 聚合差
  的主要来源；每格仅一次运行，不能把这一轨迹当作稳定分布。
- A-L 题 2 同样出现 1,231.874s 长响应。因此本报告保留时长读数，但 H1
  只按冻结的 resolved/阶梯规则判读。
- B 题 3 与 A-L 题 3 一样，`resolved=true`、0 阶梯、0 `tool_error`，
  蒸馏确定性返回 `distill_null_with_harness`；符合
  `finding:distill-blind-spot` 的已登记边界。B 题 1 也同样返 null。
- B 题 2 管线照常蒸馏并准入一条 candidate，但其 `fix_summary` 为
  `## Files Changed - ...` 变更元信息；它没有被注入任何被试，且本单没有
  调门控或萃取器。该复现已追加到 BUG-013，留待独立修复单。
- B 三题均保存 `trace`、`events`、`injection`、prediction、memory
  inventory、admission、官方 harness 报告和去敏 provider 正文；归档行数
  与 provider 请求数逐题一致（21/21、33/33、9/9）。
- 没有运行 A-K/C，没有补跑 A-L，没有改冻结文档、prompt、采样、门控、
  召回排序或主库。
