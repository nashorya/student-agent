# 注入实验 v0.2：SymPy 正式批次异地续跑交接

> 状态：正式实验运行中；本文件只是运行交接记录，不修改预注册设计，也不是结果结论。

## 固定身份

- 仪器基线 commit：`b79a90f8c4fe1b9dd7b65000c4b9f58f292285c9`（PR #13 合并后的 `main`）。
- 正式族：`F-SY-UNIT-EQUIVALENCE`。
- 冻结题序：`sympy__sympy-20442` → `sympy__sympy-24066` → `sympy__sympy-24213`。
- 数据集 commit：`69611d31007e1c6731db8bd5b5c3f2d33f5bab6e`。
- 解码 test Arrow SHA-256：`b77fa3036c06219715a35e8088fee13b0b87bc957052546c3270caf38a325627`。
- 模型与采样：`glm-5.2`，thinking enabled，`temperature=0`，`top_p=0.95`（不显式发送，`do_sample=false`），`max_tokens=16384`。
- 正式结果目录：`evals/results/injection-experiment-v0.2/sympy-family2-20260722T0807-cst-main-b79a90f8-images-proxy7897/`。

## 交接点

交接时已经完成并通过官方 harness 的 9 个 run：

| 臂 | 题 1 | 题 2 | 题 3 | 审计 |
|---|---:|---:|---:|---|
| A-L | resolved | resolved | resolved | 通过 |
| A-K | resolved | resolved | resolved | 通过 |
| B | resolved | resolved | resolved | 通过 |
| C | 未运行 | 未运行 | 未运行 | 待续跑 |

逐 run 已复验：初始 HEAD 等于冻结 `base_commit`、运行工作树无跨题残留、正式请求使用冻结采样值、必需审计文件齐全。B 的三题注入 ID 均为空。A-K 第 3 题注入两条合格 knack，并合法引用其中一条。

正式目录包含 A-L/A-K/B 的完整 trace、events、injection、prediction、harness、admission/distillation、memory inventory 和各臂独立 memory root。旧的零模型/拉取失败事故目录不在本次提交中。

## 在另一台机器继续 C 臂

先检出本交接分支并安装依赖。以下运行时资产是本机环境，不提交 Git，必须在目标机器另行准备：

1. 可用的 Docker daemon，以及三个官方镜像：
   - `swebench/sweb.eval.x86_64.sympy_1776_sympy-20442:latest`
   - `swebench/sweb.eval.x86_64.sympy_1776_sympy-24066:latest`
   - `swebench/sweb.eval.x86_64.sympy_1776_sympy-24213:latest`
2. 独立 SWE-bench harness venv；下例沿用 `/tmp/swebench-harness-venv/bin/python`。
3. 与冻结数据一致的 snapshot manifest；下例沿用 `/private/tmp/swebench-lite-69611d3/snapshot.json`。
4. GLM provider 凭证，以及需要时可用的 `127.0.0.1:7897` 代理。

从仓库根目录执行：

```bash
npm ci
NODE_USE_ENV_PROXY=1 \
HTTP_PROXY=http://127.0.0.1:7897 \
HTTPS_PROXY=http://127.0.0.1:7897 \
ALL_PROXY=http://127.0.0.1:7897 \
NO_PROXY=localhost,127.0.0.1 \
npm run eval:injection -- \
  --family F-SY-UNIT-EQUIVALENCE \
  --arm C \
  --results-dir "$PWD/evals/results/injection-experiment-v0.2/sympy-family2-20260722T0807-cst-main-b79a90f8-images-proxy7897" \
  --harness-python /tmp/swebench-harness-venv/bin/python \
  --snapshot-manifest /private/tmp/swebench-lite-69611d3/snapshot.json
```

C 臂有独立的空 memory root，不依赖 A-L/A-K/B 的记忆；不得重跑前三个臂，也不得改用新结果目录。若 provider、格式、Docker、harness、报告或快照校验出现异常，应立即停批并保留现场，不得现场修改设计或阈值。

C 三题完成后，在同一结果目录生成中期报告并按冻结规则判读：

```bash
npm run eval:injection:midterm -- \
  --results-dir "$PWD/evals/results/injection-experiment-v0.2/sympy-family2-20260722T0807-cst-main-b79a90f8-images-proxy7897" \
  --family F-SY-UNIT-EQUIVALENCE
```
