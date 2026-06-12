# 开发档案主脉络（INDEX）

> 用法：本文件是唯一入口。纵向看时间轴（哪天发生了什么 → 链到分支文档），
> 横向看项目树（模块 → 文档与源码位置）。
> 规则：分支文档改了什么，本文件加一行导航；细节写在分支文档里，本文件不展开。
> 注释不是档案。决策进 `adr/`，bug 进 `buglog.md`，本文件只做导航。

---

## 纵向 · 时间轴

| 日期 | 事件 | 分支文档 |
|---|---|---|
| 2026-06-04 ~ 06 | v0.33 TUI/Trace 稳定化；砍掉 design-study | [架构更新 v0.33→v0.4](student-agent-architecture-update-v0.33-v0.4.md) |
| 2026-06-07 | v0.34 Hashline / v0.35 WM+XState / v0.36 ToolGuard | 同上 + [v034](v034-prompt-round1.md)/[v035](v035-prompt.md)/[v036](v036-prompt.md) prompt 档案 |
| 2026-06-08 | v0.4 Context Runtime Freeze（batch commit `79ad7f64`，教训见 BUG-003） | [冻结文档](v0.4-context-runtime-freeze.zh.md) · [Ablation RFC](ablation-eval-rfc.md) |
| 2026-06-10 ~ 11 | SWE/terminal-bench 对比跑分（gpt-5.5，cc vs student-agent） | [外部基准](external-benchmarks.zh.md) |
| 2026-06-11 | 发现 benchmark 未接入 context runtime（BUG-001）；cc usage 采集修复（BUG-002）；评测口径敲定（ADR-001/002） | [接线修复计划](plan-noninteractive-context-runtime-fix.md) · [buglog](buglog.md) · [adr/](adr/) |
| 2026-06-11 | 旧版 TUI 与遗留物清理立项（待 benchmark 收尾后执行） | [清理计划](plan-legacy-cleanup.md) |
| 2026-06-11 | BUG-001 接线修复完成（codex，分支 `codex/context-runtime-benchmark`）；ON/OFF smoke 对比：token ×4~6、轮次 10→16/8→18，归因为注入的验证工作流引发"较真行为"+ 环境摩擦（astropy pytest warning 配置、build_ext），非上下文迷路；质量持平（题太简单）。治理方向：验证重试刹车（Bounded Breaker 用例），不减配 autonomy rule | [接线计划](plan-noninteractive-context-runtime-fix.md) · smoke results: `evals/results/swebench/context-runtime-on-smoke-20260611*/` |
| 2026-06-11 | Benchmark 矩阵 v1 敲定（Tier A 冒烟 / B 学习 / C 跨 agent；LoCoBench parked）；前置改动：autonomy rule 环境豁免补丁 + ToolGuard `verify_retry` 刹车 | [benchmark-matrix](benchmark-matrix.md) |
| 2026-06-11 | Tier A 结果（口径：final records 的 inputTokens/turns）：SWE 两题官方 resolved，12907 = 189k/11 calls，14182 = 189k/9 turns（政策补丁前 22 calls/493k input，降幅成立）；`verify_retry`/`patch_retry` 均 0 触发——补丁在上游消灭死磕，刹车仅有单测覆盖。Terminal：prove-plus-comm ✓、fix-git ✓（首次 verifier 被 Debian mirror 502 绊倒，重跑过）、**overfull-hbox ✗（红）**：消除 warning 但用了非法 synonym（natures→traits，跨 family）——约束跟踪失败，归因方法：查失败轮 prompt 中约束是否仍在，在=渲染问题/不在=装配问题；此为 v0.4x Requirement Ledger 的首份实证证据。首跑 401 令牌失效，fallback 渠道完成 | `evals/results/swebench/tier-a-verify-retry-fallback-20260611/` · `logs/run_evaluation/tier-a-verify-retry-20260611/` |
| 2026-06-11 | Tier A 收尾 + Sonnet 锚点轮计划立项（P0 归因 → P1 Hard Constraints MVP + 政策补丁 + 基础设施固化 → P2 全量回归 → P3 tag 冻结 + sonnet），交 codex 执行 | [plan-tier-a-green-and-sonnet](plan-tier-a-green-and-sonnet.md) |
| 2026-06-11 | 验收发现 P2 overfull 回归为无效 run（BUG-005：provider 漂移 deepseek + 缺 key，agent 未运行）；cc-sonnet smoke ×2 errored。决策：**停止自跑 cc**，跨 agent 改引公开 leaderboard 数据（per-instance artifact 与子集求交集），matrix Tier C 已修订；sonnet 轮改为 student-agent 单边 | [benchmark-matrix](benchmark-matrix.md) · [buglog BUG-005](buglog.md) |
| 2026-06-11 | `codex/context-runtime-benchmark` 按 11 批小步提交完成入库整理（repo ignore、非交互 context runtime、hardConstraints、verify_retry、外部 benchmark runner、fixtures、docs、CLI packaging、core/observability 支撑）；提交后完整 `npx vitest run` 通过：130 files passed / 1 skipped，909 tests passed / 1 skipped，duration 47s | [plan-tier-a-green-and-sonnet](plan-tier-a-green-and-sonnet.md) |
| 2026-06-11 | BUG-005 哨兵完成并实战验证：gpt-5.5 中转链路 3 次 agent exit 1（503）均标记 `invalid_run=true`，不计 reward，BUG-005 关案。改用 DeepSeek 官方 endpoint 做 overfull 功能回归：有效 run 的 verifier 3/4 通过，编译与 overfull 目标达成，但残留非法 `to→of`；trace 证明 L1 `hardConstraints` 已渲染且含 synonym family 约束，故 BUG-004 定位为装配已修、行为/最终验证闭环仍 OPEN。seed 2 启动后按失败即停规则终止，未计结果 | [buglog BUG-004/005](buglog.md) · `evals/results/terminal-bench/p2-overfull-official-deepseek-seed1-20260611/` |
| 2026-06-11 | 新 key 的 gpt-5.5 overfull smoke 为有效 run（14 turns / 172,788 input），仍为 verifier 3/4：`natures→traits` 跨 family，复现最初症状；hardConstraints 已完整进入 L1，失败点收敛到“最终未运行可执行 synonym-family 校验”。按计划未继续另外两轮与 SWE，未打 tag | [buglog BUG-004](buglog.md) · `evals/results/terminal-bench/p2-overfull-gpt55-newkey-seed1-20260611/` |
| 2026-06-11 | completion self-check 已实现（commit `488bb6c3`，全量 131 files / 912 tests 通过），gpt-5.5 overfull 3 seed 均有工具取证，但仅 1/3 verifier 4/4：seed 1 `an→a`、seed 3 `natures→moods`。自查 trace 显示模型用 examples 抽查后错误声明全部满足，未做完整逐 token 对照。按失败停止规则未跑 SWE、未打 tag | [buglog BUG-004](buglog.md) · `evals/results/terminal-bench/p3-overfull-selfcheck-gpt55-seed1-20260611/` |
| 2026-06-12 | BUG-004 第四层关案：`SELF_CHECK_PROMPT` 增加 full-diff 穷举与机械约束脚本化原则（commit `7c3e8afa`），gpt-5.5 overfull 3 seed 全部 verifier 4/4，三元组为 553k/675k/34、1,059k/1,219k/38、562k/631k/25；三轮自查均生成并运行 Node 校验器，实际抓出 article、跨 family 和文件尾结构违规后修复。成本显著高于 140k~177k/16~20 基线，归因为容器缺 git/python、脚本修复及真实违规返工 | [buglog BUG-004](buglog.md) · `evals/results/terminal-bench/p4-overfull-scripted-selfcheck-gpt55-seed{1,2,3}-20260611/` |
| 2026-06-12 | Tier A 全绿：SWE 官方 harness 12907/14182 均 resolved。12907=`425,030 / 447,385 / 16`，input 较 189k 基线上涨 124.7%，trace 归因为验证环境摩擦导致 31 次工具调用（基线 11）；14182 有效重跑=`136,215 / 148,775 / 8`，低于基线。14182 首次联合运行被外部终止并形成全仓删除式 suspicious patch，作为无效产物排除，未送判分 | [buglog BUG-004](buglog.md) · `evals/results/swebench/p4-scripted-selfcheck-gpt55-20260611/` · `evals/results/swebench/p4-scripted-selfcheck-gpt55-14182-rerun-20260612/` |
| 2026-06-12 | OpenRouter Sonnet cache 探针通过，BUG-002 关案：`prove-plus-comm` reward 1.0，`5,205 / 65,733 / 11`，cache read/write=`48,998 / 7,436`，cache read 占 prompt 输入 79.49%，实际成本 `$0.1196094`。逐轮 usage 显示首轮创建 cache、后续每轮读取，确认 Pi 的 Anthropic `cache_control` 经 OpenRouter 透传；run metadata 含 commit `71d1765e`、模型与 OpenRouter 单价 | [buglog BUG-002](buglog.md) · `evals/results/terminal-bench/openrouter-sonnet-cache-probe-20260612/` |
| 2026-06-12 | 渠道切换 OpenRouter sonnet-4.6（预算 $10）。cache 探针通过：prove-plus-comm reward 1.0、cache read 占比 79.49%、$0.12 → **BUG-002 关案**（OpenRouter 口径）。Tier A 重定基线进行中：fix-git 绿（$0.19）；overfull-hbox 判分无效——verifier 装 uv 失败（astral.sh SSL + uvx not found），记 **BUG-006**（verifier infra 失败应标 invalid_run，依赖需预烘焙；红线修订：infra 失败不耗重跑配额）。累计 $2.30 | [buglog BUG-006](buglog.md) |
| 2026-06-12 | BUG-006 代码修复完成、待回归：terminal 汇总新增 `invalid_reasons`，agent timeout 与 verifier setup failure 均标 invalid_run；新增 `prepare_terminal_bench_verifier_deps.py`，已生成本地 patched `overfull-hbox` task 与预装 `uv/uvx` 的 verifier 镜像，避免判分时访问 astral.sh。当前 shell 缺 `OPENROUTER_API_KEY`，未继续付费重测 | [buglog BUG-006](buglog.md) |
| 2026-06-12 | OpenRouter key 从 `~/.student-agent/.env` 注入后重测 patched overfull：BUG-006 的 verifier 侧已修好（不再拉 astral.sh，pytest 可运行；secret env file 避免 key 出现在 compose 参数），但 overfull 两次均为 `AgentTimeoutError`，新哨兵均标 invalid（`validRewardTrials=0`）。第二次 timeout 已按 ×1.5 提到 1125s，仍在 agent 第一轮 bash 后长时间无输出，未形成有效 run；OpenRouter usage `$3.89538615`，低于 `$5`，按红线停止，不跑 SWE | [buglog BUG-006](buglog.md) · `evals/results/terminal-bench/openrouter-sonnet-tier-a-overfull-hbox-patched2-20260612/` |
| 2026-06-12 | 零编辑续航哨兵完成（commit `cc40e3c8`）：非交互第一阶段结束后，若 `hardConstraints` 非空且 working memory `writeFiles` 仍为空，追加固定续航提示，最多 2 轮，每轮重查 `writeFiles`；JSON summary 记录 `continuationRounds`。overfull patched task 的 agent timeout 提到 2400s。预算预估：OpenRouter usage `$3.89538615`，距 `$5` 仅 `$1.1046`，而上一条 overfull 有效 agent 成本 `$1.3772`，预计单跑即可能越线，按熔断规则暂停等人工批准 | [benchmark-matrix](benchmark-matrix.md) |
| 2026-06-12 | 预算重排决策：overfull 标 **deferred**（Tier A 最贵、对 Tier B GO/NO-GO 价值最低，BUG-004 已在 gpt-5.5 关案；续航哨兵实战验证顺延），优先跑 SWE 12907/14182 sonnet 基线（Tier B 直接前置，off 臂复用）。单 run 成本 >$1.5 中止；预计累计 ~$4.7 守住 $5 线 | [benchmark-matrix](benchmark-matrix.md) |
| 2026-06-12 | OpenRouter Sonnet Tier A 重定基线完成 **4/5**（overfull deferred）：SWE 官方 harness 均 resolved。12907=`14,035 / 168,143 / 14`，`$0.21995895`，cache read 79.43%；14182=`39,355 / 486,207 / 34`，`$0.43223445`，cache read 86.85%。两题合计 trace 成本 `$0.6521934`、cache read 84.96%；OpenRouter 账户增量 `$0.5816424`，账户累计 `$4.54712565`，低于 `$5` 熔断线。直连因地区限制 403，commit `acfafa2b` 增加通用 Node proxy bootstrap 后经系统代理完成；metadata 如实记录 route/model/单价/commit。有效 4 题 trace 成本合计 `$0.9569841` | `evals/results/swebench/openrouter-sonnet-tier-a-12907-proxy-20260612/` · `evals/results/swebench/openrouter-sonnet-tier-a-14182-proxy-20260612/` |
| 2026-06-12 | Tier B OpenRouter Sonnet astropy pilot 完成（commit `53adbd41`，1 seed；12907/14182 off 复用 Tier A）：两臂官方 resolved 均 `4/6`。on 聚合为 `141,190 / 1,571,658 / 111`，off 为 `158,142 / 1,951,947 / 140`，trace cost `$1.8058 vs $1.9091`；但效率改善由 14995 单题主导，排除后 on 的 input/total/turns/cost 分别回涨 6.03%/14.04%/2.20%/17.94%。第 2 题起均召回 4 条，证明跨任务链路可运行，但内容主要为临时工具/环境错误，未见明确利用证据；resolved 无提升，按 ADR-002 **NO-GO 扩量**。10 个新 run 账户最终结算增量 `$2.7225`，累计 `$7.2696`，未触发熔断。收尾验证：`tsc --noEmit` 通过，Vitest 135 files passed / 1 skipped、926 tests passed / 1 skipped | [Tier B 结果](tier-b-openrouter-sonnet-20260612.md) · [benchmark-matrix](benchmark-matrix.md) · [ADR-002](adr/ADR-002-learning-eval-protocol.md) |

## 横向 · 项目树地图

| 模块 | 源码 | 文档 |
|---|---|---|
| 架构基线 | — | [v0.32 基线](student-agent-architecture-v0.32.md)、[v0.33→v0.4 更新](student-agent-architecture-update-v0.33-v0.4.md) |
| Context Runtime（L1 装配 / Recall / Tier） | `src/memory/recall/`、`src/extension/hooks/context-assembly.ts` | [冻结文档](v0.4-context-runtime-freeze.zh.md) |
| 记忆与任务（WM / Task Ledger / 工作流机） | `src/memory/tasks/` | 同上 |
| Hashline 锚定编辑 | `src/core/hashline/`、`src/core/pi-bridge/` | 架构更新 §v0.34 |
| Guards（Tool/File/Risk） | `src/extension/hooks/` | 架构更新 §v0.36 |
| Run Archive / Trace Grader | `src/memory/run-archive/`、`src/evals/trace-grader/` | 冻结文档 |
| Eval 框架（baseline/ablation/外部基准） | `src/evals/`、`scripts/eval-*.ts` | [eval 写作指南](eval-writing-guide.md)、[Ablation RFC](ablation-eval-rfc.md)、[外部基准](external-benchmarks.zh.md) |
| TUI | `src/tui-v2/`（现役）、`src/tui/`（待清理） | [清理计划](plan-legacy-cleanup.md) |
| 路线图 | — | [v0.4/v0.4x/v0.5 roadmap](student-agent-v0.4-v0.4x-alignment-roadmap-final.md) |
| 决策档案 | — | [adr/](adr/)（含被否方案与理由） |
| Bug 档案 | — | [buglog.md](buglog.md) |
| 新人上手 | — | [onboarding](onboarding.md) |

## 维护规则

1. 每次工作会话结束，由 AI 追加时间轴条目（一行 + 链接），人只 review。
2. 架构级决策（含被否掉的方案）写 ADR，防止废案被后来的 AI 重新提出。
3. bug 无论大小进 buglog：时间、症状、根因、改了哪、状态。
4. commit 是第一档案：小步提交、版本打 tag，禁止 batch commit。
