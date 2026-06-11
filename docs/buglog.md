# Bug 档案

> 规则：再小的问题也记录。模板见文末。状态：OPEN / FIXED / FIXED-待回归 / WONTFIX。
> 修复必须由 AI 执行并在此留痕；注释里的说明不算档案。

---

## BUG-001 · benchmark 路径未接入 Context Runtime

- **时间**：2026-06-11，发现者：codex（用户转述），Claude 确认根因
- **症状**：SWE 对比 run 的 trace 中 `layers.L1/L2/L3.sectionCount = 0`、
  `contextPromptEstimatedTokens = 0`（见 `evals/results/comparison/full-main-contextbreakdown-20260611T065619Z/swe-student-agent/records.json`）
- **根因**：`runNonInteractive` 从未在 TasksManager 创建 task；
  `context-assembly.ts` 新管道以 `getActive()` 为前提，无 task 走降级分支跳过 L1/L2/L3。
  次要：hook 创建时未传 `runMode: 'eval'`。
- **影响**：65k vs 286k 的 token 对比不能归因 context runtime（归基座设计）；
  此 run 可复用为 ablation 的 off 臂。
- **处置**：修复计划 [plan-noninteractive-context-runtime-fix.md](plan-noninteractive-context-runtime-fix.md)，交 codex 执行
- **状态**：OPEN（计划已立）

## BUG-002 · cc usage 采集不认 OpenAI 格式，cache 恒为 0

- **时间**：2026-06-11，发现者：Claude（排查 cache=0 异常时）
- **症状**：cc（经代理跑 gpt-5.5）的 `cacheReadTokens` 恒为 0
- **根因**：`usageFromClaudeJson` 只解析 Anthropic 字段
  （`cache_read_input_tokens`），不认 OpenAI 的
  `prompt_tokens_details.cached_tokens`；且原始 usage 未留底，无法事后判断。
- **修复**：`src/evals/claude-code-runner.ts` 增加 OpenAI 格式回退
  （注意语义归一：OpenAI `prompt_tokens` 含 cached，映射时减除）；
  新增 `rawUsage` 字段原样留底；补单测。
- **遗留**：terminal-bench 路径（`run_benchmark_comparison.py` 的 `n_cache_tokens`）
  另一条链路，未核；若代理本身丢字段则客户端无解，rawUsage 留底后可判别。
- **状态**：FIXED-待回归（本地 `npx vitest run src/evals/__tests__/claude-code-runner.test.ts`）

## BUG-003 · 档案纪律失守：v0.37–v0.4 被打包进 batch commit

- **时间**：2026-06-08 发生，2026-06-11 复盘
- **症状**：git log 最后的版本化提交停在 v0.36，v0.4 成果埋在
  `79ad7f64 chore: batch commit`；另有 ~90 文件长期未提交；
  评测结果 JSON 未绑定 commit hash，无法复现。
- **根因**：赶进度时档案流程停摆（本方法论的已知失败模式）。
- **处置**：恢复小步提交 + 版本 tag；结果 metadata 强制含 commit/model/单价；
  会话末由 AI 追加 INDEX 时间轴，降低纪律成本。
- **状态**：OPEN（待未提交改动分批入库）

## BUG-004 · overfull-hbox 约束未进入近场，导致非法 synonym 替换

- **时间**：2026-06-11 18:20，发现者：codex
- **症状**：Terminal Tier A 的 `overfull-hbox` run 中 agent 消除了
  `Overfull \hbox`，但 verifier 失败：
  `modified input.tex must only modify words in synonyms.txt`。失败差异为
  `natures -> traits`，二者不在同一 synonym family。
- **根因**：非交互 task 创建时只把 instruction 通过 `compactTaskName`
  写入 `working_memory.goal/todos`，200 字截断后停在
  `only edits you may make a...`，没有把 `synonyms.txt` family 约束保留到
  L1。失败 run 的 context trace 只有 `taskSpec` 319 chars，无独立 hard
  constraints section；完整约束只存在于原始 prompt/较早历史里。收尾阶段模型
  口头声明要校验 synonym families，但 `git` 不存在后改为凭已读文件继续，未做
  可执行约束校验。
- **修复/处置**：按 `plan-tier-a-green-and-sonnet.md` P1 增加通用
  `working_memory.hardConstraints` 与 L1 `hardConstraints` section；非交互路径
  确定性保存完整 instruction；eval autonomy rule 增加完工前重读 hard
  constraints 的收尾纪律。
- **状态**：FIXED-待回归（待 `overfull-hbox` 重跑验证）

## BUG-005 · P2 overfull 回归为无效 run：provider 漂移 + 缺 API key

- **时间**：2026-06-11 19:35 run / 验收时发现，发现者：Claude（验收）
- **症状**：`p2-overfull-hard-constraints-20260611` reward=0 看似红灯，
  实为 agent exit 2：`Missing DEEPSEEK_API_KEY for provider deepseek`，
  agent 从未运行，verifier 测的是原始 repo（test_no_overfull_hboxes 自然失败）。
- **根因**：run 配置漂移到 `student-agent__deepseek-v4-pro`，违反矩阵
  Tier A 的 gpt-5.5 口径；且环境缺对应 key。哨兵缺失：agent 退出码非零时
  结果仍被当作正常 trial 落盘，容易误读为任务失败。
- **修复/处置**：① 重跑用 gpt-5.5（与基线口径一致）；② runner 对
  agent-phase 非零退出应标记 `invalid_run` 而非进入 reward 统计；
  ③ hardConstraints 修复仍属"未经实战验证"状态。
- **状态**：OPEN

---

## 模板

```
## BUG-NNN · 一句话标题

- **时间**：YYYY-MM-DD HH:MM，发现者：
- **症状**：（现象 + 证据位置）
- **根因**：（定位到文件/函数；未定位写"未明"）
- **修复/处置**：（改了哪、为什么这么改；暂时方案要标注"暂时"）
- **状态**：OPEN / FIXED / FIXED-待回归 / WONTFIX
```
