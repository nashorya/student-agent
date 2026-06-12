# Benchmark 矩阵（v1，2026-06-11 敲定）

> 原则：每个 benchmark 必须回答一个明确的问题，回答不了就不花钱。
> LoCoBench：**parked**。importer/scorer 代码保留，不再投入接入时间
> （长上下文退化由 Tier B 序列天然覆盖）。

---

## 前置改动（跑 Tier A 之前完成）

### 1. 政策补丁：验证失败的环境豁免

`EVAL_AUTONOMY_RULE`（`src/memory/recall/context-builder.ts`）追加两条：

```
- If validation fails for reasons unrelated to your change (pre-existing
  test configuration, environment, or build infrastructure), record it as
  an environment blocker and move on. Do not fight the environment.
- Do not retry the same failing validation approach more than twice.
  Change strategy or record the blocker.
```

背景：smoke run 中模型用 4 种姿势死磕 astropy 的 DeprecationWarning pytest
配置（见 INDEX 2026-06-11 条目）。规则原文只说 "continue until validation
fails"，未定义"验证环境本身坏了"的出口。

### 2. 验证刹车（ToolGuard 新规则 `verify_retry`）

- 同一验证类命令（pytest / py_compile / build 等，按命令首 token 分类）
  连续失败 ≥3 次、且其间**没有任何文件编辑** → 拦截，写 `verify_retry`
  ProtectedEvalEvent signal。
- 实现仿照现有 `patch_retry` 规则（`src/extension/hooks/tool-guard.ts`）。
- 单测：3 连败无编辑被拦；中间有 apply_patch/edit 则计数重置。

---

## Tier A · 回归冒烟

| 项 | 内容 |
|---|---|
| 何时跑 | 每次改 harness / 政策文本 / guard 规则后 |
| 任务 | SWE: astropy-12907、astropy-14182（镜像已缓存）；terminal: fix-git、overfull-hbox、prove-plus-comm |
| 配置 | student-agent only，`--student-variant context_runtime --run-mode eval`，每题 1 trial |
| 模型口径 | 2026-06-12 起：OpenRouter `anthropic/claude-sonnet-4.6`，`openai-completions`；metadata 必须记录 commit、模型、单价与实际 network route |
| 预算 | 以 smoke 实测估算：SWE ~200k–500k input/题，terminal 较小；单轮全套 < 2M tokens |
| 看什么 | turns、input tokens、pass、`verify_retry`/`patch_retry` 触发数 |
| 当前基线 | Sonnet 4/5：prove-plus-comm、fix-git、SWE 12907/14182 绿；overfull 因预算 deferred，续航哨兵实战验证顺延 |

## Tier B · 学习 eval（旗舰，协议见 ADR-002）

| 项 | 内容 |
|---|---|
| 先导序列 | astropy 全部 6 题，按时间序：6938 → 7746 → 12907 → 14182 → 14365 → 14995 |
| 两臂 | on：`--memory-dir` 指向序列共享目录；off：每题指向全新目录 |
| 模型候选 | 默认 OpenRouter `anthropic/claude-sonnet-4.6`；预算不足时先用 Haiku 单题探针，是否换型由人工确认 |
| 规模 | 2 臂 × 6 题 × 2 seed = 24 run |
| 看什么 | ADR-002 三项审计（召回/重复错误/污染）+ token/turns 随序号的斜率 |
| 可证伪预测 | on 臂从第 2 题起应跳过 pytest warning 搏斗（lesson/knack 应记录 `-o filterwarnings` 解法并被召回命中） |
| 扩量条件 | astropy 出正信号 → django 10 题序列；无信号 → 停，按归因表修记忆管道 |
| 2026-06-12 pilot | 1 seed 完成，resolved 两臂均 4/6；on 聚合 input -10.72%、total -19.48%、turns -20.71%、trace cost -5.41%，但改善由 14995 单题主导，排除后四项均回涨。第 2 题起 recall 均命中，但内容主要为临时工具/环境错误，未观察到使用证据；**NO-GO 扩量**，先修准入、排序与利用审计。详见 [结果报告](tier-b-openrouter-sonnet-20260612.md) |

## Tier C · 对外参照（2026-06-11 修订：不再自跑竞品）

> 决定：不再自行运行 claude-code / opencode 做受控对比（预算止损）。
> 跨 agent 信息改为引用公开数据，受控证据全部来自自我 ablation。

| 项 | 内容 |
|---|---|
| 数据来源 | 公开 leaderboard + 提交 artifact（SWE-bench 提交含 per-instance resolved 结果，下载后与本项目子集求交集做逐题对照） |
| 引用纪律 | 必须带四元组：系统名、模型、评测日期、子集口径；只作"背景参照"，不作"受控对比"；禁止"打败 X"与跨系统 token 对比宣称 |
| 自有数字 | student-agent 自身数据仍须 commit hash、model、单价、`--student-variant` 齐全 |
| sonnet 轮 | 改为 student-agent 单边（plain vs context_runtime，或 Tier B 的 on/off），目的：跨模型泛化证据 + OpenRouter cache 采集验证（BUG-002 已关案） |
| 历史遗留 | cc 自跑数据（gpt-5.5 off-label）降级为内部参考，不对外引用；cc-sonnet smoke 调试停止 |
| 2026-06-12 证据盘点 | 本地 CC 仅有 gpt-5.5 的 12907/14182 两题，官方 harness 2/2；公开 Epoch Sonnet 4.6 与本项目相交四题为 4/4，但原始 log 是 `bash_agent`，不是 Claude Code。当前不具备同模型、同题集 CC 对比，详见 [完整对比](cc-reference-and-tier-b-comparison-20260612.md) |

---

## 判读纪律

- Tier A 红了不跑 B/C。
- 报告口径统一以 final records 为准，且必须写明字段名：
  报 `inputTokens / totalTokens / turns` 三元组，禁止裸报"token 数"。
- Tier B 的结果决定 v0.4x 优先级（见 ADR-002"定位"节），不由论文决定。
- 任何"恐怖"数字先做 trace diff 归因再下结论（参照 turn 通胀案例：
  先归因为政策行为变化，而非机制故障）。
