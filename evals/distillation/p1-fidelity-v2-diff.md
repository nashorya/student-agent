# 蒸馏保真度 v2 · 新旧对照（作者确认）

- **批次**：zenmux p1prom resolved 三题  
- **before**：`evals/distillation/p1-e-main-lessons.before-fidelity-v2.jsonl`  
- **after**：`evals/distillation/p1-fidelity-v2-supply-report.json`  
- harness reward **沿用**（未重跑）  
- **作者确认**：**打勾**（2026-07-19）→ **v2 关单**

## 入档结论

**3/3 症状换源成功、口水话消失；#1 fix 残留 v1 时代废话尾缀（v3 候选，不开单）；harness reward 沿用，主库 3 verified 焕新。**

| # | instance | before symptom | after symptom（全文） | 备注 |
|---|---|---|---|---|
| 1 | `astropy__astropy-6938` | `confirmed.` | **Possible bug in io.fits related to D exponents** | symptom 修好 |
| 2 | `astropy__astropy-12907` | agent 独白 `_cstack`… | **Modeling's `separability_matrix` does not compute separability correctly for nested CompoundModels** | 全文 98 字，未砍半 |
| 3 | `astropy__astropy-14995` | agent `_arithmetic_mask`… | **In v5.3, NDDataRef mask propagation fails when one of the operand does not have a mask** | issue 标题换源 |

### fix 侧

| # | after fix | 备注 |
|---|---|---|
| 1 | `to assign the result of \`replace\` back to \`output_field\`:The fix is in place.` | **修法半句为真**；尾巴 **「The fix is in place.」** 为 v1 时代废话尾缀，冒号接得别扭。v2 只改 symptom 抓取源 + 截断，**未做 fix 侧口水过滤** → **v3 候选，暂不开单**；检索/使用暂不受伤，注入实验若异常再收拾 |
| 2 | `The fix copies the actual computed matrix \`right\` into the correct position, preserving the separability structure of nested CompoundModels.` | 成句 ✅ |
| 3 | `**Fix:** Added an \`elif operand.mask is None\` branch… mask is returned.` | 成句 ✅（硬限内句界） |

### 观察：#2「nested C」

对照表单元格展示曾截成 `nested C`，**数据侧全文完整**至 `nested CompoundModels`（len=98 &lt; 软限 150）。  
`softSummarize` **已覆盖 symptom**；本标题**无句号**可取整，但未超软限 → **整串返回**，非规则未覆盖。无需改代码、无需重蒸。

## 规则摘要

1. symptom：instruction 表象 → 实质工具报错首行（跳 Hashline/Import）→ agent 叙述；拒口水话  
2. fix：`softSummarize` 软 150 / 硬 300 句界取整（**未**滤 fix 尾巴废话）

## 状态

- **v2：CLOSED**  
- **v3 候选（不开单）**：fix 侧口水话 / 冒号脏接过滤  
