# 注入实验 v0.1.1 点火中止记录

日期：2026-07-20  
冻结代码：`22e1dd313d51447aa09cc752605c34d6a8928832`  
处置：**整批无效；不得判分或并入后续结果**

## 已发生范围

- A 臂第 1 题 `django__django-12125` 完成 agent 与学习生命周期，未运行官方 harness。
- A 臂第 2 题 `django__django-14580` 启动后被人工中断，无完整 outcome。
- A3、B、C 及 SymPy 族均未启动。

A1 的学习摘要为 `lessonsExtracted=9`、`knacksPromoted=0`、`usedRecallIds=[]`；memory 中有 1 条主 lesson、8 条 ephemeral lesson、0 条 knack。烟测曾把 B 的蒸馏结果人工写成 validated knack 后注入 A/C，因此只证明注入段可达，没有证明各臂第 1 题的自然产物能按预期进入下一题。

## 中止与重开理由

操作者发现上述差异后中断 A2。由于 A2 已经接收模型请求，原批次不能续接。冻结后的 v0.1.1 也没有明确区分“直接 lesson recall”与“knack 成熟度准入”，不得在看到 A1 产物后现场选择口径，故作废重开为 v0.2。

原始本地结果目录只作为事故现场保留在忽略路径 `evals/results/injection-experiment/django-family1-20260720T1948-cst-proxy7897-retry1/`，不复制进实验结果集。
