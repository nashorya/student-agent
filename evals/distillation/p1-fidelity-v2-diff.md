# 蒸馏保真度 v2 · 新旧对照（作者五分钟扫一眼）

- **批次**：zenmux p1prom resolved 三题  
- **before**：`evals/distillation/p1-e-main-lessons.before-fidelity-v2.jsonl`  
- **after**：`evals/distillation/p1-fidelity-v2-supply-report.json`  
- harness reward **沿用**（未重跑）

| # | instance | before symptom | after symptom | after fix（摘要） | 检查 |
|---|---|---|---|---|---|
| 1 | `astropy__astropy-6938` | `confirmed.` | **Possible bug in io.fits related to D exponents** | to assign the result of `replace` back to `output_field`:The fix is in place. | ✅ confirmed gone；✅ 成句 |
| 2 | `astropy__astropy-12907` | `In `_cstack`, when `right` is an ndarray (i.e., already a computed coo` | **Modeling's `separability_matrix` does not compute separability correctly for nested C** | The fix copies the actual computed matrix `right` into the correct position, preserving th… | ✅ confirmed gone；✅ 成句 |
| 3 | `astropy__astropy-14995` | `In the `_arithmetic_mask` method (line 525-527), when both operands ar` | **In v5.3, NDDataRef mask propagation fails when one of the operand does not have a mas** | **Fix:** Added an `elif operand.mask is None` branch that returns `deepcopy(self.mask)`, c… | ✅ confirmed gone；✅ 成句 |

## 验收

- [x] #1 `"confirmed."` 消失 → issue 标题 **Possible bug in io.fits related to D exponents**
- [x] #2/#3 fix 句号收尾
- [ ] 作者确认（非正式盲审，五分钟）

## 规则

1. symptom：instruction 表象 → 实质工具报错首行（跳过 Hashline/Import 噪声）→ agent 叙述；拒口水话  
2. fix：`softSummarize` 软 150 / 硬 300，句界取整  
