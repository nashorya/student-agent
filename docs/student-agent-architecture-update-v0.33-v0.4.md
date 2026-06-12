# Student Agent — 架构更新文档 v0.33 → v0.4

> 面向：内部 Stakeholders / PM
> 基线文档：`student-agent-architecture-v0.32.md`
> 本篇定位：在 v0.32 架构之上，梳理从 v0.33 至 v0.4 Context Runtime Freeze 期间的实质性变化、原因与影响。

---

## 一、阅读指引

v0.32 架构文档定义了 student-agent 的核心骨架：State Machine、分层记忆、失败升级、子代理、Bounded Breaker、Quality Watchdog。本文不重复这些内容，而是回答三个问题：

1. **过去一段时间我们做了什么？**（What changed）
2. **为什么做？**（Why — 通常背后有论文校准或一线踩坑）
3. **PM/Stakeholder 需要知道的影响是什么？**（So what）

如果你只有 5 分钟，读"二、版本路线总览"和"七、面向 PM 的关键结论"即可。

---

## 二、版本路线总览

从 v0.32 起，架构演进收敛为一条主线：**从"自学习智能体"先退一步，建一个可观察、可复盘、可验证编辑的稳定 harness**。Bounded Breaker 等 v0.3 的进化型功能没有抛弃，但暂时让位给"先记录、再判断"的工程基础。

```
v0.32  架构基线（State Machine、分层记忆、失败升级）
  ↓
v0.33  TUI / Trace 稳定性
  ↓
v0.34  Hashline Anchored Edit（内容哈希锚定的文件编辑）
  ↓
v0.35  Working Memory 扩展 + XState 工作流状态机
  ↓
v0.36  ToolGuard Hook（工具调用前的硬规则拦截）
  ↓
v0.4   Context Runtime Freeze
       L1 Prompt 装配主干冻结、Recall Router、Trace Grader、Eval 审计
```

每一档都是"可独立交付的小步"，避免一次性大改架构。

---

## 三、各版本变化点

### v0.33 — TUI / Trace 稳定性

**目标**：把 TUI 这一层稳住，后续架构改动不会反复打破用户感知。

主要工作：

- TUI v2：四通道隔离（transcript / status / input / debug），新增滚动支持、流式状态、视觉打磨、Tab 键斜杠命令补全。
- 修复一批"小但要命"的问题：duplicate 消息、tool error 一闪而过、status 混入正文、任务运行中用户输入丢失、终端污染。
- 删除了 `/design` 命令与 design-study 子系统（v0.31 引入，使用率低、维护成本高，回收掉以减少表面积）。

**对 PM 的意义**：用户日常看得见的稳定性问题集中在这一档解决。后续即便底层架构持续变化，TUI 表现层不会再频繁波动。

### v0.34 — Hashline Anchored Edit

**目标**：从根本上消灭"模型复述 old_text 不一致导致 edit 失败"这一类长期顽疾。

实现要点：

- 引入外部库 `@oh-my-pi/hashline`（MIT，纯 TS）。
- 新增 `StudentAgentFilesystem`，read 时给出 `¶path#tag` 风格的内容哈希锚点。
- edit 工具改为基于 tag 比对：tag 过期自动拒绝；session 内连续编辑同一文件时自动尝试 3-way merge 恢复。
- Hashline 的 SnapshotStore 与原有的 git 级 SnapshotManager 并行运行：前者是会话内的文件级哈希、后者负责灾难回滚，互不干扰。
- Hashline 自身会写出 `stale_rejection` / `recovery_success` / `recovery_failure` 三类 ProtectedEvalEvent，进入 Run Archive。

**对 PM 的意义**：

- 文件编辑失败率显著下降（行为上：模型不再因为空格、注释、stale read 误判而连续撞墙）。
- 输出 token 也随之下降（无需复述大段 old_text）。
- 这是 v0.4 "可验证编辑"目标的核心一块。

### v0.35 — Working Memory 扩展 + XState 工作流状态机

这一档拆成两个子任务，统称 v0.35。

**子任务 A：Working Memory 扩展**

- 在 `TaskWorkingMemory` 上增加 `read_files`、`written_files`、`recent_errors` 字段。
- read / edit 工具调用自动写入，对模型透明。
- 解决的核心问题：长任务里模型会忘记自己已经读过哪些文件、踩过哪些错，导致重复劳动甚至自相矛盾。Working Memory 把这些放进每轮 prompt 的 pinned context，不依赖滚动摘要。

**子任务 B：XState 工作流状态机**

- 把 22 个 `TaskWorkflowStatus` 状态、以及它们之间的合法转移，从散落在 `TasksManager` 各方法里的 `task.workflow_status = 'xxx'` 赋值，统一收敛为 XState v5 的 `setup().createMachine()` 定义。
- 非法转移会被记录并忽略，而不是 crash。
- `TasksManager` 仍是外部唯一公共 API；调用方（`extension/index.ts` 等）零改动。

**对 PM 的意义**：长任务（多步规划 + 重构 + 自检）的稳定性提升。非法状态转移从"潜在崩溃"变成"可观察的拒绝"。

### v0.36 — ToolGuard Hook v0

**目标**：用硬规则在工具执行前挡住四类常见的"agent 低级坏行为"。

四条规则：

1. **empty_bash**：空白 bash 命令直接拦截。
2. **nl_bash**：自然语言被误塞进 bash 的命令直接拦截（兼顾中英文模式）。
3. **broad_glob**：`**/*.ts` 这类无目录前缀的全项目 glob 直接拦截。
4. **patch_retry**：同一文件、同一失败种类、未重新 read 就反复 retry 的 edit 直接拦截。

实现要点：

- 新增 `src/extension/hooks/tool-guard.ts`，沿用 `file-guard.ts` 的工厂模式：`{ hook, reset }`。
- 注册到 `extension/index.ts` 的 hook 链，与 FileGuard、RiskGuard 并列，先到先 block。
- 每次拦截写入 ProtectedEvalEvent，作为 trace 证据。Agent 自己写"已拦截"无效，必须 harness 写。

**对 PM 的意义**：

- 历史上不少"奇怪行为"集中表现为这四类。ToolGuard 是用硬规则换稳定性，代价小、收益大。
- Hashline 已经覆盖了"必须 fresh read_range 才能 patch"这条规则，所以 v0.36 不再单独检查这一项，规则边界保持简洁。

### v0.4 — Context Runtime Freeze

v0.4 是一次有意义的"暂停整理"，对 L1 prompt 装配这一段冻结主干。冻结范围比完整 roadmap 小，目的是先稳住核心不变量。

**冻结范围内（已完成、已 eval）**：

- **L1 Tier Budget**：`minimal` / `standard` / `heavy` 三档，按场景分配每段 prompt 子区间的 token 预算。
- **ContextBuilder**：消费 pinned context 与 `RecallBundle`，按 section 独立预算截断，返回结构化 sections、估算 token、tier、被截断的 section 名。
- **WorkingMemory**：task-local 的结构化 pinned 状态（goal、phase、当前步骤、todos、读写文件、最近错误与信号、artifact refs）。
- **WorkingMemorySnapshot**：任务完成或 finalize 时抽出紧凑摘要 + 证据指针，写入 Run Archive。
- **Task Ledger**：任务级 pinned facts、rejected assumptions、open questions。拒绝项只 tombstone 不删，避免被反复"重新提出"。
- **RecallRouter**：构建 recall query，应用 `doNotApplyWhen` drop、Task Ledger rejection penalty；召回历史 WorkingMemorySnapshot 时排除当前 task/run。
- **Recall Scoring v2**：六维确定性打分（trigger / keyword / recency / relevance / metadata / evidence），按 tier 权重合成 `score.total`。
- **Run Archive Writer**：append-only 的 `events.jsonl` + `outcome.json`，包含 trace 聚合计数。
- **Lostness Detector**：基于近期信号与 turn 快照做确定性的"迷失感"识别，产出 soft / hard 信号。
- **/context Inspector**：只读诊断命令，输出当前 tier、WorkingMemory、Task Ledger、recall counts、top scoring item 等。
- **Trace Grader v0**：从 `events.jsonl` 读取 tool calls、写信号、验证命令、伪成功声明，做反作弊检查。

**明确不在 v0.4 范围内的**：

- Turn Intake LLM 自动抽取
- Doc Findings 写入流程
- Artifact Store
- Semble Code RAG 集成
- 真实 eval runner 自动接入 `events.jsonl`

这些已经登记到 v0.4x backlog，不阻塞 v0.4 发布。

**十条硬不变量（节选自冻结文档）**：

1. L1 每轮从输入和存储层重建，不继承上一轮 prompt。
2. ContextBuilder 不做检索，只消费 pinned + RecallBundle。
3. RecallRouter 不召回当前 task/run 的 WorkingMemorySnapshot。
4. Task Ledger 的 rejection 不物理删除。
5. Hard rejection 只能来自用户纠正或显式来源。
6. 已 remove 的 rejection 不渲染、不参与 recall penalty。
7. Recall ranking 使用 `score.total`，旧字段仅做兼容。
8. `/context` 必须只读，不写 memory。
9. Trace Grader 只读 `events.jsonl`，不修改 run archive。
10. Summary 可以进入 prompt，但 summary 不能是唯一记忆。

---

## 四、配套基础设施

除上面版本主线之外，这段时间还落了几块基础设施，是后续 eval / 进化的前提：

- **Run Archive MVP**：`runs/{runId}/events.jsonl` + `outcome.json`，是 Trace Grader 和未来 ablation eval 的原料。
- **Eval Framework**：新增 baseline runner、context-runtime runner、ablation runner、claude-code runner 与对应 scorer；`scripts/eval-*.ts` 一并提供 CLI 入口。
- **Ablation Eval RFC**（`docs/ablation-eval-rfc.md`）：在写具体 case 之前先把"测什么、为什么测、产出什么"四个设计问题定稿，避免一开始就把 eval 写歪。
- **Onboarding 指南**（`docs/onboarding.md`）：新人 60 分钟内能跑起来；附录里写了 README 的位置、环境变量、最常踩的坑。
- **Tool wrappers**：新增 student-agent 自己的 tool wrappers，对 pi 的接口做一层薄包装，便于 hooks 介入。

---

## 五、被移除的内容

减法和加法同样重要：

- **`/design` 命令与 design-study 子系统**（v0.31 引入）：使用频次低、维护成本高，且本身属于 UI 实现范畴，与"编程代理"的核心定位不完全一致。在 v0.33 阶段确认下线。
- **`docs/superpowers/`**：脱离 VCS。
- **Design Study Skill** 相关的 prompt / 候选池逻辑：随子系统一并退出主路径。架构文档 v0.32 中的"Design Study"章节在落地阶段未沉淀为长期能力，本次更新中明确归入归档。

> 如果未来确实需要"视觉风格学习"，建议作为独立 plugin / skill 重做，而不是回灌主代码库。

---

## 六、与 v0.32 架构的关系

v0.32 文档定义的核心模块大多仍然成立，但有几处对应关系值得记录：

| v0.32 模块 | v0.33–v0.4 的实际状态 |
|---|---|
| Stream Adapter + XState 120s 超时契约 | 仍然成立。v0.35 把工作流状态机正式落到 XState v5。 |
| 分层记忆（preferences / questions / design / docs-index） | preferences / questions 仍是主路径；design 相关已下线；新增 knacks.jsonl、lessons.jsonl、recall-index.json 等运行时记忆文件，由 RecallRouter 服务。 |
| Provenance + 信任状态机 | 保留。Run Archive 中的 ProtectedEvalEvent 也都带 source/provenance。 |
| Bounded Breaker | 框架仍在 `src/reflect/` 下，但 v0.4 优先级让位给 Run Archive，等 trace 数据成熟后再激活。 |
| 失败升级阶梯 | 三阶段不变，Hashline + ToolGuard 把"工具错误"这一类的预防成本前置了。 |
| Quality Watchdog | 仍在 `src/watchdog/` 下；信号源在 v0.4x 计划中接入 Run Archive 的 outcome.json。 |

---

## 七、面向 PM 的关键结论

挑出 PM/Stakeholders 在沟通中最常用的几条：

1. **路线收敛**：v0.33→v0.4 这一段没有追求"代理变得更聪明"，而是把"代理的行为可观察、可复盘、可验证编辑"这三件事先做到位。这是一切后续学习能力的前提。
2. **稳定性提升的来源是明确的**：TUI（v0.33）、Hashline（v0.34）、WorkingMemory + XState（v0.35）、ToolGuard（v0.36）这四档各自对应一类长期投诉。
3. **v0.4 Freeze 不等于"做完了"**：冻结的是 L1 prompt 装配主干和不变量。Turn Intake、Doc Findings、Artifact Store、Semble Code RAG 是已知 backlog，且都被论文校准（Meta-Harness、AHE、GAM、AEvo 等）驱动。
4. **裁掉了 design-study**：是一次主动减法，不是失败回退。
5. **下一阶段重心**：把 trace 接入真实 eval runner、用 ablation eval 量化每一个组件的边际贡献、把 Bounded Breaker 重新激活并接 Run Archive。

---

## 附录 A — 关键源码与文档索引

| 主题 | 位置 |
|---|---|
| Hashline 集成 | `src/core/hashline/`、`src/core/pi-bridge/student-file-tools.ts` |
| ToolGuard | `src/extension/hooks/tool-guard.ts` |
| 其他 hooks | `src/extension/hooks/`（file-guard、risk-guard、snapshot、quality-watchdog、reflect、memory、context-assembly、failure-escalation） |
| Working Memory | `src/memory/tasks/manager.ts`、`types.ts`、`task-ledger.ts` |
| XState 工作流机 | `src/memory/tasks/workflow-machine.ts` |
| Context Runtime | `src/memory/recall/`（context-builder、tier-selector、recall-router、scoring）、`src/memory/run-archive/`、`src/memory/signals/` |
| Eval 框架 | `src/evals/`、`scripts/eval-*.ts` |
| /context Inspector | `src/extension/commands/context-inspector.ts` |
| v0.4 冻结说明 | `docs/v0.4-context-runtime-freeze.zh.md`（中文）/ `.md`（英文） |
| Ablation Eval 设计 | `docs/ablation-eval-rfc.md` |
| 完整路线图 | `docs/student-agent-v0.4-v0.4x-alignment-roadmap-final.md` |
| v0.32 基线文档 | `docs/student-agent-architecture-v0.32.md` |

## 附录 B — 版本变更摘要（按时间倒序）

**v0.36**（2026-06-07）

- 新增 ToolGuard Hook：空 bash、自然语言 bash、过宽 glob、patch retry 四条硬规则。
- 与 FileGuard、RiskGuard 并列在 pre-tool hook 链。

**v0.35**（2026-06-07）

- Working Memory 扩展：`read_files` / `written_files` / `recent_errors`。
- XState v5 工作流状态机，22 个 status 的合法转移收敛到机器定义。

**v0.34**（2026-06-07）

- Hashline anchored edit；stale tag rejection；session 内 3-way merge 恢复。
- 与原有 git 级 SnapshotManager 并行运行。

**v0.33**（2026-06-04 ~ 2026-06-06）

- TUI v2 稳定化：滚动、流式状态、Tab 斜杠命令补全、面板可读性提升。
- `/design` 命令与 design-study 子系统下线。
- 让 LLM 在自然语言任务上分类任务复杂度，触发规划。
- Eval baseline harness 落地。
- Extension planning recovery、tool wrappers、hooks 中文化恢复指引。

**v0.4 Context Runtime Freeze**（2026-06-08 批量提交）

- L1 Tier Budget、ContextBuilder、WorkingMemory、WorkingMemorySnapshot、Task Ledger、RecallRouter、Recall Scoring v2、Run Archive Writer、Lostness Detector、`/context` Inspector、Trace Grader v0、Context Runtime Eval Audit 共 11 块同步冻结。
- 不在冻结范围：Turn Intake、Doc Findings、Artifact Store、Semble、真实 eval runner 自动接入。

---

*文档版本：2026-06-09 编写 | 与源码 commit `79ad7f64` 对齐*
