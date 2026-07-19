# Student-Agent v0.4 / v0.4x / v0.5 Architecture Roadmap (Final)

> **Paper-Calibrated Edition**
>
> 本文档基于以下 8 篇论文/项目的实际数据校准，不是概念推演：
>
> | 缩写 | 论文 | 核心贡献 | 状态 | 证据链接 |
> |------|------|----------|------|----------|
> | **Meta-Harness** | Meta-Harness: End-to-End Optimization of Model Harnesses | full traces >> scores-only（44% 差距） | 已工程化 | Run Archive / trace 溯源纪律（[v0.4 freeze](../v0.4-context-runtime-freeze.zh.md)、events.jsonl 路径） |
> | **AHE** | Agentic Harness Engineering (复旦/北大) | 三层 observability，组件非可加性，regression blindness | 未验 | — |
> | **Continual Harness** | Continual Harness: Online Adaptation (普林斯顿) | reset-free 在线自改进，capability floor | 未验 | — |
> | **LLMs Get Lost** | LLMs Get Lost In Multi-Turn Conversation | 2 轮即退化，unreliability +112%，recap 只恢复 15-20% | 在验 | C 组压缩探针（[probes/jspace-compaction](../probes/jspace-compaction/README.md)）、占位关案叙事 [BUG-011](../buglog.md) / 实档 [BUG-004](../buglog.md) |
> | **Skill1** | Unified Evolution of Skill-Augmented Agents via RL | selection/utilization/distillation 三路 credit，variation = r(τ) - Û | deferred | 见结账层 v0.4x-C：实战升格 = causal pair + harness（P1-E），variation 方案延后至主库 ≥10 |
> | **Autogenesis** | Autogenesis: A Self-Evolving Agent Protocol | RSPL/SEPL，evolvability marker，PS-Joint-Evo | 未验 | — |
> | **GAM** | General Agentic Memory Via Deep Research (智源) | JIT > AOT memory，Researcher 对模型规模敏感 | 未验 | — |
> | **AEvo** | Harnessing Agentic Evolution (港科大/DeepWisdom) | evolution as environment，meta-editing loop，evaluator 隔离防 reward hacking | 已工程化 | harness 外置判分 / SWE official harness（[ADR-001](../adr/ADR-001-eval-claim-separation.md)、eval runner） |
> | **GEP/Gene** | From Procedural Skills to Strategy Genes: Towards Experience-Driven Test-Time Evolution（arXiv:2604.15097；EvoMap/Evolver 理论基础） | 文档型 Skill 包控制不稳定、有用信号稀疏；紧凑 Gene 表示为 first-order factor，同预算胜过 Skill 片段；failure history 附着于 gene 更有效（4590 trials / 45 scenarios） | **部分已独立复现** | skill 泄漏见 buglog NOTE（knacks.jsonl 路径 vs lessons 门控）；保真度 v2 `5d0b6be4` / 关单注 `6b86eec5`；[ADR-004](../adr/ADR-004-knack-schema-v1.md) schema。相关结论于引用登记前独立得出，时间线见各证据 commit date。 |
>
> 外部项目依赖：
>
> | 项目 | 用途 |
> |------|------|
> | **@oh-my-pi/hashline** | content-hash anchored edit（MIT，纯 TS，无 runtime 耦合） |
> | **Semble** | code search（embedding + BM25 + RRF，MCP server） |
>
> 术语说明：代码和文档中的 "knack"（窍门）对应论文中的 "strategy gene / skill"。
> LLM 基础能力靠模型本身，knack 只是从错误中学到的辅助性窍门。

---

## 版本定位

```
v0.4  = Stable Harness + Run Archive + Verified Editing
v0.4x = Anti-Lost + Outcome Credit + Semble Code Search + Eval
v0.5  = Resource Evolution + Continual Harness + JIT Memory
```

一句话：

> **v0.4 不追求 agent 自进化，先做"可观察、可复盘、可验证编辑"的稳定 harness；
> v0.4x 用 Semble 提升定位能力、用 Anti-Lost 防多轮退化；
> v0.5 再让 harness 基于 Run Archive 和 evidence store 自我改进。**

### Context Runtime 上下文三分法

Context Runtime 的上下文分为三类：

**Pinned Context:**
- 每轮默认可用，但必须固定预算
- 包括 L2 Working Memory summary、Task Ledger / Current Task Spec、recent raw turns、current user message

**Retrieved Context:**
- 每轮按需召回，不默认全量注入
- 包括 Knacks、Doc Findings、Preferences、Artifact refs、Run Archive refs

**Drill-down Context:**
- 默认不进 prompt
- 只有主 LLM 明确需要时才读取
- 包括 full artifact、full run trace、full event、full file range、old user message 原文

硬规则：

```
L1 每轮从存储层重新构建，不继承上一轮 L1。
L2 summary 是 bounded state render，不是 rolling conversation summary。
Summary 可以进 prompt，但不能作为唯一记忆。
```

---

## 1. v0.4 Core Goal

v0.4 的目标是建立一个 **可观察、可恢复、可约束、可回归测试** 的 coding-agent harness。

```
能记录   — Run Archive MVP
能复盘   — HarnessChange + traceRefs
能定位失败 — Signal Pipeline + recentErrors
能安全改文件 — Hashline anchored edit
能验证组件贡献 — component ablation eval
```

### 1.1 v0.4 Core Scope

```
v0.33 TUI Stability
  ↓
Hashline-style Anchored Edit
  ↓
XState-aware Working Memory Storage
  ↓
ToolGuard Hook v0
  ↓
Signal Pipeline v0
  ↓
Lessons / Knacks v0
  ↓
Memory Store / Memory RAG Contract
  ↓
Recall Router v0
  ↓
ContextBuilder v0
  ↓
Lostness v0 (hard/soft triggers)
  ↓
Run Archive MVP
  ↓
HarnessChange + Eval before/after
  ↓
Eval Audit (ABA lightweight)
  ↓
Component Ablation Eval
  ↓
Integration Freeze
```

### 1.2 v0.4 Non-goal

```
- Semble 正式集成
- 完整语义代码搜索系统
- 完整 Anti-Lost Recovery Mode（Requirement Ledger / Current Task Spec / Restart Context）
- 完整 Run Archive（prompt snapshots / selected knacks / harness snapshot）
- Outcome-Credited Skills / EMA / NDCG rerank
- 完整 RL / Meta-Harness 自动优化
- Full Plan Mode
- Multi-session / subagent / long-running task
- 自动长期 memory 写入
- Continual Harness / GAM / Resource Evolution
```

但 v0.4 必须预留：

```
- code_search 抽象接口
- Signal / Lesson / Knack 的最小结构
- HarnessChange 记录格式
- ContextBuilder 的扩展点
- ToolGuard hook 的扩展点
```

---

## 2. v0.4 Roadmap

### v0.33: TUI / Trace Stability

目标：保证刚完成的 TUI 不被后续架构改动破坏。

Scope:

```
- UIState 四通道隔离：transcript/status/input/debug
- tool error 持久化
- pendingUserMessages
- debug-ui-events.jsonl
- 禁止业务层 stdout / console 污染 TUI
- 多行 paste
```

Acceptance:

```
- TUI 不闪烁
- 不吞输入
- status 不混入正文
- tool error 不只闪一下
- 任务运行中用户输入不会丢
```

---

### v0.34: Hashline Anchored Edit

目标：用 content-hash anchor 替代 old_text 复述，从根本上消除 whitespace 不匹配、stale read 后误 patch 的问题。

依赖：`@oh-my-pi/hashline`（MIT，纯 TypeScript，依赖仅 `diff` + `lru-cache`）

Scope:

```
- npm install @oh-my-pi/hashline
- 实现 StudentAgentFilesystem extends Filesystem
  - readText: 走现有 read 逻辑
  - writeText: 走现有 WriteQueue
- 使用 InMemorySnapshotStore（LRU 30 paths × 4 versions）
- read_range / search_text 返回时调用 SnapshotStore.record()，返回 ¶path#tag 格式
- edit tool 替换为 Hashline Patcher
- stale tag rejection → 写 signal → recentErrors
- recovery（3-way merge）成功 → 写 warning signal
- prompt.md 通过 ContextBuilder 注入（hashline 格式说明）
- 与现有 SnapshotManager (git checkpoint/rollback) 并行运行，不冲突
```

不引入的部分：

```
- oh-my-pi 的 agent runtime / TUI / provider routing
- ast_edit / ast_grep（v0.4x 考虑）
- BlockResolver / tree-sitter 块级编辑（v0.4x 考虑）
```

两个 Snapshot 层的区分：

```
Hashline SnapshotStore = 文件级 content hash，验证编辑锚点，session 级别
SnapshotManager = git-level checkpoint/rollback，灾难恢复，持久化
```

Eval Trace 输出契约：

```ts
// Hashline 实现时必须写入以下 ProtectedEvalEvent
{ source: 'hashline', type: 'stale_rejection', path, blocked: true }
{ source: 'hashline', type: 'recovery_success', path }
{ source: 'hashline', type: 'recovery_failure', path }
```

Acceptance:

```
- edit 不再需要模型精确复述 old_text
- stale file 编辑被 Hashline 自动拒绝（tag mismatch）
- recovery 3-way merge 在 session 内 chain edit 时自动生效
- stale rejection 和 recovery 事件写入 signal
- ProtectedEvalEvent 由 harness 写入 trace，不由 agent 写入
- output tokens 下降（参考 oh-my-pi: Grok 4 Fast -61%）
```

---

### v0.35: XState-aware Working Memory Storage

目标：L2 Working Memory 是 task-local pinned state，不走 RAG，不做向量召回。它由 XState lifecycle 维护，每轮渲染为 bounded summary 注入 L1。

存储位置：

```
Runtime data:
.student-agent/tasks/{taskId}/working-memory.json

Source:
src/memory/tasks/
```

类型定义：

```ts
type WorkingMemory = {
  taskId: string;
  runId: string;

  goal: string;
  phase: "planning" | "executing" | "verifying" | "reflecting";
  currentStep: string;

  todos: {
    id: string;
    content: string;
    status: "pending" | "in_progress" | "done" | "blocked";
    evidenceRefs?: string[];
    updatedAt: string;
  }[];

  readFiles: {
    path: string;
    ranges: {
      startLine: number;
      endLine: number;
      summary: string;
      hashlineTag?: string;
      readAt: string;
    }[];
    lastReadAt: string;
    lastKnownHash?: string;
  }[];

  writeFiles: {
    path: string;
    tool: "hashline_edit" | "write_file" | "format" | "other";
    summary: string;
    checkpointId?: string;
    writtenAt: string;
  }[];

  recentErrors: {
    id: string;
    source: "tool" | "toolguard" | "hashline" | "fileguard" | "runtime";
    pattern: string;
    summary: string;
    recoveryHint?: string;
    evidenceRef?: string;
    createdAt: string;
  }[];

  recentSignals: {
    id: string;
    kind: string;
    summary: string;
    severity: "low" | "medium" | "high";
    evidenceRef?: string;
    createdAt: string;
  }[];

  artifactRefs: {
    id: string;
    kind: string;
    summary: string;
  }[];

  updatedAt: string;
};
```

容量上限：

```
todos: max 8
readFiles: max 12
writeFiles: max 12
recentErrors: max 5
recentSignals: max 5
artifactRefs: max 10
```

核心函数：

```ts
loadWorkingMemory(taskId): WorkingMemory
updateWorkingMemoryAfterTurn(event): WorkingMemory
compressWorkingMemory(memory): CompressedWorkingMemory
renderWorkingMemoryForPrompt(memory, budget): string
```

Acceptance:

```
- working-memory.json 可落盘
- L2 不走 RAG，每轮作为 pinned context 渲染
- L2 summary 控制在固定 token budget 内
- L2 summary 不是聊天滚动摘要，而是当前任务状态表
- readFiles/writeFiles 可支持 read cache invalidation
- 重启后能恢复 goal/currentStep/recentErrors
- Working Memory phase 不和 XState phase 打架
```

---

### v0.36: ToolGuard Hook v0

目标：用硬规则挡住 agent 的低级坏行为。

Hashline 集成后的规则简化：

```
原规则 "patch 前必须 fresh read_range"
  → 由 Hashline tag 验证自动保证，ToolGuard 不再需要单独检查

原规则 "apply_patch 目标区间必须被 fresh read_range 覆盖"
  → 同上

保留规则 "patch retry guard"
  → 检测 re-read 后盲目重试同一 edit（相同目标 + 相同 failureKind）
```

Scope:

```
- 新增 src/extension/hooks/tool-guard.ts
- 注册到 src/extension/index.ts
- 与 RiskGuard/FileGuard 并列
- before-tool-execution 拦截空 bash、自然语言 bash、too broad glob
- patch failure fingerprint 防重复撞墙（基于 Hashline anchor 而非 old_text）
- 写操作复用现有 SnapshotManager
```

Eval Trace 输出契约：

```ts
// ToolGuard 实现时必须写入以下 ProtectedEvalEvent
{ source: 'toolguard', type: 'block', ruleName: 'empty_bash', blocked: true, shellSpawned: false }
{ source: 'toolguard', type: 'block', ruleName: 'nl_bash', blocked: true }
{ source: 'toolguard', type: 'block', ruleName: 'broad_glob', blocked: true }
{ source: 'toolguard', type: 'block', ruleName: 'patch_retry', blocked: true }
```

Acceptance:

```
- 空 bash = block
- 自然语言 bash = block
- **/*.ts 全项目 glob = block
- 同目标文件 + 相同 anchor range + 同 failureKind + 未重新 read = block
- Hashline stale rejection 自动生成 signal
- ProtectedEvalEvent 由 harness 写入 trace，不由 agent 写入
```

---

### v0.37: Signal Pipeline v0

目标：让工具失败、FileGuard block、ToolGuard block、Hashline rejection、用户自然负反馈都变成可追踪 signal。

Scope:

```
- 新增 src/memory/signals/
- tool failure / FileGuard block / ToolGuard block / Hashline stale rejection 写 signal
- after-tool hook 写 recentErrors
- Turn Intake fail-open
- signals 不直接变长期 memory
```

Turn Intake 实现规则（论文校准：LLMs Get Lost）：

```
Turn Intake model settings:
- temperature: 0 or near 0（低温减少单轮 unreliability 50-80%）
- structured output required
- fail-open: malformed JSON → TurnIntakeDegradedResult，不阻断主 turn
- no state transition authority: Turn Intake outputs proposal, not command
- XState owns state transition

注意：低温对单轮分类有效，但不能替代 Requirement Ledger / Current Task Spec
解决多轮退化问题（LLMs Get Lost 论文明确证明）。
```

Eval Trace 输出契约：

```ts
// Signal Pipeline 实现时必须写入以下 ProtectedEvalEvent
{ source: 'signal', type: 'tool_error', provenance, evidenceRef }
{ source: 'signal', type: 'fileguard_block', provenance, evidenceRef }
{ source: 'signal', type: 'toolguard_block', provenance, evidenceRef }
{ source: 'signal', type: 'hashline_rejection', provenance, evidenceRef }
{ source: 'signal', type: 'user_correction', provenance, evidenceRef }
{ source: 'signal', type: 'turn_intake_degraded', provenance }
```

Acceptance:

```
- tool error 进入 transcript + trace + signal + recentErrors
- Hashline stale rejection 进入 signal
- Turn Intake malformed JSON 不阻断主任务
- signal 有 provenance / evidenceRef
- ProtectedEvalEvent 由 harness 写入 trace，不由 agent 写入
```

---

### v0.38A: Memory Store / Memory RAG Contract

目标：明确 memory RAG 与 code_search 的区别。

```
Code RAG:
- 负责找代码在哪里
- backend = grep / ripgrep / Semble
- 输出 filePath / line range / snippet
- 流程是 code_search → read_range → hashline edit

Memory RAG:
- 负责找经验、策略、偏好、文档发现、历史证据
- backend = JSONL + metadata filter + trigger match + FTS/vector + weighted rerank
- 输出 knack / doc finding / preference / artifact ref / run archive ref
```

v0.4 存储：

```
.student-agent/memory/
  knacks.jsonl
  doc-findings.jsonl
  preferences.jsonl
  lesson-candidates.jsonl
  recall-index.json
```

v0.4 检索顺序：

```
1. metadata filter
2. trigger exact match
3. keyword / FTS
4. optional embedding similarity
5. weighted rerank
```

说明：

```
v0.4 可以复用已有 OpenAI embeddings，但 embedding 不应主导召回。
metadata / trigger first，embedding second，utility rerank final。
```

Acceptance:

```
- Knacks / Doc Findings / Preferences 都有统一 recall metadata
- memory RAG 不依赖 Semble
- Semble 只负责 code_search，不负责长期经验召回
```

---

### v0.38B: Recall Router v0

目标：根据当前任务状态、工具、错误、信号和 Task Ledger，从 L3/L0 召回相关内容，输出 RecallBundle 给 ContextBuilder。ContextBuilder 不负责检索，只负责组装 prompt。

输入：

```ts
type RecallRouterInput = {
  taskId: string;
  phase: string;
  goal: string;
  currentStep: string;

  nextTool?: string;
  currentFile?: string;

  recentErrors: WorkingMemory["recentErrors"];
  recentSignals: WorkingMemory["recentSignals"];

  taskLedger?: {
    confirmedRequirements: string[];
    constraints: string[];
    rejectedAssumptions: string[];
    openQuestions: string[];
  };

  recentRawTurns: {
    role: "user" | "assistant";
    content: string;
  }[];
};
```

输出：

```ts
type RecallBundle = {
  knacks: RecalledItem[];
  docFindings: RecalledItem[];
  preferences: RecalledItem[];
  artifactRefs: RecalledItem[];
  runArchiveRefs: RecalledItem[];

  diagnostics: {
    queryText: string;
    triggerMatches: string[];
    metadataMatches: string[];
    vectorMatches: string[];
    dropped: {
      id: string;
      reason:
        | "conflicts_with_task_ledger"
        | "low_score"
        | "stale"
        | "too_generic"
        | "counterexample_found";
    }[];
  };
};

type RecalledItem = {
  id: string;
  type:
    | "knack"
    | "doc_finding"
    | "preference"
    | "artifact_ref"
    | "run_archive_ref";

  summary: string;
  reason: string;

  score: {
    trigger: number;
    metadata: number;
    semantic: number;
    utility: number;
    recency: number;
    trust: number;
    final: number;
  };

  evidenceRefs?: string[];
};
```

初始加权公式：

```ts
finalScore =
  triggerScore * 0.35 +
  metadataScore * 0.25 +
  semanticScore * 0.15 +
  utilityScore * 0.10 +
  recencyScore * 0.05 +
  trustScore * 0.10;
```

v0.4 里 `utilityScore` 可以先为 0 或 raw count。v0.4x 再接 Outcome Credit / EMA / variation。

规则：

```
- L2 Working Memory 不被 Recall Router 召回，它是 pinned context。
- Task Ledger 不被 Recall Router 召回，它是 pinned task constitution。
- Recall Router 只召回 L3 / L0。
- 召回结果如果和 Task Ledger 冲突，必须 drop，并写入 diagnostics。
- RecallBundle 有 topK 和 token budget，不允许无限膨胀。
```

预算：

```
max knacks: 3
max doc findings: 2
max preferences: 2
max artifact refs: 3
max run archive refs: 2
```

Acceptance:

```
- recentErrors 中出现 EMPTY_COMMAND 时，可召回 empty bash / natural language bash 相关 knack
- current task 涉及 Hashline edit 时，可召回 hashline 相关 knack
- recalled item 与 Task Ledger 冲突时被 drop
- RecallBundle 可被 ContextBuilder 注入
- diagnostics 记录 retrieved / selected / dropped
```

---

### v0.38C: ContextBuilder v0

目标：ContextBuilder 不负责检索 memory。ContextBuilder 输入 pinned context + RecallBundle，输出 L1。

职责边界：

```
ContextBuilder 不负责检索 memory。
ContextBuilder 输入 pinned context + RecallBundle，输出 L1。
```

输入类型：

```ts
type ContextBuilderInput = {
  systemRules: string[];
  hashlinePromptBlock?: string;

  taskSpec?: string;
  workingMemorySummary: string;
  recentRawTurns: RawTurn[];

  recallBundle: RecallBundle;

  currentUserMessage: string;
  tokenBudget: number;
  tier: "minimal" | "standard" | "heavy";
};
```

L1 分三档：

```
Minimal L1:
- current user message
- task spec / current step
- recent raw turns N=1
- no or tiny recall

Standard L1:
- Minimal
- L2 working memory summary
- small RecallBundle

Heavy L1:
- Standard
- more artifact refs
- run archive refs
- lostness / error recovery context
```

触发规则：

```
simple user confirmation → Minimal
normal tool execution / coding → Standard
tool error / user correction / lostness / recovery → Heavy
```

Scope:

```
- 新增 src/core/context-builder/
- planning-prompt.ts 调用 ContextBuilder
- executing prompt 也调用 ContextBuilder
- 不替换 planning prompt
- 保留中文 prompt
- recent raw turns N=1~2
- artifact refs summary only
- Hashline prompt.md 作为固定注入块
```

设计原则（论文校准：Continual Harness capability floor）：

```
ContextBuilder 注入量不能无条件递增。
当 base model 能力较弱时（如 Haiku），应减少注入量，
避免 prompt 超出模型有效处理范围。

v0.4: 固定注入策略（按 model tier 分 2-3 档）
v0.4x: model-aware 动态预算（可选）
```

长期路线备注（论文校准：GAM）：

```
v0.4 ContextBuilder = template-based assembly (AOT)
v0.5+ ContextBuilder = JIT research over evidence store (GAM 方向)
  — 需要成熟的 Run Archive 作为 page-store
  — GAM 证明 Researcher 模块对模型规模敏感，不适合用小模型
  — AOT memory 有严重信息损失，JIT 在所有 benchmark 上显著更优
```

Acceptance:

```
- L1 每轮重建，不继承上一轮 L1
- L1 token budget 固定
- ContextBuilder 不直接读取 knacks.jsonl / run archive
- ContextBuilder 只消费 RecallBundle
- L1 不再无限 append 历史
- Current task context 可稳定注入
- Hashline 格式说明自动注入
- planning prompt 测试不被打挂
```

---

### Summary Policy

允许 summary：

```
1. L2 render summary
   - 用于 prompt 注入
   - 不替代 working-memory.json

2. artifact pointer summary
   - 用于 L1 中指向大输出
   - 不替代完整 artifact

3. run outcome summary
   - 用于快速看任务结果
   - 不替代 events.jsonl

4. recall result summary
   - 用于展示 recalled item
   - 不替代 evidenceRefs / full trace
```

禁止 summary-only：

```
1. 只存任务总结，不存 events.jsonl
2. 只存经验总结，不存 evidenceRefs
3. 只存 selected knacks，不存 retrieval diagnostics
4. 只存最终结果，不存 tool trace
5. 用滚动聊天摘要替代 L2 状态表
```

论文对齐：

```
Meta-Harness:
- scores + summary 几乎不够
- full traces 才是后续 harness 优化的关键原料

GAM:
- AOT static memory summary 有严重信息损失
- 应保留完整 page-store / evidence store
- 在线按需 JIT retrieve + integrate
```

硬规则：

```
summary can enter prompt, but summary must not be the only memory.
```

---

### v0.39: Lessons / Knacks v0

目标：只做最小 candidate knack 闭环，避免过早自动学习。

Scope:

```
- 新增 src/memory/lessons/
- 新增 src/memory/knacks/
- Reflect Agent 可产出 lesson candidate
- Bounded Breaker 在 lesson → knack 时运行
- high-severity counterexample 阻止进入 prompt
- candidate knack 默认不进 ToolGuard hard rule
```

Acceptance:

```
- 至少一条 signal 可变成 lesson candidate
- lesson candidate 可变成 candidate knack
- candidate knack 进入 prompt 前有 allowPromptInjection gate
- hard tool rules 仍然写代码，不依赖 knack
```

---

### v0.3A: Lostness v0 (Hard/Soft Triggers)

目标：用规则触发而非浮点 score 做第一版 lostness detection。

论文校准（LLMs Get Lost）：

```
论文核心发现：
- 多轮对话平均性能下降 39%，主要来自 unreliability 增加 112%
- 即使 2 轮对话就开始退化
- 推理模型（o3, R1）不能解决，反而产生 33% 更长响应和更多假设
- Recap / Snowball 缓解策略只恢复 15-20%

结论：不应等到累积分数达到阈值才触发，应基于信号类型立即响应。
```

设计（替代原文档的浮点阈值方案）：

Hard triggers（任一触发 → 立即刷新 Working Memory 中的 task context）：

```
- reusedRejectedAssumption = true
  （agent 使用了已被用户否定的假设）
- user explicitly corrects the same point twice
  （用户对同一点连续纠正两次）
- taskSpecMismatch confirmed by user correction
  （agent 的理解与用户需求不符，且被用户确认）
```

Soft signals（累积后升级）：

```
- answerBloat（响应过长但不推进任务）
- toolThrashing（短时间内反复调用同一工具）
- planOscillation（计划反复变更）
- repeatedQuestion（重复询问已确认信息）
- ignoredOpenQuestion（忽略未解决的问题）
- stagnation（HarnessChange 连续 N 轮无改善，AEvo Figure 3 启发）
```

Stagnation 信号（AEvo 校准）：

```
AEvo Figure 3 显示：
  OpenEvolve / HyperAgents 在 40-60 轮后 flatten
  AEvo 通过 meta-edit 跳出 plateau

启发：不只检测"迷路"，也检测"plateau"。
当连续 N 轮（N 待标定）没有可度量改善时，触发策略切换。
v0.4 仅写 signal，v0.4x 可触发 Recovery Mode 或 knack 切换。
```

执行策略：

```
Hard trigger:
  1. 写 rejectedAssumption / userCorrection 到 Working Memory
  2. 刷新 task context（goal / currentStep / constraints）
  3. 下一轮 ContextBuilder 必须优先注入更新后的 task context
  4. 写 lostness signal

Soft signals:
  1. 每次触发写 lostness signal
  2. 连续 N 轮（N=3）触发 soft signal → 升级处理
  3. v0.4x 有 Run Archive 后再标定 LostScore 浮点阈值
```

与 v0.4x Anti-Lost 的关系：

```
v0.4:  rule-based hard/soft triggers（本节）
v0.4x: 完整 Requirement Ledger / Current Task Spec / Recovery Mode / score-based
```

Acceptance:

```
- 用户纠正后，rejected assumption 被记录
- 后续输出不再沿用被否定假设
- hard trigger 发生时 task context 被刷新
- soft signal 连续 3 轮时有升级处理
```

---

### v0.3B: Run Archive MVP

目标：先有证据，再谈学习。没有 trace 的 eval 等于 scores-only。

论文校准（Meta-Harness + AHE）：

```
Meta-Harness:
  scores-only → 34.6 median
  scores + summary → 34.9 median
  full traces → 50.0 median
  结论：full traces 是关键原料，scores-only 几乎没用

AHE:
  agentic proposer 平均每轮读 82 个文件、引用 20+ 个历史候选
  结论：后续 harness 改进需要可访问的完整 trace
```

v0.4 MVP Scope（最小化）：

```
runs/{runId}/events.jsonl    — 所有 turn/tool/signal 事件的统一流
runs/{runId}/outcome.json    — 任务结果
```

events.jsonl 包含：

```
- tool calls（名称、参数摘要、结果状态）
- tool errors
- ToolGuard blocks
- Hashline stale rejections / recoveries
- user corrections
- lostness signals（hard + soft）
- state transitions
```

outcome.json:

```ts
type TaskOutcome = {
  taskId: string;
  runId: string;
  status: "success" | "partial" | "failed" | "cancelled";
  userAccepted?: boolean;
  userCorrectionCount: number;
  toolErrorCount: number;
  hashlineRejectionCount: number;
  hashlineRecoveryCount: number;
  repeatedToolCallCount: number;
  lostnessTriggerCount: number;
  finalSummary: string;
  evidenceRefs: string[];
  createdAt: string;
};
```

v0.4x 扩展（不在 v0.4 做）：

```
runs/{runId}/prompt-snapshots.jsonl
runs/{runId}/retrieved-knacks.json
runs/{runId}/selected-knacks.json
runs/{runId}/requirement-ledger.json
runs/{runId}/current-task-spec.md
runs/{runId}/lostness.json
runs/{runId}/restart-context.md
runs/{runId}/harness-snapshot.json
```

结构化查询支持（AEvo 校准）：

```
AEvo 的 observation function Φ(r, C_r) 从累积上下文中提取
进度、重复失败、无效尝试、冗余搜索方向等信息。
这要求 Run Archive 不只是追加式 log，还需要支持：

v0.4 MVP:
  - 按事件类型过滤（tool_error / hashline_rejection / user_correction / ...）
  - 按时间范围过滤
  - outcome.json 的字段查询

v0.4x:
  - 按 component 过滤
  - 按 outcome 过滤
  - 跨 run 聚合查询（某组件在多次 run 中的表现趋势）
```

Acceptance:

```
- 任意一次任务结束后，可以回看这次任务发生了什么
- 能定位用户纠正发生在哪一步
- 能定位工具失败和 lostness trigger 触发点
- HarnessChange 可以通过 traceRefs 关联到 events.jsonl
- 可按事件类型和时间范围过滤 events.jsonl（AEvo Φ function）
```

---

### v0.3C: HarnessChange + Eval Before/After

目标：架构改动不能靠感觉，必须有 prediction 和 eval 对比。

论文校准（AHE）：

```
AHE regression blindness:
  fix prediction 精度 33.7%（5x random）
  regression prediction 精度 11.8%（仅 2x random）
  结论：预测改进比较可靠，预测退化几乎不行
  启发：必须强制记录 regressionRisk，即使不准也比不记好
```

HarnessChange Schema:

```ts
type HarnessChange = {
  id: string;
  targetComponent: string;
  rationale: string;
  prediction: string;
  regressionRisk: string[];       // AHE 启发：强制列出可能退化的场景
  expectedMetrics: Record<string, string>;
  risk: string;
  runRef: string;                 // runs/{runId}
  traceRefs: string[];            // 关联 events.jsonl 中的 eventId
  evalBefore?: Record<string, number>;
  evalAfter?: Record<string, number>;
  status: "proposed" | "applied" | "verified" | "reverted";
  createdAt: string;
  verifiedAt?: string;
};
```

Eval 指标：

```
- 重复 read 次数
- 空 bash 次数
- Hashline stale rejection 次数
- Hashline recovery 次数
- patch 重试次数
- tool error signal 数量
- lostness trigger 数量
- output tokens per task
```

ProtectedEvalEvent 类型定义（v0.34-v0.37 的输出契约在此统一）：

```ts
interface ProtectedEvalEvent {
  source: 'hashline' | 'signal' | 'toolguard';
  type: string;
  path?: string;
  ruleName?: string;
  provenance?: unknown;
  evidenceRef?: string;
  blocked?: boolean;
  shellSpawned?: boolean;
  timestamp: string;
}
```

Trace Grader（在 v0.3C 实现）：

```
Eval 不能只看 test.sh 的文件结果，还要看 harness 记录的过程证据。

test.sh = 检查 sandbox 最终文件状态
trace grader = 检查 ProtectedEvalEvent 过程证据
两者都过，eval 才算 pass

实现位置：扩展现有 src/evals/scorer.ts
读取：StudentAgentEvalTrace.protectedEvents
判定：每个 trace-bound eval case 有对应 grader 函数

示例 grader：
  toolguard-empty-bash:
    blocked == true AND shellSpawned == false → PASS
  hashline-stale-reject:
    hashline_rejection count == 1 AND signal event count >= 1 → PASS
  signal-tool-error:
    tool_error event exists AND provenance non-empty → PASS

防 exploit：
  agent 写 report.md 说 "blocked: yes" 但 trace 里没有 block event → FAIL
  agent 直接重写文件绕过 hashline 但 trace 里没有 rejection → FAIL
```

Acceptance:

```
- 每个 harness change 有 rationale / prediction / regressionRisk
- 每个 change 关联到 Run Archive（runRef + traceRefs）
- 至少跑一组 baseline 对比
- trace grader 对 3 个核心组件（hashline / toolguard / signal）可判分
- fabricated report（agent 伪造结果文件）被 trace grader 判 FAIL
```

---

### v0.3C½: Eval Audit (Checklist + ABA)

目标：在 eval case 冻结前，检查 eval 质量。你自己还在积累 eval 经验，需要外部标准。

审计方法（三层，v0.4 全部人工执行）：

```
第一层：MMLU-Redux 三问（对每条 eval case）
  1. input 是否有歧义？（两种合理理解导致不同结果）
  2. expectedBehavior 是否真的正确？（你确定这是唯一正确行为吗）
  3. passCondition 是否太窄或太宽？
     太窄 = 正确实现被判 fail
     太宽 = 错误实现能 pass

第二层：ABA 六维度（对每个 eval 文件整体）
  - instruction ambiguity / underspecification
  - environment conflict（eval 环境是否可复现）
  - tests too narrow / too broad
  - hidden implementation requirements（tests 要求 instruction 没说的东西）
  - incorrect or incomplete ground truth
  - evaluation exploit（能否不做正事但 pass）

第三层：Trace Grader 验证（对每个 trace-bound case）
  - initial env → FAIL
  - oracle solution → PASS
  - fabricated report（agent 伪造结果文件）→ FAIL
  - known-bad（坏方法）→ FAIL

参考工具：https://github.com/IsThatYou/auto-bench-audit（可选，外部 CLI）
参考论文：MMLU-Redux（arXiv 2406.04127），Eval Factsheets（arXiv 2512.04062）
```

v0.4 做法：

```
1. 100 条 case 人工过 MMLU-Redux 三问（1-2 天）
2. 12 个 eval 文件过 ABA 六维度（半天）
3. trace-bound case 跑一次 oracle/known-bad/fabricated 验证
4. 可选：本地 clone auto-bench-audit 跑 static mode 做交叉验证
5. 审计记录存入 evals/audit/
```

v0.5 演进方向：

```
eval 数量 > 50 或自进化迭代频率超出人工 review 时：
  - 轻量化内置 ABA（~300-500 行 TypeScript）
  - 提取 rubric + static audit prompt + TaskAuditFinding 模型
  - 用 student-agent 自己的 LLM call
  - 作为 CommitGate 的 Gate 2 自动运行
```

Acceptance:

```
- 所有 v0.4 eval case 在冻结前过完三层审计
- MMLU-Redux 三问无"是"的 case（或已修复）
- ABA 六维度无 severity 2（或已修复）
- trace-bound case 的 fabricated report 验证全部 FAIL
- 审计记录存入 evals/audit/
```

---

### v0.3D: Component Ablation Eval

目标：验证 v0.4 各组件的实际贡献，防止组件堆叠退化。

论文校准（AHE）：

```
AHE 组件 ablation 发现：
- system prompt alone = -2.3pp（退化）
- memory only = +5.6pp
- tool only = +3.3pp
- middleware only = +2.2pp
- 三个正向组件增益之和 +11.1pp > 全部组合实际增益 +7.3pp
- 结论：组件交互是非可加的，stacking 可能退化
```

Scope:

```
- 至少跑一组组件单独开/关的 ablation：
  - ToolGuard only
  - ContextBuilder only
  - Signal Pipeline only
  - Hashline only
  - 全部组合
- 确认组合效果 >= 各组件单独效果（或明确记录交互损失和原因）
- 结果写入 changes.jsonl
```

Acceptance:

```
- 每个组件有单独的 pass/fail 数据
- 组合效果和单组件效果有可比较的 eval 数据
- 若组合退化，有明确记录和分析
```

---

### v0.3E: Integration Freeze

目标：冻结接口，修 regression，不继续加大模块。

Scope:

```
- 删除重复概念
- 文档对齐 src 路径
- 冻结 ToolGuard / ContextBuilder / Signal / Hashline 接口
- 冻结 Run Archive events.jsonl schema
- 只修 regression
- 不加新大模块
```

Acceptance:

```
- v0.4 主线可用
- TUI 稳定
- Hashline edit 生效
- ToolGuard 生效
- ContextBuilder 生效
- Run Archive 有数据
- Eval 可复现行为改善
- Component ablation 完成
```

---

## 3. Code Search Decision

### 3.1 v0.4: Interface Only

```
v0.4 只预留 code_search 抽象接口，默认 grep/ripgrep：

type CodeSearchBackend = "grep" | "ripgrep" | "semble" | "custom";

type CodeSearchQuery = {
  query: string;
  repoPath: string;
  scope?: string[];
  language?: string;
  topK?: number;
  backend?: CodeSearchBackend;
};

type CodeSearchResult = {
  backend: CodeSearchBackend;
  filePath: string;
  startLine?: number;
  endLine?: number;
  snippet: string;
  score?: number;
  reason?: string;
};
```

### 3.2 v0.4x-D: Semble Code Search Upgrade

Semble 评估结论：

```
Semble 不是单一 embedding backend，它内部已包含：
- tree-sitter code-aware chunking
- Model2Vec potion-code-16M semantic search
- BM25 lexical search
- Reciprocal Rank Fusion (RRF) 融合
- 代码感知 reranking（definition boost, identifier stems, file coherence, noise penalty）

性能数据：
- NDCG@10 = 0.854（CodeRankEmbed 137M 的 99%）
- 索引 250ms，查询 1.5ms，全 CPU
- 98% 比 grep+read 省 token
- 2k token 达到 94% recall

接入方式：MCP server（优先）或 CLI
工具：search（自然语言/代码查询）+ find_related（语义相似代码）
```

v0.4x-D Scope:

```
Default:
  code_search = Semble (via MCP server)

Flow:
  search(query)
  ↓
  read_range(top result)  ← Hashline SnapshotStore.record() 注册 tag
  ↓
  find_related(file, line) ← 找相关调用方/测试
  ↓
  read_range(related files) ← 注册 tag
  ↓
  edit (hashline anchor)

Fallback (Semble 不可用时):
  search_text / grep
  ↓
  scoped ripgrep
```

Semble + Hashline + Run Archive 的协作关系：

```
Semble  → 负责找到该读哪里
Hashline → 负责确保改的位置没错
Run Archive → 负责记录为什么这么找、这么改
```

Eval 指标：

```
- 首次命中目标文件工具调用数
- read_many 次数
- full read 次数
- read_range 占比
- token 消耗
- Semble fallback 率
- find_related 命中调用方/测试的比例
- Hashline edit 成功率
- Hashline stale anchor 率
```

Acceptance:

```
- Semble 不可用时任务不中断
- fallback 可追踪
- eval 证明 Semble 真的减少乱读和 token 消耗，否则不设为默认 backend
```

---

## 4. v0.4x Roadmap

v0.4x 不是开启 0.5，也不是推翻 0.4，而是在 v0.4 稳定闭环上补充增强能力。

---

### v0.4x-A: Anti-Lost Multi-Turn Context

目标：在 v0.4 的 hard/soft trigger 基础上，建立完整的 anti-lost 系统。

Scope:

```
- Requirement Ledger
- Current Task Spec
- Minimal Active Projection（External J-space 实验；派生视图，不是新事实源）
- Lostness Monitor (score-based, calibrated from Run Archive)
- Recovery Mode / Restart Context / Compaction Recovery Eval
```

#### Requirement Ledger

```ts
type RequirementLedger = {
  taskId: string;
  goal: string;
  currentStage: string;
  confirmedRequirements: RequirementItem[];
  constraints: ConstraintItem[];
  openQuestions: OpenQuestion[];
  changedRequirements: ChangedRequirement[];
  rejectedAssumptions: RejectedAssumption[];
  lastUserCorrections: UserCorrection[];
  nextStepOnly?: string;
  confidence: number;
  updatedAt: string;
};
```

#### Current Task Spec

进入 L1 的核心任务说明：

```md
# Current Task Spec

## User Goal
...

## Current Stage
...

## Confirmed Requirements
- ...

## Constraints
- ...

## Rejected Assumptions
- Do not assume: ...

## Open Questions
- ...

## Next Step Only
...
```

ContextBuilder 注入顺序：

```
L1 =
  system rules
+ Hashline prompt.md
+ Current Task Spec
+ L2 working memory summary
+ selected L3 knacks
+ selected L0 artifact refs
+ recent raw turns
+ current user message
+ turn-specific constraints
```

#### Minimal Active Projection（External J-space 实验）

定位：从 Requirement Ledger、Current Task Spec、Working Memory 与最新 Observation
确定性编译出的临时活跃投影。它不建立新的持久层，不替代上述事实来源，也不使用
`v0.5` 版本号；v0.5 继续专指 Resource Evolution。

第一阶段只投影：

```text
goal
successConditions
constraints
rejectedPaths
nextAction
```

`currentStage` 继续由 Current Task Spec 提供，避免用 `nextAction` 猜测任务阶段。

实施与评测顺序：

```text
P4.1  Requirement Ledger + Current Task Spec
      先修复状态来源、任务边界和 currentStep/phase 一致性。

P4.2  Minimal Active Projection
      只做确定性派生与容量限制；不做逐轮模型 Patch，不增加第二套事实库。

P4.3  Compaction Recovery Eval
      基线必须是 Pi built-in compaction；实验臂增加 pinned projection 恢复。
      比较目标/约束/拒绝路径恢复率、重复失败路径、任务成功率与总成本。

GO gate
      只有 P4.3 证明相对 Pi built-in compaction 有明确增益，才评估按需增量 Patch。
```

请求尾部注入、`cache_control` breakpoint 和最终 provider payload 断言属于 Pi 适配层；
应在 [pi 后继包迁移计划](plan-pi-successor-migration.md) 的 compatibility adapter 完成后接入，避免绑定已弃用
的 `@mariozechner/pi-*` 0.73.1 内部结构。

#### Lostness Monitor (v0.4x score-based)

在 v0.4 hard/soft trigger 基础上，增加浮点 score：

```
score 由 Run Archive 数据标定，不是先验设置

标定方法：
1. 从 Run Archive 中提取 hard trigger / soft signal 事件
2. 与 outcome (success/partial/failed) 关联
3. 用实际数据设定 score 阈值

初始阈值（待标定后调整）：
0.0 - 0.3：正常
0.3 - 0.6：轻度迷路，强制刷新 Current Task Spec / Minimal Active Projection
0.6 - 0.8：明显迷路，生成 Restart Context
0.8 - 1.0：严重迷路，丢弃当前计划，从 Restart Context 重新开始
```

#### Restart Context

```md
# Restart Context

## User Goal
...

## Current Stage
...

## Confirmed Requirements
- ...

## Rejected Assumptions
- ...

## Do Not Do
- ...

## Next Step Only
...
```

Acceptance:

```
- 用户纠正后，rejected assumption 被记录
- 后续输出不再沿用被否定假设
- lost_score >= 0.6 时生成 restart-context.md
- Recovery 后下一步和 Current Task Spec 对齐
- score 阈值有 Run Archive 数据支撑
- Compaction 恢复实验以 Pi built-in compaction 为基线，不使用“无 checkpoint”伪基线
- Incremental Patch 未通过 P4.3 GO gate 前不得进入默认运行时
```

---

### v0.4x-B: Run Archive Full

目标：在 v0.4 MVP 基础上扩展完整归档。

Scope:

```
在 v0.4 MVP（events.jsonl + outcome.json）基础上增加：

runs/{runId}/prompt-snapshots.jsonl   — 每轮实际发送给模型的 prompt 摘要
runs/{runId}/retrieved-knacks.json     — 被检索到的 knacks
runs/{runId}/selected-knacks.json      — 被注入 prompt 的 knacks
runs/{runId}/requirement-ledger.json  — 任务结束时的 requirement ledger 快照
runs/{runId}/current-task-spec.md     — 任务结束时的 task spec
runs/{runId}/lostness.json            — lostness 事件和 score 序列
runs/{runId}/restart-context.md       — 若触发 recovery，记录 restart context
runs/{runId}/harness-snapshot.json    — ToolGuard rules / ContextBuilder config / active knacks
```

Acceptance:

```
- 可以回看任意任务的 prompt 构成
- 可以对比不同 harness 配置下的表现
- harness-snapshot 支持 bootstrap-updating（Continual Harness 论文启发）
```

---

### v0.4x-C: Outcome-Credited Skills / Knacks

目标：让 L3 不是静态经验库，而是带效果统计的策略库。

论文校准（Skill1）：

```
Skill1 核心机制：
- selection/utilization/distillation 三路信号共享 task-outcome credit
- distillation credit = variation = r(τ) - Û（只有超过库均值才产出新技能）
- 去掉 library = -16.6 points
- 去掉 distillation = -5.1
- 去掉 selection = -5.7

启发：
1. SkillUsageEvent 需要 baseline variation
2. 新 knack/lesson 升格应看 variation，不是只看一次 outcome
3. utility 权重应渐进提升，不急于提高
```

Skill Usage Event:

```ts
type SkillUsageEvent = {
  id: string;
  taskId: string;
  runId: string;
  skillId: string;
  skillType: "knack" | "doc_finding" | "preference";
  retrieved: boolean;
  selectedIntoPrompt: boolean;
  explicitlyFollowed: boolean;
  retrievalReason?: string;
  usageEvidence?: string;
  baselineExpectedOutcome?: number;  // Skill1 启发：库均值
  observedOutcome?: number;          // 实际结果
  variation?: number;                // observedOutcome - baselineExpectedOutcome
  outcome: "positive" | "negative" | "neutral" | "unknown";
  outcomeReason?: string;
  createdAt: string;
};
```

Utility 权重渐进策略：

```
v0.4x early:
  raw counts + baseline variation only
  不用 EMA
  variation > 0 的 lesson 才能升格为 candidate knack

v0.4x mid:
  样本数 >= 3 时 utilityRatio 轻权重 0.10-0.15
  开始积累 EMA 数据

v0.4x late:
  样本数 >= 10 后 utility 权重提高到 0.20-0.25
  考虑 NDCG-like ranking signal
```

Acceptance:

```
- 能回答：某条 Knack 上次被召回后是否帮助任务成功
- 多次失败的 knack 权重下降
- 新 knack 升格需要 variation > 0（超过库均值）
```

---

### v0.4x-D: Code Search Upgrade with Semble

（详见 §3.2）

---

### v0.4x-E: Project Bootstrap

目标：进入项目时不要从零开始 ls、grep、猜结构。

Scope:

```
- project-snapshot.md
- package manager
- available scripts
- framework
- source tree summary
- important config files
- test/lint/build command
- recent modified files
```

Acceptance:

```
- 新任务开始时可直接注入 Project Snapshot
- 减少重复项目探索
- 不排在 Requirement Ledger / Current Task Spec 前面
```

---

### v0.4x-F: Small Eval Sets

目标：避免靠感觉优化。

```
evals/
  anti_lost_cases.json
  memory_recall_cases.json
  tool_guard_cases.json
  hashline_cases.json
  tui_stability_cases.json
  run_archive_cases.json
  code_search_cases.json
```

Acceptance:

```
- 可以对比 Current Task Spec 开关前后表现
- 可以对比 grep/read_many vs Semble/read_range
- 可以量化 lostness / repeated question / tool thrashing 是否下降
- 可以量化 Hashline stale rejection / recovery 比例
```

### v0.4x-G: Memory Recall Eval Metrics

```
Memory Recall Eval Metrics:
- relevant_knack_recalled
- irrelevant_knack_injected
- rejected_assumption_conflict_dropped
- doc_finding_recalled_when_library_detected
- preference_recalled_when_task_matches
- recall_bundle_token_size
- recall_precision@k
- recall_hit_before_tool_error
- recall_diagnostics_written
```

特别关注：

```
tool error 发生前，是否已经召回相关 knack。
```

例如：

```
- bash EMPTY_COMMAND 失败前是否召回 empty bash guard knack
- hashline stale rejection 后是否召回 hashline recovery knack
- user correction 后是否 drop 与 Task Ledger 冲突的 old knack
```

---

### v0.4x-H: Project Development Archive + Human Dashboard

目标：让 Student-agent 在它工作的**每个目标项目**中发现、初始化并持续维护项目级
INDEX、ADR、buglog 和人类可读 HTML dashboard，而不是只在 student-agent 自己的
仓库中维护开发档案。

本仓库现有的 `docs/INDEX.md`、`docs/buglog.md`、`docs/adr/` 和
`scripts/build-dashboard.ts` 只作为 reference implementation，不是唯一支持的目录结构。

#### Project archive discovery

进入目标仓库时按以下优先级解析档案位置：

1. 项目配置显式声明，例如 `.student-agent.json` 的 `archive` 配置；
2. 采用项目已有约定，例如 `docs/adr/`、`docs/decisions/`、`docs/buglog.md`；
3. 若项目没有档案结构，默认初始化：

```text
docs/agent/
  INDEX.md
  buglog.md
  adr/
    ADR-001-*.md
  dashboard.html        # generated，不手工编辑
```

初始化必须是显式操作或由项目规则允许，不能在普通问答时擅自向目标仓库增加 docs。

#### Archive trigger policy

Student-agent 不应为每个小修改写档案，只在出现稳定项目知识时维护：

| 事件 | 档案动作 |
|---|---|
| 存在多个可行方案并作出长期架构选择 | 创建/更新 ADR |
| 发现可复现缺陷 | 创建 OPEN bug entry |
| 根因得到证据 | 向 bug entry 追加 root cause |
| 修复且 targeted verification 通过 | 更新 bug 状态并绑定验证证据 |
| 版本、里程碑、重要功能或关键回归完成 | 向 INDEX 追加时间轴条目 |
| 任务只是文案、小配置或无长期价值的一次性操作 | 不写档案 |

ADR 的 `accepted` 必须来自用户明确决策、项目既有决策或已批准计划；Agent 可以自动创建
`proposed` ADR，但不能把自己的偏好伪装成已采纳决策。

#### Task lifecycle integration

```text
Project Bootstrap
→ 发现 archive policy 和已有 INDEX/ADR/buglog
→ 将相关条目加入 Project Snapshot / task context

Task executing
→ 发现 bug 或架构决策时记录 pending archive action

Technical verification
→ 将 test/build/eval/diff evidence 绑定到 pending entry

Task completion
→ 原子更新 canonical Markdown
→ 校验 ID、状态、链接和证据
→ 重新生成 project dashboard.html
→ final summary 报告新增/更新了哪些档案
```

档案维护失败不应让已经正确完成的低风险代码任务无限卡住：内容冲突或 parser failure
记录为 archive warning；只有会造成历史覆盖、错误关闭 bug 或破坏现有档案时才阻塞完成。

#### Student-agent commands and tools

命令必须与目标项目使用的语言和 package manager 无关：

```text
/archive status
/archive init
/archive check
/archive build
/archive adr new <title>
/archive bug open <title>
/archive bug update <id>
```

内部工具建议：

```text
ArchiveDiscover
ArchiveRead
ArchiveAppendTimeline
ArchiveCreateAdr
ArchiveUpdateBug
ArchiveValidate
ArchiveRenderHtml
```

写操作继续经过 FileGuard、RiskGuard、SnapshotManager 和 WriteQueue；不得使用独立旁路写文件。

#### Canonical data and HTML view

1. **Markdown canonical，HTML derived**：Markdown 可 review、diff、merge；HTML 不接受手工编辑。
2. **采用而非覆盖**：目标项目已有 ADR/bug 模板时，先解析并遵循现有格式。
3. **历史不可静默改写**：关闭 bug、supersede ADR 和修订决策以追加记录完成。
4. **跨链接**：INDEX、ADR、bug、任务、commit、验证证据相互可导航。
5. **静态 HTML**：无服务端、无数据库、无需目标项目安装前端工具链。

每个项目的 HTML 至少提供：

```text
- Overview：项目档案统计、当前 OPEN bugs、最近决策和 next action
- Timeline：版本、里程碑、commit、关联 ADR/BUG/task
- Bugs：状态/严重度/模块筛选，展开症状、根因、修复、遗留和验证
- ADRs：proposed/accepted/superseded 状态、替代方案、后果和实现链接
- Verification：最近 build/test/eval evidence，不把 Agent 声明当事实
- Search：按 ID、模块、文件和关键词过滤
```

#### Validation

`ArchiveValidate` 至少验证：

- ADR/BUG ID 唯一，新增 ID 不覆盖历史文件；
- 必填字段和状态值合法；
- accepted ADR 有决策来源；
- CLOSED/FIXED bug 有修复或处置证据；
- INDEX、ADR、bug 和 evidence 内部链接存在；
- dashboard 与 canonical sources 的条目数量和状态一致；
- HTML 正确转义项目内容，不能把日志/issue 文本注入可执行脚本；
- 同一次 task completion 重试是幂等的，不重复追加时间轴和 bug 状态。

Acceptance：

```text
- Student-agent 能在非 Node 项目中初始化并维护默认 archive
- 能采用一个已有自定义 ADR 目录，而不是强制迁移格式
- 修复任务可自动完成 OPEN → root cause → FIXED/CLOSED 的证据链
- 架构任务可生成 proposed ADR，并在用户批准后更新为 accepted
- 任务恢复后不会重复创建同一 ADR/BUG/INDEX entry
- Markdown 与 HTML 数量、状态和链接一致
- dashboard 在 500 ADR + 1000 bug + 5000 timeline entries 下仍能离线打开和搜索
- archive check + HTML build 在普通项目规模下目标 < 2 秒
```

Non-goal：

- 不把 HTML 变成第二套编辑器或事实存储；
- 不要求所有目标项目采用相同 Markdown 模板；
- 不自动批准架构决策；
- 不为普通档案更新启动 ralplan、Team 或多 Reviewer；
- 不把一次性调试日志全部写进长期项目档案。

---

## 5. v0.4x-late / v0.5: Resource Evolution

### 5.1 Autogenesis Conclusion

```
Autogenesis / AGP 对 student-agent 的启发：
1. 把 prompt、tool、hook、memory、knack、context policy、code_search backend 都视为可登记资源
2. 自进化不能直接修改系统，必须经过 Reflect → Select → Improve → Evaluate → Commit
3. 每个可演化资源都需要 version、lineage、rollback target、safety invariants
4. Commit 不是"写进去"，而是通过 eval 和安全检查后才接受
5. 没有 Run Archive / Outcome Credit / Eval，就不应该做自动 self-evolution
```

### 5.2 EvolvabilityPolicy vs EvolvabilityMarker

论文校准（Autogenesis evolvability marker）：

```
区分两个概念：

EvolvabilityPolicy = 静态权限控制
  "谁有权改这个资源"
  v0.4x-late 实现

EvolvabilityMarker = 动态搜索空间约束
  "这个资源在当前状态下是否值得被改"
  v0.5 考虑

Autogenesis 论文的 PS-Joint-Evo（同时演化 prompt 和 system）
显著优于单策略演化，说明演化空间的选择本身需要优化，
不只是一个静态权限表。
```

v0.4x-late: 只实现 EvolvabilityPolicy

```ts
type EvolvabilityPolicy = {
  resourceId: string;
  canReflect: boolean;
  canSuggestChange: boolean;
  canAutoApply: boolean;
  requiresUserApproval: boolean;
  requiresEvalPass: boolean;
  requiresCommitGate: boolean;
};
```

v0.5 备注: EvolvabilityMarker

```
EvolvabilityMarker 是 Autogenesis 的 evolvability marker (gτ,i) 的对应物。
它是资源本身的属性——"当前是否值得被演化"——而非管理策略。
具体类型定义在 v0.5 设计时确定。
应由 Run Archive / Outcome Credit 数据驱动，动态更新。
```

### 5.3 Resource Safety Policy

```
ToolGuard hard rule:
  canAutoApply = false
  requiresUserApproval = true
  requiresEvalPass = true
  requiresCommitGate = true

ContextBuilder policy:
  canSuggestChange = true
  canAutoApply = false
  requiresEvalPass = true
  requiresCommitGate = true

Knack candidate:
  canReflect = true
  canSuggestChange = true
  canAutoApply = false
  requiresCommitGate = true before validated

Code Search backend default switch:
  canSuggestChange = true
  canAutoApply = false
  requiresEvalPass = true
  requiresCommitGate = true

Eval case（AEvo evaluator 隔离启发）:
  canReflect = true
  canSuggestChange = true
  canAutoApply = false
  requiresUserApproval = true
  requiresEvalPass = false    // eval 不能用 eval 验证自己
  requiresCommitGate = true
```

### 5.3.1 Evaluator 隔离原则（AEvo 校准）

论文校准（AEvo）：

```
AEvo ablation Table 3:
  Full system = 1138 cycles, 0 reward hacking
  去掉 evolution harness = 2/3 runs reward hacking, 结果无效

AEvo meta-agent hard rules:
  Forbidden:
    - edit 'candidates/' directly
    - call 'oer-eval eval' directly
    - bypass the gateway or evaluator

结论：evaluator 必须与 agent 隔离，否则 agent 会 gaming 评分。
```

映射到 student-agent 的隔离边界：

```
Agent 可编辑（meta-editing surface）:
  OK  ToolGuard rules
  OK  ContextBuilder config
  OK  Knacks
  OK  prompt template
  OK  session goal / notes
  OK  起草 eval case（需 human review 后冻结）

Agent 不可编辑（harness-protected）:
  NO  已冻结的 eval case 定义（evals/*.json）
  NO  eval runner 脚本
  NO  eval 打分逻辑
  NO  outcome.json 的写入权限
  NO  CommitGate 的 pass/fail 判定
```

CommitGate 设计原则：

```
v0.4x CommitGate 的 eval 结果必须由 harness 提供。
agent 不能自己声称 eval 通过。
eval 结果写入 Run Archive 后，agent 可以读取（AHE: full traces 必要），
但不能修改。

这与 AHE 不冲突：
  AHE 允许 agent 读 82 个文件 / 引用 20+ 历史候选 → OK
  AEvo 禁止 agent 改 evaluator / 写分数 → OK
  两者共识 = agent 可以改机制，不能改裁判
```

### 5.4 Continual Harness + AEvo Meta-Editing 方向（v0.5）

```
普林斯顿 Continual Harness 的核心机制：
- 每 F 步 Refiner 对 (prompt, sub-agents, skills, memory) 做 4-pass CRUD
- reset-free：改动直接注入当前运行
- bootstrap-updating（继承 + 继续改进）始终优于 from-scratch
- capability floor：弱模型加 harness 反而变差
```

AEvo meta-editing loop（可替代 Continual Harness 的 4-pass CRUD）：

```
AEvo 的 meta-agent loop:
  Read accumulated context → Attribute failure → Choose one action → Run → Record

这比 Continual Harness 的 4-pass CRUD 更适合 student-agent 的架构：
1. student-agent 已有 Run Archive（= AEvo 的 accumulated context C_r）
2. student-agent 已有 HarnessChange（= AEvo 的 meta-action a_r）
3. student-agent 已有 CommitGate（= AEvo 的 protected evaluator）
4. "Choose one action" = EvolutionProposal 限制单组件（Continual Harness 也支持）

AEvo 独立验证了 Continual Harness 的三个发现：
- "Choose one action" = per-component（两篇都支持）
- harness 保护 = evaluator 隔离（AEvo 有更强的 ablation 数据）
- 跨 session 知识积累 = bootstrap-updating / persistent family map
```

对 v0.5 的综合启发（Continual Harness + AEvo）：

```
1. EvolutionProposal 应限制为单组件类型
   - Continual Harness: per-component CRUD
   - AEvo: Choose exactly one action
   
2. Run Archive 支持 bootstrap-updating + structured query
   - Continual Harness: harness-snapshot 继承
   - AEvo: observation function Φ 从 C_r 提取摘要

3. 需要检测 capability floor，弱模型不启用自改进
   - Continual Harness: Flash-Lite + Continual Harness 退化

4. v0.5 meta-editing loop 参考 AEvo 的 Read → Attribute → One Action → Run → Record
   而非直接实现 Continual Harness 的 4-pass CRUD
   因为前者更匹配已有的 Run Archive + HarnessChange + CommitGate

5. Plateau detection（AEvo Figure 3）作为 meta-editing 的触发条件
   - procedure-based baselines 在 40-60 轮后 flatten
   - AEvo 通过 meta-edit 跳出 plateau
```

### 5.5 GAM-style JIT ContextBuilder（v0.5）

```
GAM 证明 AOT memory 有严重信息损失，JIT memory 在所有 benchmark 上更优。

v0.5 ContextBuilder 方向：
- 保留完整 evidence store（Run Archive 作为 page-store）
- 每个 turn 根据任务需求做 JIT 检索和整合
- Memorizer 对模型规模不敏感（可用小模型）
- Researcher 对模型规模极其敏感（必须用强模型）
- 多工具检索（embedding + BM25 + direct access）比单工具更优
```

v0.4 → v0.4x → v0.5 GAM 对齐路径：

```
v0.4:
- Run Archive MVP = page-store MVP
- L2 Working Memory = lightweight task state
- Recall Router v0 = simple retrieval over L3/L0
- ContextBuilder = template-based AOT assembly

v0.4x:
- Run Archive Full
- memory recall eval
- outcome credit
- score-based lostness
- better rerank

v0.5:
- GAM-style JIT ContextBuilder
- Researcher over evidence store
- 多工具检索：metadata + FTS + embedding + direct access
- 强模型执行 JIT research，小模型不承担 Researcher
```

```
GAM 方向不等于不要 summary。
GAM 反对 summary-only memory，支持完整 page-store + JIT research。
```

### 5.6 Gliding Horse Alignment

可借鉴：

```
- PDCA lifecycle：对应 XState task lifecycle
- EventBus：对应 Run Archive events.jsonl / signal stream
- 5W2H ontology：可作为 Task Ledger 字段灵感
- layered memory：支持 L0/L2/L3 分层设计
- graph / RDF 思路：作为 v0.5+ 方向，不进入 v0.4 blocker
```

不照搬：

```
- 不在 v0.4 引入 Oxigraph / RDF / JSON-LD
- 不把 student-agent 改成多 agent OS
- 不上 Rust runtime
- 不把 KG 当 v0.4 基础依赖
```

落地决策：

```
v0.4 使用 TypeScript + JSONL / JSON file stores。
v0.5 如果 Run Archive 和 memory recall 已经成熟，再评估 KG / RDF / JSON-LD。
```

---

## 6. Source Alignment Table

### 6.1 Runtime Alignment

| v0.4 / v0.4x 概念 | 当前 src 对应物 | 关系 | 落地决策 |
|---|---|---|---|
| Observable Context Runtime | `src/core/state-machine/` | 扩展，不替换 | v0.4 的 Turn Intake / ContextBuilder / ToolGuard / Signal Pipeline 挂到现有 XState lifecycle |
| LLM turn lifecycle | XState task lifecycle | 扩展 | 每轮 user/tool/runtime event 仍由 state machine 驱动 |
| Planning phase | `src/core/task-planner/` | 保留 | planner 注入 ContextBuilder 产出的 task context |
| Planning prompt | `src/core/task-planner/planning-prompt.ts` | 包裹，不替换 | 保留中文 prompt 和现有测试 |
| Executing phase | XState `executing phase loop` | 扩展 | Working Memory、ToolGuard、recentErrors 主要在 executing 阶段生效 |
| Failure escalation | `src/extension/hooks/failure-escalation.ts` + `src/core/executor/snapshot.ts` | 保留并接入 signal | 不重写 failure escalation，只补 signal/recentErrors/artifact/trace |
| Snapshot / rollback | `src/core/executor/snapshot.ts` | 复用 | v0.4 checkpoint 调现有 SnapshotManager |

### 6.2 Hashline Alignment

| v0.4 概念 | 来源 | 关系 | 落地决策 |
|---|---|---|---|
| Hashline Patcher | `@oh-my-pi/hashline` | 引入 npm 包 | 不自研，直接用 |
| Hashline Filesystem | `@oh-my-pi/hashline` Filesystem 抽象 | 实现适配层 | 适配 WriteQueue |
| Hashline SnapshotStore | `@oh-my-pi/hashline` InMemorySnapshotStore | 直接使用 | LRU 30 paths × 4 versions |
| Hashline prompt.md | `@oh-my-pi/hashline/src/prompt.md` | ContextBuilder 注入 | 每次 prompt 都包含 |
| Hashline recovery | `@oh-my-pi/hashline` 3-way merge | 自动生效 | recovery 事件写 signal |
| SnapshotManager (git) | `src/core/executor/snapshot.ts` | 并行，不冲突 | 两层各管各的 |

### 6.3 Hook / ToolGuard Alignment

| v0.4 概念 | 当前 src 对应物 | 关系 | 落地决策 |
|---|---|---|---|
| ToolGuard | `src/extension/hooks/` | 新增 hook | 新建 `src/extension/hooks/tool-guard.ts` |
| RiskGuard | `src/core/executor/risk-classifier.ts` + `src/extension/hooks/risk-guard.ts` | 并列，不替换 | RiskGuard 管用户确认，ToolGuard 管 agent 坏行为约束 |
| FileGuard | `src/extension/hooks/` | 并列 | FileGuard block 应生成 signal |
| Empty bash guard | 暂无 | 新增 ToolGuard rule | `command.trim() === ""` 直接 block |
| Natural language bash guard | 暂无 | 新增 ToolGuard rule | 非 shell 命令的自然语言直接 block |
| Broad glob guard | 暂无 | 新增 ToolGuard rule | block `**/*.ts`，要求目录前缀 |
| Patch retry guard | recentErrors | 新增 ToolGuard rule | 同目标 + 同 anchor range + 同 failureKind + 未 re-read = block |
| "fresh read before patch" | 原 ToolGuard 规则 | **由 Hashline 自动保证** | 不再需要 ToolGuard 单独检查 |

### 6.4 ContextBuilder Alignment

| v0.4 / v0.4x 概念 | 当前 src 对应物 | 关系 | 落地决策 |
|---|---|---|---|
| ContextBuilder | `src/core/task-planner/planning-prompt.ts` | 新增上下文供应器 | 新建 `src/core/context-builder/` |
| Hashline prompt.md | `@oh-my-pi/hashline/src/prompt.md` | 固定注入块 | 每次 prompt 包含 |
| L1 Prompt Working Set | 现有 planner / executor prompt | 改造输入 | planning/executing 调 ContextBuilder |
| Current Task Spec | Requirement Ledger rendered output | v0.4x 新增 | 高优先级注入 L1 |
| Restart Context | Recovery Mode output | v0.4x 新增 | lost_score >= 0.6 时替代普通历史摘要 |
| Recent raw turns | TUI transcript / conversation buffer | 新增输入源 | 固定 N=1~2 |
| Model-aware budget | 无 | 新增设计原则 | 弱模型减少注入量 |
| JIT research | 无 | v0.5 方向 | GAM-style，需要成熟 Run Archive |

### 6.5 Memory Alignment

| v0.4 / v0.4x 概念 | 当前 src 对应物 | 关系 | 落地决策 |
|---|---|---|---|
| L2 Working Memory | `src/memory/tasks/` | 扩展 | 先扩展 task metadata |
| Task Ledger | `src/memory/tasks/` + `src/memory/why/` | 新增子结构 | requirements / acceptanceCriteria / projectFacts / rejectedAssumptions |
| Requirement Ledger | Task Ledger | v0.4x 增强 | anti-lost 子结构 |
| signals.jsonl | `src/memory/questions/` + tool/runtime events | 新增 event stream | signals 是事件流 |
| lesson-candidates | `src/memory/candidates/` | 借鉴 | 新建 `src/memory/lessons/` |
| Knacks | 暂无 | 新增 | 新建 `src/memory/knacks/` |
| skill-usage.jsonl | 无 | v0.4x 新增 | 包含 baseline/variation |
| Run Archive | 暂无 | v0.4 新增 | `memory/runs/{runId}/` |
| preferences | `src/memory/preferences/` | 保留 | 用户偏好和策略规则分开 |
| provenance | `src/memory/why/` | 必须复用 | evidenceRef 不能取代 provenance |
| WriteQueue | `src/core/write-queue.ts` | 必须复用 | Hashline Filesystem 适配 WriteQueue |

### 6.6 Bounded Breaker Alignment

| v0.4 概念 | 当前 src 对应物 | 关系 | 落地决策 |
|---|---|---|---|
| Bounded Breaker | `src/reflect/bounded-breaker.ts` | 复用并升级 | 对 Knack 从"记录器"升级为"软闸门" |
| knack promotion | lesson → knack | 新增更严格流程 | high-severity counterexample 阻止 prompt injection |
| variation gate | 无 | v0.4x 新增 | Skill1 启发：variation > 0 才可升格 |

Knack Promotion Policy:

```
lesson candidate
↓
Bounded Breaker review
↓
candidate knack
  - knownFailureModes
  - doNotApplyWhen
  - confidenceReport
  - allowPromptInjection
↓
variation check (v0.4x): variation > 0
↓
eval / repeated success / user confirmation
↓
validated knack
```

### 6.7 Turn Intake Alignment

| v0.4 概念 | 当前 src 对应物 | 关系 | 落地决策 |
|---|---|---|---|
| Turn Intake | `src/core/task-planner/` | 新增辅助器 | 可放 `src/core/turn-intake/` |
| signal classification | Signal Store | 新增输出 | 可直接写 low-risk signal |
| ledger proposal | Task Ledger | 新增输出 | proposal 需消费端校验 |
| lostness detection | failure escalation / watchdog | 扩展 | v0.4 hard/soft trigger，v0.4x score |
| malformed JSON handling | 暂无 | 必须新增 | fail-open，记录 runtime signal |

Hard rule:

```
Turn Intake outputs proposal, not command.
Turn Intake does not own state transition.
XState owns state transition.
Turn Intake temperature ≈ 0.
```

### 6.8 Code Search Alignment

| v0.4 / v0.4x 概念 | 当前 src 对应物 | 关系 | 落地决策 |
|---|---|---|---|
| code_search abstraction | existing search_text / grep | 新增统一接口 | v0.4 只抽象 |
| grep backend | existing search_text / grep | 复用 | v0.4 default backend |
| Semble backend | 暂无 | v0.4x 新增 | MCP server 优先 |
| find_related | 暂无 | v0.4x 新增 | 语义相似代码，找调用方/测试 |
| search → read_range → edit_anchor | ToolGuard + code_search + Hashline | 新默认流程 | v0.4 先推流程，v0.4x 换 backend |

### 6.9 Eval Isolation Alignment（AEvo 校准）

| v0.4 / v0.4x 概念 | AEvo 对应物 | 关系 | 落地决策 |
|---|---|---|---|
| Run Archive `C_r` | Accumulated evolution context | 直接对应 | events.jsonl + outcome.json = `C_r` |
| HarnessChange | Meta-action `a_r = M(o_r)` | 直接对应 | 编辑 harness 组件而非直接产出候选 |
| CommitGate | Protected evaluator + gateway | 直接对应 | agent 不能 bypass eval，不能写分数 |
| Eval case（evals/） | Evaluator internals | 受保护资源 | agent 可起草，human review 后冻结 |
| Run Archive 结构化查询 | Observation function `Φ(r, C_r)` | v0.4 MVP 部分实现 | 按事件类型/时间过滤 |
| Stagnation signal | Plateau detection (Figure 3) | v0.4 新增 soft signal | 连续 N 轮无改善 → 策略切换 |
| v0.5 meta-editing loop | AEvo two-phase loop | v0.5 方向 | Read → Attribute → One Action → Run → Record |

### 6.10 Resource Evolution Alignment

| v0.4x-late / v0.5 概念 | 当前 src 对应物 | 关系 | 落地决策 |
|---|---|---|---|
| AgentResource registry | HarnessChange / memory managers | 新增资源索引 | 不改运行时，只登记可演化对象 |
| EvolvabilityPolicy | 无 | v0.4x-late 新增 | 静态权限表 |
| EvolvabilityMarker | 无 | v0.5 备注 | 动态搜索空间约束，数据驱动 |
| EvolutionProposal | HarnessChange 的增强版 | 扩展 | 限制为单组件类型（Continual Harness 启发） |
| CommitGate | eval harness + safety invariants | 新增闸门 | 通过 eval/safety 才能 accepted |
| bootstrap-updating | Run Archive harness-snapshot | 新增 | 上次 harness 状态继承到下次（Continual Harness 启发） |

---

## 7. Immediate Next Actions

### P0: 现在马上做

```
1. 在 package.json 加 @oh-my-pi/hashline 依赖
2. 写 Hashline Filesystem 适配层（适配 WriteQueue）
3. 把 ToolGuard 明确改成 pi hook，不是独立 runtime layer
4. 把 ContextBuilder 明确改成 prompt context provider，不替换 planning-prompt.ts
5. Semble 保持在 v0.4x，v0.4 只预留 code_search interface
```

### P1: v0.4 实现优先级

```
1. TUI Stability (v0.33)
2. Hashline Anchored Edit (v0.34)
3. XState-aware Working Memory Storage (v0.35)
4. ToolGuard Hook v0 (v0.36)
5. Signal Pipeline v0 (v0.37)
6. Lessons / Knacks v0 (v0.39)
7. Memory Store / Memory RAG Contract (v0.38A)
8. Recall Router v0 (v0.38B)
9. ContextBuilder v0 (v0.38C)
10. Lostness v0 hard/soft triggers (v0.3A)
11. Run Archive MVP (v0.3B)
12. HarnessChange + eval (v0.3C)
13. Eval Audit with ABA (v0.3C½) — 外部 CLI，不内置
14. Component Ablation Eval (v0.3D)
15. Integration Freeze (v0.3E)
```

### P2: v0.4x 实现优先级

```
1. Requirement Ledger
2. Current Task Spec
3. Minimal Active Projection（deterministic External J-space experiment）
4. Lostness Monitor (score-based)
5. Compaction Recovery Eval / Restart Context / Recovery Mode
6. Run Archive Full (harness-snapshot, prompt-snapshots)
7. Skill Usage Logging (with baseline/variation)
8. Outcome Credit (渐进 EMA)
9. Semble MCP backend
10. find_related 流程
11. Small eval sets
12. Project Bootstrap
13. AgentResource registry
14. CommitGate MVP
15. Project Development Archive + Human Dashboard
```

### P3: 暂缓（v0.5+）

```
1. Full Plan Mode
2. Multi-session / subagent / long-running
3. Full RL
4. Full Meta-Harness auto search
5. Semble as mandatory default backend
6. Full Autogenesis / AGP implementation
7. Autonomous self-modification of ToolGuard / ContextBuilder
8. Continual Harness full implementation
9. GAM-style JIT ContextBuilder
10. EvolvabilityMarker (dynamic, data-driven)
11. ast_edit / ast_grep via Hashline BlockResolver
```

---

## 8. Final Summary

### v0.4: Stable Harness + Run Archive + Verified Editing

```
核心目标：
  让 student-agent 的执行过程可观察、可复盘、可验证编辑、可回归测试。

关键词：
  TUI stability
  Hashline anchored edit (@oh-my-pi/hashline)
  XState-aware Working Memory
  ToolGuard hook (simplified by Hashline)
  Signal Pipeline
  ContextBuilder (template-based, model-aware budget)
  Run Archive MVP (events.jsonl + outcome.json)
  HarnessChange (runRef + traceRefs + regressionRisk)
  Lostness v0 (hard/soft triggers, not float score)
  Turn Intake (temp≈0, structured, fail-open)
  Component ablation eval
```

### v0.4x: Enhancement Layer

```
核心目标：
  在 v0.4 稳定闭环上，增强多轮防迷路、代码定位效率、运行归档、策略归因和小型 eval。

关键词：
  Anti-Lost Context (Requirement Ledger + Current Task Spec + Minimal Active Projection + Recovery Mode)
  Compaction Recovery Eval (Pi built-in baseline vs pinned projection)
  Run Archive Full (harness-snapshot, prompt-snapshots)
  Outcome-Credited Skills (baseline variation, 渐进 EMA)
  Semble code_search (MCP, search + find_related)
  Small Eval Sets
  Project Bootstrap
  AgentResource registry + CommitGate
  Project Development Archive + Human Dashboard
```

### v0.5: Resource Evolution

```
核心目标：
  在完整 evidence 和 eval 基础上，允许 harness 自我改进。

关键词：
  AEvo meta-editing loop (Read → Attribute → One Action → Run → Record)
  Evaluator 隔离 (agent 可改机制，不能改裁判)
  Continual Harness (reset-free, per-component CRUD, capability floor)
  Autogenesis alignment (EvolvabilityMarker, PS-Joint-Evo)
  GAM-style JIT ContextBuilder (Researcher over evidence store)
  bootstrap-updating (继承上次 harness 状态)
  Plateau detection (AEvo: 跳出 flatten 的关键)
```

Context Runtime 定位：

```
v0.4 的 Context Runtime 不是普通上下文压缩。
它把当前任务状态作为 pinned context，把长期经验和证据作为 retrieved context，把完整日志和 artifact 作为 drill-down context。
L1 每轮从 stores 重建，固定预算，不继承上一轮 prompt。
L2 不走 RAG；L3/L0 通过 Recall Router 召回；summary 只进 prompt，不作为唯一记忆。
```

最终一句话：

> **v0.4 的三根支柱是 Hashline（安全编辑）、Run Archive（可追溯）、HarnessChange（可验证）。
> 它们共同保证：agent 改错了能知道、能复盘、能回滚。
> 在这个基础上，v0.4x 用 Semble 让 agent 找代码更准，用 Anti-Lost 让 agent 多轮不迷路。
> v0.5 让 agent 基于 evidence 自我改进 harness（AEvo meta-editing loop），
> 但 evaluator 隔离保证 agent 可以改机制、不能改裁判（AEvo: 去掉隔离 → 2/3 reward hacking）。**

---

## 9. External Reference Notes

### Papers

```
1. Meta-Harness: End-to-End Optimization of Model Harnesses
   https://arxiv.org/abs/2603.28052

2. Agentic Harness Engineering (AHE)
   https://arxiv.org/abs/2604.25850

3. Continual Harness: Online Adaptation for Self-Improving Foundation Agents
   https://arxiv.org/abs/2605.09998

4. LLMs Get Lost In Multi-Turn Conversation
   https://arxiv.org/abs/2505.06120

5. Skill1: Unified Evolution of Skill-Augmented Agents via RL
   https://arxiv.org/abs/2605.06130

6. Autogenesis: A Self-Evolving Agent Protocol
   https://arxiv.org/abs/2604.15034

7. General Agentic Memory Via Deep Research (GAM)
   https://arxiv.org/abs/2511.18423

8. Harnessing Agentic Evolution (AEvo)
   https://arxiv.org/abs/2605.13821
```

### Projects

```
1. @oh-my-pi/hashline
   https://github.com/can1357/oh-my-pi/tree/main/packages/hashline
   MIT license, pure TypeScript, deps: diff + lru-cache

2. Semble
   https://github.com/MinishLab/semble
   MIT license, tree-sitter + Model2Vec + BM25 + RRF

3. 流马 (Gliding Horse)
   https://github.com/doiito/gliding_horse
   启发：PDCA lifecycle, EventBus, 5W2H, layered memory, RDF/KG 方向
   不照搬：Rust runtime, Oxigraph, RDF/JSON-LD, 多 agent OS
```

### Internal Documents

```
1. Eval Writing Guide
   docs/eval-writing-guide.md
   student-agent 自写 eval 的指南，含各版本 eval spec、权限边界、case 格式
```


---

## 结账层 · Settlement Notes（2026-07-19）

> **纪律**：本层仅追加状态注与证据链，不改上方原文正文。状态仅取
> `done` / `superseded` / `pending`（论文账本另用 未验/在验/已工程化/deferred/部分已独立复现）。
> 证据链不到位一律 `pending`，禁止凑绿。

### 文档级补注

> **状态注 · document-gap**：原文缺「注入效果验证」独立环节。
> 已由 `finding:injection-effect-experiment` 补位，定位见
> [ADR-008](../adr/ADR-008-measured-harness-evolution.md)
> （工具产品化 chronicle P3/P4 排序于该实验之后）。

### §7 Immediate Next Actions — 最低覆盖

#### P0（5 条 · 全 done）

> **状态注 · P0-1 · done**：`@oh-my-pi/hashline` / 锚定编辑已合入主链。
> 证据：[架构更新 v0.33→v0.4](../student-agent-architecture-update-v0.33-v0.4.md) · v0.34。
>
> **状态注 · P0-2 · done**：Hashline Filesystem / WriteQueue 适配已落地。
> 证据：同上 · core/hashline 路径。
>
> **状态注 · P0-3 · done**：ToolGuard 为 pi hook 路径（非独立 runtime layer）。
> 证据：[v0.4 freeze](../v0.4-context-runtime-freeze.zh.md) · extension/hooks。
>
> **状态注 · P0-4 · done**：ContextBuilder 为 prompt context provider（不替换 planning-prompt 主规划语义）。
> 证据：freeze 文档 · context-assembly 路径。
>
> **状态注 · P0-5 · done**：Semble 保持 v0.4x；v0.4 仅预留 code_search 接口。
> 证据：本文件 §3.1（原文）+ 现状无强制 Semble 默认后端。

#### P1（15 条主链 · done）

> **状态注 · P1-1 TUI Stability · done**：v0.33 TUI/trace 稳定化。证据：架构更新 v0.33。
>
> **状态注 · P1-2 Hashline · done**：v0.34。证据：架构更新 · `src/core/hashline/`。
>
> **状态注 · P1-3 Working Memory · done**：v0.35 XState-aware WM。证据：架构更新 · `src/memory/tasks/`。
>
> **状态注 · P1-4 ToolGuard · done**：v0.36。证据：freeze · hooks。
>
> **状态注 · P1-5 Signal Pipeline · done**：v0.37。证据：freeze。
>
> **状态注 · P1-6 Lessons/Knacks v0 · done**：蒸馏与 knack 库路径。证据：`0934d40b` · [ADR-004](../adr/ADR-004-knack-schema-v1.md)。
>
> **状态注 · P1-7 Memory Store/RAG · done**：jsonl memory store + recall 契约。证据：`src/memory/recall/`。
>
> **状态注 · P1-8 Recall Router · done**：v0.38B + P2 排序协议。证据：[ADR-005](../adr/ADR-005-recall-ranking-protocol.md)。
>
> **状态注 · P1-9 ContextBuilder · done**：L0–L3 装配。证据：freeze · context-assembly。
>
> **状态注 · P1-10 Lostness v0 · done**：hard/soft triggers（非 float score 终态）。证据：freeze。
>
> **状态注 · P1-11 Run Archive MVP · done**：events/outcome。证据：freeze · `src/memory/run-archive/`。
>
> **状态注 · P1-12 HarnessChange + eval · done**：外部 benchmark runner + harness change 记录形态。证据：`158ae519` · evals runners。
>
> **状态注 · P1-13 Eval Audit ABA · done**：外部 CLI/脚本路径，非内置 agent 自证。证据：eval 套件与 harness 外置判分（对齐 AEvo 原则）。
>
> **状态注 · P1-14 Component Ablation · done**：ablation/matrix 文档与 runner 形态。证据：[Ablation RFC](../ablation-eval-rfc.md) · [benchmark-matrix](../benchmark-matrix.md)。
>
> **状态注 · P1-15 Integration Freeze · done**：v0.4 freeze 收口。证据：[v0.4 freeze](../v0.4-context-runtime-freeze.zh.md) · tag/发布记录见 INDEX 2026-06-12。

#### P2（v0.4x 优先级 · 抽样结账）

> **状态注 · P2 Compaction Recovery · done**：压缩/恢复与约束近场相关实战收口。
> 证据：C 组 jspace-compaction 探针 [README](../probes/jspace-compaction/README.md)；
> 关案叙事占位 [BUG-011](../buglog.md) 与实档同类 [BUG-004](../buglog.md)（overfull 约束近场）。
>
> **状态注 · P2 Minimal Active Projection / J-space 实验 · superseded**：
> 完整认知 OS / 立即实现路径 NO-GO。证据：
> [external_jspace_architecture_review](../adr/external_jspace_architecture_review.md)
> （机读 `ADR:external-jspace-architecture-review` / `finding:jspace-external`；
> 任务单所称 ADR-007 NO-GO 与此同旨，**ADR-007 编号档未另建**，以该评审+墓碑为准）。
>
> **状态注 · P2 Project Development Archive + Human Dashboard · done**：
> Chronicle Board 已替代 flat dashboard 作为人类视图。证据：
> [dashboard](../dashboard.html) · graph build `npm run chronicle:build` ·
> commits `3b09c9e0` / `77bffe9b`。
>
> **状态注 · P2 其余条目 · pending**：Requirement Ledger 完整版、Current Task Spec 产品化、
> Lostness score-based monitor、Run Archive Full、Skill Usage Logging（variation）、
> Outcome Credit EMA、Semble MCP、find_related、Small eval sets、Project Bootstrap、
> AgentResource registry、CommitGate 等——证据链未达到「可合页」门槛，一律 pending。

### 分节状态注（v0.4x 关键条）

> **状态注 · v0.4x-C Outcome-Credited Skills / variation 升格 · superseded**：
> 原文 Skill1 variation 升格判据不作为当前主链门槛。实战判据为
> **causal pair + harness 晋升（P1-E）**（[ADR-003](../adr/ADR-003-v04x-priority-reorder.md) P1、
> commits `00ad6422` / `b3759244` / P1 合页记录）。variation 方案降为
> 「主库规模 ≥10 后再议」。**不删原文 §v0.4x-C 正文。**
>
> **状态注 · v0.4x-A J-space · superseded**：同上 P2 J-space 注。
>
> **状态注 · v0.4x-H Dashboard · done**：Chronicle Board / 档案发现 reference implementation 已跑通本仓库；
> 多项目 workspace 产品化仍 **pending**（见 ADR-008 排序：注入效果实验之后）。

### 图关系（机读 · 结账层）

> 以下供 Chronicle 解析；不修改上文技术规格。

```
roadmap:v04-final --calibrated_by--> paper:meta-harness
roadmap:v04-final --calibrated_by--> paper:ahe
roadmap:v04-final --calibrated_by--> paper:continual-harness
roadmap:v04-final --calibrated_by--> paper:llms-get-lost
roadmap:v04-final --calibrated_by--> paper:skill1
roadmap:v04-final --calibrated_by--> paper:autogenesis
roadmap:v04-final --calibrated_by--> paper:gam
roadmap:v04-final --calibrated_by--> paper:aevo
roadmap:v04-final --calibrated_by--> paper:gep-gene
paper:gep-gene --independently_replicated_by--> ADR-004
paper:gep-gene --independently_replicated_by--> finding:skill-leak-knacks-jsonl
paper:gep-gene --independently_replicated_by--> finding:knack-fidelity-v2
paper:llms-get-lost --motivates--> finding:injection-effect-experiment
paper:meta-harness --motivates--> phase:P1
paper:aevo --motivates--> phase:P0
roadmap:v04-final --motivates--> finding:injection-effect-experiment
```
