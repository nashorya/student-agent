# SymPy 族离线重蒸 v3 · 真实轨迹对照

> 档位：一次性诊断，零模型调用、零 SWE-bench run、零 harness 调用。
> 萃取器：`a5005ec13441e4a85050f8e4bdc255a93fc8cabe`（fidelity v3）。
> 输入：v0.2 SymPy 正式族 A-L 三题的真实 `events.jsonl`，并按事件自带
> `metadata.evidenceRef` 从同 run 的 `records.json` 找回 edit/apply_patch 原始参数。
> 失败 edit 也保留；未使用 `sympy-crime-scene-v3` 重构样本或 gold patch。

- 旧产物与输入哈希：[before.json](./before.json)
- 新候选与完整字段：[after.json](./after.json)
- 可复跑入口：[redistill.ts](./redistill.ts)

## 三方对照

| 题 | 旧 `fix_summary`（v0.2 实际注入） | 新 `fix_summary`（v3，原文） | 新增字段内容 | φ_exec ψ | 成句 / 噪声 |
|---|---|---|---|---:|---|
| 1 · `sympy__sympy-20442` | `to verify the solution is exact; if not, return None so convert…`；实际见题 2、3 的 `injection.txt` | `to verify the solution is exact; if not, return None so convert…` | `verification`: `verifier reward=1`<br>`execution_evidence`: 真实 `edit util.py`，新增 `if camat*res_exponents != exprmat: return None`，完整 old/new 参数见 `after.json` | 新 `0.270`；旧 `0.270` | **否**：仍以 `…` 截断，未成句；无测试汇报，但仍是半句 |
| 2 · `sympy__sympy-24066` | `Full sympy/physics/units/tests/ suite: 70 passed, 1 xfailed (pre-existing).`；实际见题 3 的 `injection.txt` | <code>&#96;&#96;&#96;diff … if all(self.get_dimension_system().is_dimensionless(d[1]) for d in fds): … return … Dimension(1) … &#96;&#96;&#96; **Validation:** Issue reproduction now returns (E + 100, Dimension(1)) instead of raising.</code> | `verification`: `verifier reward=1; 70 passed, 1 failed/xfailed`<br>`execution_evidence`: 两次失败 edit + 两次真实 apply_patch 原文，最终加入 `is_dimensionless(d[1])` / `Dimension(1)`；完整值见 `after.json` | 新 `0.747`；旧 `0.121` | **真修法已出现，但仍不合格**：`70 passed` 已从 fix 移至 verification；fix 仍混入整段 diff 与 `Validation` 汇报，不是干净单句 |
| 3 · `sympy__sympy-24213` | 末题产物无后继题，**未实际注入**；其 post-run 旧候选为 `Files changed: sympy/physics/units/unitsystem.py (one 2-line change).` | `Files changed: sympy/physics/units/unitsystem.py (one 2-line change).` | `verification`: `verifier reward=1`<br>`execution_evidence`: 真实 `edit unitsystem.py`，把 `dim != addend_dim` 改为 `not … equivalent_dims(dim, addend_dim)`；完整 old/new 参数见 `after.json` | 新 `0.072`；旧 `0.072`（post-run 候选） | **否**：形式有句号，但只是“改了哪个文件”的元信息，不是修法；无 `70 passed`，仍有汇报式口水 |

注：表中的代码符号为便于扫读省略 Markdown 反引号；`before.json` /
`after.json` 保存逐字原文与 SHA-256，可机械复核。

## 作者决策门

| 预期 | 实际 | 结论 |
|---|---|---|
| 题 2 抽出 `is_dimensionless()` 真修法 | 是，但 fix 还粘着 patch dump 与 `Validation` | 部分通过 |
| 题 3 的测试汇报绝迹，且得到真修法句 | `70 passed` 不在 fix，但只剩 `Files changed…` 元信息；没有抽出 `equivalent_dims()` 真修法 | 不通过 |
| 两条均成句、可直接当弹药 | 否 | 不通过 |

**本次建议：弹药仍糊，不开 A-L×3 + B×3 正赛。** 回萃取器修复后再做同一离线门检，
不消耗模型配额。

## φ_exec 真实轨迹假设

新候选 ψ 为 `0.270 / 0.747 / 0.072`。题 2 显著高于 BUG-013 标定正样本
`0.169–0.385`，但题 3 仍贴地（`0.072 < 0.2`），且这个错误的
`Files changed…` 元信息仍刚好越过当前拒收阈值 `0.067`。因此不能判定尺度问题消失。

登记 finding：**`φ_exec 尺度不匹配`**。

> **状态注（fidelity v4，2026-07-23）**：上述原表述已作废，原文仅为历史
> 追溯保留。替代 finding 为「**φ_exec 相对质量非单调**」，证据与完整表述见
> [`v4-diff.md`](./v4-diff.md)。

待另开单的候选改进（本单不实施）：

1. evidence 侧改为规范化的完整 patch diff，优先保留新增/删除行，避免 raw JSON
   old/new 与失败尝试稀释分布；
2. φ_exec 改用字符级 n-gram，降低代码标识符与自然语言分词错位；
3. 在 φ_exec 前排除 `Files changed:` / `Validation:` 等元信息候选，并修复
   `verified_fix` 上游 600 字符预截断导致的 `convert…` 半句。

## 边界复核

- 未运行任何 SWE-bench 题、runner 或 harness。
- 未发起任何模型/API 请求。
- v0.2 冻结文档和结果目录只读。
- 未写 `memory/lessons.jsonl`、`memory/knacks.jsonl` 或任何主库文件。
