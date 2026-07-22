# STOP：SymPy A-L1 checkout 基础设施失败

- 时间：2026-07-21（Asia/Shanghai）
- instrument commit：`b79a90f8c4fe1b9dd7b65000c4b9f58f292285c9`（PR #13 merge commit）
- family / arm / task：`F-SY-UNIT-EQUIVALENCE` / `A-L` / `sympy__sympy-20442`
- 状态：**整批已停；A-K、B、C 未启动；本目录不得并入 v0.2 结果判读。**

## 事实

runner 在 agent 启动前建立全新题目 worktree 时执行：

`git clone --no-checkout https://github.com/sympy/sympy.git .../sympy__sympy-20442`

固定 600 秒 checkout 超时后以 code 124 退出，并报告 `fatal: early EOF`。`records.json` 与 `metadata.json` 已落盘；二者记录 `turns=0`、`inputTokens=0`、`totalTokens=0`、空 prediction。由于失败发生在 checkout，未产生 trace、events、injection、harness 或 admission，正式模型请求数为 0。

## 停跑纪律

没有把 checkout 失败当作空 patch，也没有启动后续题或其他臂；没有修改冻结设计、runner、召回阈值或题目。失败的部分 clone 现场保留在 runner 记录的临时路径，供诊断。

## 待作者批准的环境补救

预拉官方、与冻结三个 instance 对应的 harness images，使现行 runner 从 image 的 `/testbed` 复制仓库并继续执行原有 `base_commit` checkout、hard reset、`clean -fdx` 和 HEAD/洁净校验：

- `swebench/sweb.eval.x86_64.sympy_1776_sympy-20442:latest`
- `swebench/sweb.eval.x86_64.sympy_1776_sympy-24066:latest`
- `swebench/sweb.eval.x86_64.sympy_1776_sympy-24213:latest`

补救只改变本地判分/checkout 环境，不改变实验设计。批准后仍应保留本目录为零模型基础设施事故证据，并从另一个全新结果目录重新点火，不复用本目录或 memory root。
