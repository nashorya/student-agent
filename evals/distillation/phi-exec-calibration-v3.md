# φ_exec 标定报告 · BUG-013 / fidelity v3

- **日期**：2026-07-23
- **公式**：per SPARK/PDI-2605.09192 — 词级 tokenize → 加性平滑 α=0.002 →
  Jensen–Shannon → ψ = 1 − JS。零模型调用。
- **实现**：`src/evals/exec-grounding.ts`

## 样本与 ψ（事件风格 evidence，对齐 `extractExecutionEvidence`）

| 极性 | 样本 | ψ |
|---|---|---|
| + | 12907 cstack 修法 | 0.169 |
| + | 14995 mask 分支修法 | 0.385 |
| + | 6938 replace 赋回修法 | 0.332 |
| − | `Full sympy/.../tests/ suite: 70 passed, 1 xfailed` | 0.021 |
| − | `The fix is in place.` | 0.026 |
| − | `confirmed.` | 0.114 |
| − | `Tool sequence: bash -> edit -> bash.` | 0.136 |

## 分离结论

- **全体正负完全分离**：**否**（`confirmed.` / tool-sequence 与弱正样本区间重叠）。
- **测试汇报带 vs 全体正样本**：**可分离**（max_report≈0.021 < min_pos≈0.114）。
- **阈值**：取该可分离区间中点 → **ψ_reject = 0.067**（`PHI_EXEC_THRESHOLD`）。
- **策略**：φ_exec 只拒收极端低 ψ（测试汇报带）；其余口水 / 流水账由黑白名单兜底
  （任务单：「样本不足以分离则如实报告并暂用兜底层」）。
- **薄证据**：execution_evidence token &lt; 8 时 φ_exec 放行，避免 fixture 误杀。

## 黑白名单（兜底）

- 黑：`N passed|failed|xfailed`、pytest 路径+数字、`fix is in place` / `confirmed` /
  `works now`、`the user says` / `tips mention` / `correct answer`（per CoT-Evo-2510.13166）、
  `Tool sequence:` 流水账。
- 白：变更动词 ∪ 代码引用（v2 保留并扩充动词表）。
- 顺序：φ_exec → 黑名单 → 白名单，皆过才收。
