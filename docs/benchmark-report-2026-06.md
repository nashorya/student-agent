# student-agent 评测报告（2026 年 6 月）

> 本报告汇总 2026-06-10 ~ 06-12 期间的全部评测。所有数字可溯源：每个 run 的
> metadata 含 commit hash、模型、渠道与单价；原始产物在 `evals/results/`，
> 时间轴见 [docs/INDEX.md](INDEX.md)。
> 口径声明：依 [ADR-001](adr/ADR-001-eval-claim-separation.md)，本项目
> **不做任何"胜过 Claude Code"类宣称**——跨系统数据仅作背景参照；
> 所有受控结论均来自同模型、同 harness 的自我 ablation。

---

## TL;DR

- **基座 harness 的 token 效率成立**：同题同模型下，本项目的精简上下文设计
  显著低于重型 scaffold 的消耗（见 §2）。
- **150 token 的常驻政策文本可使成本波动 4~6 倍**：我们用受控实验定位并
  修复了一次"验证死磕"行为，单题成本 -57%（见 §3）。
- **约束遵循的四层修复案例**：从"约束丢失"修到"脚本化穷举自查"，
  3/3 seed 通过，全程无任务专用 hack（见 §4）。
- **跨任务记忆：管道可运行，质量收益尚未证明**。学习 eval（memory on/off
  双臂）诚实给出 NO-GO，并把病灶定位到 lesson 写入层（见 §5）。
- 全部 Sonnet 评测花费 **$7.27**（预算 $10），依靠 cache 探针先行、
  成本熔断、无效 run 哨兵三件套（见 §6）。

---

## 1 · 评测体系

三档矩阵（[benchmark-matrix.md](benchmark-matrix.md)）：

| 档 | 用途 | 任务 |
|---|---|---|
| Tier A | 回归冒烟：每次改 harness/政策必跑 | SWE-bench Lite astropy 12907/14182 + terminal-bench fix-git / prove-plus-comm / overfull-hbox |
| Tier B | 学习 eval：memory on/off 序列双臂 | astropy 6 题按时间序（协议见 [ADR-002](adr/ADR-002-learning-eval-protocol.md)） |
| Tier C | 对外参照：只引公开数据，不自跑竞品 | Epoch AI 公开逐题结果交集 |

报数口径统一为 `inputTokens / totalTokens / turns` 三元组；agent 非零退出与
verifier 环境失败均标 `invalid_run` 不计分（防"基础设施噪声污染判分"）。

## 2 · 基座 token 效率（gpt-5.5，同模型对照）

同跑 SWE astropy-12907 / 14182，gpt-5.5，2026-06-11：

| 配置 | 12907 | 14182 |
|---|---|---|
| Claude Code 2.1.153（off-label 跑 gpt-5.5，内部参考） | ✓ 170k total | ✓ 480k total |
| student-agent 裸基座（context runtime OFF） | ✓ 65k total / 9 calls | ✓ 116k total / 11 calls |

在这两个历史样本中，重型 scaffold 的有效 patch run 消耗约为裸基座的
2.6~4.1 倍。14182 的有效 patch run 在达到 runner 预算后退出，但留下的
patch 经官方 harness 判为 resolved；较早的一次空 patch 不计入本表。注：
CC 跑 gpt-5.5 属非原生配置，此表只说明"本项目基座的精简程度"，不构成
与 CC 产品的对比。

## 3 · 政策文本实验：一行规则 = 4~6 倍成本

打开 context runtime（注入常驻工作流规则）后的受控观察：

| 阶段 | 12907 | 14182 | 结论 |
|---|---|---|---|
| 规则原版（"validate 到通过为止"） | 197k input / 19 calls | 493k input / 22 calls | 模型与环境的 pytest warning 配置死磕 4 种姿势 |
| 规则补丁（环境豁免 + 重试上限两条） | 189k / 11 calls | 189k / 9 turns | 14182 成本 **-57%**，质量不降（双双 resolved） |

结论：agent 行为对常驻 prompt 文本极度敏感；治理手段是
trace diff 归因 + 政策补丁 + 硬规则刹车（ToolGuard `verify_retry`），
而非调弱验证标准。

## 4 · 案例研究：约束遵循的四层下钻（BUG-004）

terminal-bench `overfull-hbox`：只允许用同义词组内替换消除 LaTeX 警告。
初始失败后,四层归因逐层修复，每层均有 trace 证据：

| 层 | 病灶 | 修复（全部为通用机制） |
|---|---|---|
| 1 | 约束被 200 字截断,未进入上下文近场 | WorkingMemory 新增 `hardConstraints`，每轮渲染进 L1 |
| 2 | 约束在眼前仍凭语感违反 | 收尾自查回合（completion self-check） |
| 3 | 自查只"声明"不"动作" | 自查必须工具取证（git diff / read） |
| 4 | 取证后仍抽查不穷举 | 政策："机器可判定约束必须生成脚本穷举校验" |

最终 3/3 seed 通过：自查脚本实际抓出冠词连带修改、跨组替换、文件尾
结构三类真实违规并完成返工。代价是"较真税"（成本升至 ~600k-1.2M total），
说明彻底性与成本的张力是 harness 设计的核心权衡之一。

## 5 · 学习 eval：诚实的 NO-GO（OpenRouter Sonnet 4.6）

协议：astropy 6 题按时间序,on 臂跨题共享 memory，off 臂每题清空；
题目与判分均为 SWE-bench 官方 harness，自建部分仅"记忆是否保留"一行协议。

| 指标 | off | on | 相对 |
|---|---:|---:|---:|
| resolved | 4/6 | 4/6 | 持平 |
| totalTokens | 1,951,947 | 1,571,658 | -19.5% |
| turns | 140 | 111 | -20.7% |
| trace cost | $1.91 | $1.81 | -5.4% |

**但**效率改善由单题离群值（14995：49→18 turns）主导，排除后 on 臂成本
反升 14~18%。三项审计结论：

- 跨任务"归档→召回→注入"链路实战可运行（第 2 题起稳定召回 4 条）；
- 召回内容多为临时工具/环境错误，**无模型实际利用的证据**；
- 病灶在写入层：31 条 lessons 全是过程错误，零条"验证过的解法"。

依 ADR-002 门槛判定 **NO-GO 扩量**，修复方向已立项：lesson 准入门控、
召回排序去 recency 偏置、利用可观测。完整数据：
[tier-b-openrouter-sonnet-20260612.md](tier-b-openrouter-sonnet-20260612.md)。

### 外部参照（不构成对比）

与 Epoch AI 公开的 Sonnet 4.6 `bash_agent` 逐题结果相交 4 题：Epoch 4/4，
本项目两臂均 3/4（差题 14365，根因已定位：regex 大小写修复不完整）。
Anthropic system card 报告 Sonnet 4.6 在 Verified 全集 79.6%（简化双工具
scaffold）。详见
[cc-reference-and-tier-b-comparison-20260612.md](cc-reference-and-tier-b-comparison-20260612.md)。

## 6 · 成本与工程纪律

OpenRouter Sonnet 4.6 全部评测（cache 探针 + Tier A 重定基线 + Tier B
双臂 10 run）累计 **$7.27**，预算 $10。做法：

- **cache 探针先行**（$0.12）：确认 `cache_control` 经 OpenRouter 透传、
  命中率 79~87%，全程成本因此减半以上；
- **熔断**：分阶段软上限,单 run 超限中止，两次在越线前精确停车；
- **无效 run 哨兵**：agent 超时、verifier 依赖安装失败（如运行时拉取
  astral.sh）均标 `invalid_run`，不计 reward、不耗重跑配额；
- **复用**：Tier B off 臂复用 Tier A 同配置数据，省 2 run。

## 7 · 已知局限

1. 样本量小：Tier B 仅 1 seed；所有结论标注为初步。
2. overfull-hbox 的 Sonnet 基线因预算 deferred（4/5）。
3. CC 相关数据均为 off-label 内部参考,不可对外引用为对比。
4. 记忆系统的质量收益**尚未证明**——这是当前最高优先级的开发方向,
   也是本项目评测体系存在的意义：先证明，再宣称。
