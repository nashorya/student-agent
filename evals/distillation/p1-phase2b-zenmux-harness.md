# P1-D · SWE-bench harness 判分（ZenMux produce 批）

- **日期**：2026-07-19
- **dataset**：`SWE-bench/SWE-bench_Lite`（test split）
- **predictions**：6 条（6938 / 7746 / 12907 / 14182 / 14365 / 14995）
- **raw report**：`evals/results/swebench/p1prom-20260718-zenmux-harness/reports/anthropic__claude-sonnet-4.6.p1prom-20260718-zenmux.json`
- **machine summary**：`evals/distillation/p1-phase2b-zenmux-harness-report.json`

## 结果

| 指标 | 值 |
|---|---:|
| produce success | **6/6** |
| harness completed | **6/6** |
| **resolved** | **3/6（50%）** |
| unresolved | 3/6 |
| empty patch / error | 0 / 0 |

### 分题

| instance | produce | harness |
|---|---|---|
| astropy__astropy-6938 | success | **resolved** |
| astropy__astropy-7746 | success | unresolved |
| astropy__astropy-12907 | success | **resolved** |
| astropy__astropy-14182 | success | unresolved |
| astropy__astropy-14365 | success | unresolved |
| astropy__astropy-14995 | success | **resolved** |

> **success ≠ resolved**：produce 只表示 agent 跑完并产出 patch；官方测试通过才算 resolved。掉一半属预期，如实记。

## 晋升

- 主库在 D+ 审计后已 **0 条**（13 过程噪声 → ephemeral）。
- 对 6 个 `runId` 执行 `promoteCandidatesForRun`：**promoted=0**。
- verified 占比：仍 **voided_empty_main**（无主库可算）。

## knack 来源（并入）

- 主库/召回中 `knack_<uuid>` 格式：`src/memory/knacks/manager.ts` → `knacks.jsonl`。
- **非** lessons 门控泄漏；与 ephemeral 降级无关。

## P1 状态

仪器 A/B 已落地、C proposal 已出、D 判分已入档；**盲审 0/5 + 主库空** → P1 **仍重开验收**，不合页。
