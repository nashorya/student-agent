# 注入实验 v0.2：SymPy 正式批次交接

> 状态：四臂 12 个正式 run 已完成；本文件只是运行交接记录，不修改预注册设计。

## 固定身份

- 仪器基线 commit：`b79a90f8c4fe1b9dd7b65000c4b9f58f292285c9`（PR #13 合并后的 `main`）。
- 正式族：`F-SY-UNIT-EQUIVALENCE`。
- 冻结题序：`sympy__sympy-20442` → `sympy__sympy-24066` → `sympy__sympy-24213`。
- 数据集 commit：`69611d31007e1c6731db8bd5b5c3f2d33f5bab6e`。
- 解码 test Arrow SHA-256：`b77fa3036c06219715a35e8088fee13b0b87bc957052546c3270caf38a325627`。
- 模型与采样：`glm-5.2`，thinking enabled，`temperature=0`，`top_p=0.95`（不显式发送，`do_sample=false`），`max_tokens=16384`。
- 正式结果目录：`evals/results/injection-experiment-v0.2/sympy-family2-20260722T0807-cst-main-b79a90f8-images-proxy7897/`。

## 完成点

四臂全部完成并通过官方 harness：

| 臂 | 题 1 | 题 2 | 题 3 | 审计 |
|---|---:|---:|---:|---|
| A-L | resolved | resolved | resolved | 通过 |
| A-K | resolved | resolved | resolved | 通过 |
| B | resolved | resolved | resolved | 通过 |
| C | resolved | resolved | resolved | 通过 |

逐 run 已复验：仪器 commit 为冻结的 `b79a90f8`、初始 HEAD 等于冻结 `base_commit`、运行工作树无跨题残留、正式请求使用冻结采样值、必需审计文件齐全。B 的三题注入 ID 均为空。A-K 第 3 题注入两条合格 knack，并合法引用其中一条。C 第 2 题因前题蒸馏为空而合法空注入，第 3 题 full-resident 快照包含 4 条合格主 lesson。

正式目录包含四臂的完整 trace、events、injection、prediction、harness、admission/distillation、memory inventory、各臂独立 memory root，以及冻结规则生成的中期报告。

## 中期检查

- 四臂第 2、3 题均为 `2/2 resolved`。
- 四臂全灭条件未触发，不启用替补族。
- A-L / A-K / B / C 的第 2、3 题阶梯触发分别为 `7 / 11 / 2 / 9`。
- 完整效率判读见[SymPy 中期审计报告](./injection-effect-v0.2-sympy-midterm-2026-07-22.md)。

## 异地分析

检出交接分支即可取得全部正式审计数据：

```bash
git fetch origin
git switch codex/sympy-v02-results-handoff
```

本族已经完成，禁止在同一正式目录重跑任何臂或题目。
