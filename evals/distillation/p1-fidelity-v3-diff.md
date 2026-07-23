# 蒸馏保真度 v3 · 新旧对照（待作者确认）

- **批次**：SymPy 族凶案重建（原 `evals/results` SymPy family 档案本机缺失）
- **before**：`evals/distillation/sympy-crime-scene-v3/before-injected-fixes.json`
- **after**：`evals/distillation/sympy-crime-scene-v3/after-redistill.json`
- **主库 before 快照**：`evals/distillation/p1-main-before-fidelity-v3.json`
  （沿用 v2 supply；不覆盖主库直至作者确认）
- **依据**：per SPARK/PDI-2605.09192 · per CoT-Evo-2510.13166

## 对照

| # | instance | before fix | after fix | 备注 |
|---|---|---|---|---|
| 2 | `sympy__sympy-24066` | `Full sympy/.../tests/ suite: 70 passed, 1 xfailed` | `to call \`is_dimensionless()\` …` / 或 `Also call \`is_dimensionless()\` …` | **70 passed 绝迹**；进 `verification` |
| 1 | `sympy__sympy-20442` | `…return \`None\` so convert…`（半句） | `to return \`None\` so convert_to leaves orthogonal units unchanged…` | **成句**；截断点在 `softSummarize`（已放宽 300/800） |

## 截断排查

| 环 | 结论 |
|---|---|
| 萃取 `softSummarize` | **主因**（v2 软150/硬300 无句界时砍半句）→ v3 软300/硬800 |
| 入库 `admitDistilled` | 写入完整 `Symptom:… Fix:…` 字符串，不二次截断 fix |
| 渲染 / knack `summary` | `import-distilled-knacks` 对拼装 summary 硬截 200，**不改** `fixSummary` 字段 |

## 作者扫查

- [ ] 题 2 fix 含 `is_dimensionless` 且无 `70 passed`
- [ ] 题 1 / convert 成句无 `…`
- [ ] verification 字段承载测试汇报
- [ ] 确认后关 BUG-013
