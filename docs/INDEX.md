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
| （待办） | git 分批 commit（9 批方案已出）→ gpt-5.5 重跑 overfull 验证 hardConstraints → Tier A 全绿 → tag → sonnet 单边轮 + Tier B | [plan-tier-a-green-and-sonnet](plan-tier-a-green-and-sonnet.md) |

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
