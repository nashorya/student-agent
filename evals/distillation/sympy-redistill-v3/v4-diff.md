# SymPy 族离线重蒸 v4 · 四方对照与停止规则取证

> 档位：一次性离线诊断；零模型调用、零 SWE-bench run、零 harness。
> 萃取器：`87f6a2170352094b090f8b16432abb409014d5d6`。
> 输入：v0.2 SymPy 正式族 A-L 三题真实 `events.jsonl`，并按
> `metadata.evidenceRef` 从同 run 的 `records.json` 保真补回 edit/apply_patch
> 参数；失败 edit 保留。未使用重构样本。

- 跑前公证：[v4-stop-rule.md](./v4-stop-rule.md)
- v3 输入快照：[before.json](./before.json)
- v3 重蒸：[after.json](./after.json)
- v4 输入复核：[v4-before.json](./v4-before.json)
- v4 重蒸完整字段：[v4-after.json](./v4-after.json)
- 可复跑入口：[redistill.ts](./redistill.ts)

## A · 题 1 截断排查结论

| 环节 | 结论 |
|---|---|
| `extractFixSummary` 上游 | **实际截断点**。`distillRunEvents` 先用 `summarizeText(finalSummary, 600)` 组装 `verifiedFix`；真实 20442 的第一处 `The fix is…` 横跨该边界，于 600 字符处被改写为 `convert…`。 |
| `extractFixSummary` | marker 优先从已经截断的 `verifiedFix` 取候选；虽然函数另收到了完整 `finalSummary`，marker 路径没有读取它，故先接受残句。v4 改为 marker 从完整 `finalSummary` 读取。 |
| `softSummarize` | 不是本次真实截断点。它收到的 marker 候选已经带 `…`，无法恢复被上游丢弃的后半句；v3 的软 300 / 硬 800 因此没有机会生效。 |
| 入库 / 渲染 | 无二次截断。`admission.json` 已存残句，后继题 `injection.txt` 逐字渲染同一残句。 |
| v3 重构样本为何通过 | 重构样本直接给出短而完整的 fix，未跨过上游 600 字符边界；它只覆盖 `softSummarize`，没有覆盖真实的 `verifiedFix` marker 路径。 |

回归改用与真实 20442 相同的长前缀路径，要求候选以句号收尾、包含完整
`` `convert_to` returns the original expression unchanged `` 且不得出现 `…`。

## 四方对照

| 题 | v0.2 实际注入候选 | v3 重蒸 | v4 重蒸 | v4 新字段（摘要） | φ_exec ψ（旧 / v3 / v4） | v4 合格与类型判定 |
|---|---|---|---|---|---:|---|
| 1 · `sympy__sympy-20442` | `to verify the solution is exact; if not, return None so convert…`；该候选实际进入题 2、3 | 同左，仍截断 | `to verify the solution is exact; if not, return None so convert_to returns the original expression unchanged.` | `verification`：reward=1、原式保持及 63 tests；`execution_evidence`：`util.py` 增加 `camat*res_exponents != exprmat → return None` | `0.270 / 0.270 / 0.303` | **合格**：完整成句、真修法、fix 无测试汇报/口水/元信息。无残余失真，已知四型/第五型判定不适用。 |
| 2 · `sympy__sympy-24066` | `Full sympy/physics/units/tests/ suite: 70 passed…`；实际进入题 3 | 整段 diff + `is_dimensionless()` + `Validation` | `Added a dimensionless check in the Function branch: when all argument dimensions are dimensionless, return Dimension(1).` | `verification`：reward=1、70 passed 及 issue reproduction；`execution_evidence`：失败 edit、最终 apply_patch 与 diff，均不再进入 fix | `0.121 / 0.747 / 0.193` | **合格**：完整成句、抽出 `is_dimensionless()` 真修法。无残余失真，已知四型/第五型判定不适用。 |
| 3 · `sympy__sympy-24213` | 末题无后继题，未实际注入；post-run 候选为 `Files changed…` | `Files changed…` 变更元信息 | `Replaced the strict inequality check with self.get_dimension_system().equivalent_dims(dim, addend_dim)…` | `verification`：reward=1、等价维度复现、异维仍报错及 71 tests；`execution_evidence`：`dim != addend_dim` 改为 `not … equivalent_dims(...)` | `0.072 / 0.072 / 0.160` | **合格**：完整成句、抽出 `equivalent_dims()` 真修法。无残余失真，已知四型/第五型判定不适用。 |

表内为便于阅读省略部分 Markdown 反引号和长证据；逐字候选、字段全文及未四舍五入
ψ 均在 `v4-after.json`。阈值仍为 `0.067`，本单没有调常量，故没有伪造标定重跑。

## B / C · 边界与分流

- 新增变更元信息黑名单：`Files changed`、`N file(s) changed`、
  `insertions/deletions`、`diff --git`、`@@ … @@` 与 patch 头。
- fix 右边界在 diff/patch/代码块、Validation/Verification/Testing 小节及行首测试
  汇报前截断；Markdown 列表符从候选句首移除。
- 被截出的 diff 保留在 `execution_evidence`；Validation/Verification/Testing
  小节保留在 `verification`。这些审计字段不进入 fix 注入文本。

## φ_exec finding（v4 改写）

> **φ\_exec 相对质量非单调**:实测 ψ 与候选质量不单调——冗余抄录 patch 的
> 混杂候选 ψ=0.747(质量差),真修法 0.169–0.385(质量好),元信息 0.072、
> 测试汇报 0.021(质量差)。故 φ_exec **只可用作下限闸(极低即拒)**,
> 不可用作「越高越好」的排序信号;高分需配合紧凑度/上界约束共同判定。
> 佐证:SPARK-2605.09192 采用三分量相减(φ_exec − φ_plan − φ_oss)而非
> 单看 φ_exec,与本观测一致。

原 finding「φ_exec 尺度不匹配」自本报告起**作废**；原文在 v3 报告和 BUG-013
状态注中保留，仅供历史追溯。

## 确定性与只读证明

- 对同一真实归档连续重蒸两次，stdout、`v4-before.json`、`v4-after.json`
  均逐字节一致。
- `v4-before.json` SHA-256：
  `908bec231019ff237efc2e8b789972eb65016bf752fe36831677b9f40eca1384`。
- `v4-after.json` SHA-256：
  `2e32fc50dbe8acec045e5b238fbff09072796dfcb3edd1383a051b9797564b68`。
- v3 `before.json` 与 v4 `v4-before.json` 内三题五类源文件的逐文件
  `source_sha256` 对象完全相同；正式结果目录只读且未被 Git 纳入。

## 停止规则类型判定与作者栏

三题的 v4 候选经机械逐项检查均未留下失真，因此没有“仍不合格”的残余项，
不进入已知四型或第五型分支。此处只记录事实，**不代作者作最终处置**。

- 作者最终处置：**待作者填写**
- 是否允许开 6-run 正赛：**未由 agent 决定，且本单未开跑**

## 边界复核

- 未运行模型、SWE-bench runner 或 harness。
- 未修改门控阈值、召回排序、被试 prompt、v0.2 冻结档案或正式结果目录。
- 未写 `memory/lessons.jsonl`、`memory/knacks.jsonl` 或任何主库。
