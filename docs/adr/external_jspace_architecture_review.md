# External J-Space / Context Runtime 架构评审报告

状态:已由 ADR-007 关闭,保留供追溯

> 用途：交给工作目录中的代码 Agent，结合现有实现检查可行性、差距、改造成本与评测方案。
> 讨论背景：围绕 L0–L3 Context Runtime、Skill/Recall 路由、外部 J-space、模型增量 Patch、Prompt Cache、Compaction 恢复与长任务稳定性展开。

## 图关系

> 非编号 ADR；解析为 `ADR:external-jspace-architecture-review`。墓碑 finding 由正文判定自动挂接。
> 机读约定见 `docs/chronicle-graph-contracts.md`。

- **tombstones** → `finding:jspace-external` · 外部 J-space 完整认知 OS
- **motivates** → `phase:P4` · Requirement Ledger / 工作区投影边界

---

## 1. 执行摘要

双方最终形成的核心判断是：

1. **外部 J-space 的方向成立**，但不应立即实现成完整的“事实—假设—问题—证据”认知操作系统。
2. 它不应成为 Context Runtime 的 `L4`，而应是从 `L0–L3` 中编译出的、容量受限的**当前活跃投影**。
3. 第一阶段只做五字段极简工作区：
   - `goal`
   - `success_conditions`
   - `constraints`
   - `rejected_paths`
   - `next_action`
4. **用户初始目标和硬约束必须从第 1 轮开始捕获**，即使 J-space 尚处于 Dormant 状态、还没有注入模型。
5. Skill Registry、Recall、Task Ledger、Observation Store 与 J-space 必须分层：
   - Skill Registry 管“会什么”；
   - SkillRouter 管“当前适合用什么”；
   - RecallRouter 管“当前缺什么材料”；
   - Runtime 管客观观察与状态不变量；
   - 模型管语义解释与少量增量更新；
   - J-space 只呈现当前真正需要抓住的状态。
6. **模型不应每轮重写完整状态**。只在语义状态真正变化时输出极小 Patch；没有变化时不输出 `no_change`。
7. Prompt Cache 方面，J-space 应作为**严格的请求尾部临时块**：
   - 不进入永久历史；
   - 不标记 `cache_control`；
   - 其前设置 cache breakpoint；
   - 序列化后必须是最后一个 content block。
8. 先实现并评测两个版本：
   - **v0.5：仅在 compaction 边界生成/恢复 checkpoint**
   - **v1：在 v0.5 基础上增加按需激活的逐轮极小 Patch**
9. 在数据证明有增益前，不实现：
   - 完整 fact/hypothesis 台账；
   - 复杂 WorkspaceProjector 评分；
   - 并发 Patch 合并；
   - 每轮 LLM Grader；
   - 全动作 `based_on` 强制引用。

最终目标不是“让模型维护一套漂亮的 Runtime”，而是验证它能否实际改善：

- compaction 后恢复率；
- 重复失败路径率；
- 用户约束违反率；
- 长任务成功率；
- 总 token 与工具调用成本。

---

## 2. 外部 J-space 的定位

### 2.1 它不是什么

外部 J-space 不是：

- 完整聊天历史；
- 完整 Working Memory；
- 完整 Task Ledger；
- 完整工具日志；
- 完整 `SKILL.md`；
- 所有召回结果；
- 新的长期持久层；
- “几十个字符”的限制。

J-space 论文讨论的是模型内部某一时刻可被灵活读取、报告和继续操作的少量活跃概念。外部实现只能做功能类比，不等同于模型内部激活空间。

### 2.2 它应该是什么

外部 J-space 应定义为：

> 一个容量受限、每轮可读、会直接影响下一步行为、可在 compaction 后恢复的活跃任务状态投影。

它解决的主要问题是：

1. 长任务经过 compaction 后丢失目标、约束和当前阶段；
2. 模型重复走已经失败的路径；
3. 用户早期提出的约束被长工具输出稀释；
4. 多阶段任务中 next action 漂移；
5. Skill 与执行阶段失配。

---

## 3. 与现有 L0–L3 Context Runtime 的关系

推荐分层如下：

```text
L0 — Control Plane
系统规则、用户硬约束、工具协议、安全边界

L1 — Immediate Context
当前用户输入、最近工具结果、上下文档位
Minimal / Standard / Heavy

L2 — Persistent Task State
Working Memory、Task Ledger、Snapshot、
SkillActivation、Checkpoint、Rejected Paths

L3 — Retrieval Plane
代码、文档、长期记忆、Artifact Store、
Skill Registry、完整 SKILL.md、Recall

        ↓ Workspace Runtime / Projector

J-space — Active Projection
当前目标、成功条件、约束、拒绝路径、下一步
```

### 关键结论

- J-space **独立实现**；
- 但它不是 `L4`；
- 它不作为唯一事实来源；
- 它是 L0–L3 的当前物化视图；
- 完整状态保留在 Runtime Store / Ledger / Snapshot 中。

---

## 4. Skill、Recall 与 J-space 的职责划分

### 4.1 Skill Registry

完整 Skill metadata 放在独立的 `SkillRegistry`，默认不进入 Prompt。

建议字段：

```ts
interface SkillMetadata {
  id: string;
  name: string;
  description: string;

  intents: string[];
  capabilities: string[];
  triggers: string[];
  preconditions: string[];
  exclusions: string[];

  requiredContext: string[];
  requiredTools: string[];
  conflictsWith: string[];
  sideEffects: string[];

  estimatedContextTokens?: number;
  expectedToolCalls?: number;

  version: string;
  sourcePath: string;
}
```

其职责是回答：

> Agent 有哪些能力，每个能力在什么条件下适用。

### 4.2 SkillRouter

SkillRouter 的逻辑职责是：

> 当前阶段最适合采用什么能力或工作流。

但 MVP 不应为 SkillRouter 单独调用一次 LLM。建议：

- Registry 候选检索由程序完成；
- 主模型结合当前任务、少量 Skill metadata、召回结果自行选择；
- Runtime 只检查前置条件、冲突和工具可用性。

正常同时激活：

- 1 个 primary skill；
- 0–2 个 auxiliary skill。

### 4.3 RecallRouter

RecallRouter 的职责是：

> 当前任务和当前 Skill 还缺哪些事实、代码、文档、历史证据或 Artifact。

它不应最终决定：

- 什么成为 confirmed fact；
- 什么进入 J-space；
- 使用哪个 Skill；
- 哪个假设被确认。

它只产生候选材料。

### 4.4 Skill 与 Recall 不是单向管线

最初的线性设计：

```text
SkillRouter → RecallRouter
```

不够准确，因为很多情况下不先查看仓库，就无法判断应该用 `repo-explore` 还是 `precise-edit`。

更准确的是循环：

```text
初步任务判断
   ↓
程序检索 Skill metadata 候选
   ↓
主模型选择当前策略
   ↓
Recall 补齐必要材料
   ↓
根据材料继续、切换或退出 Skill
```

因此：

- 职责上拆分；
- 实现上允许循环；
- 不拆成两个额外 LLM 调用。

---

## 5. 极简 J-space 数据模型

第一版推荐只保留五个字段：

```ts
interface MinimalJSpace {
  goal: string;

  successConditions: string[];

  constraints: Array<{
    id: string;
    content: string;
    sourceRef?: string;
    pinned: boolean;
    stale?: boolean;
  }>;

  rejectedPaths: Array<{
    id: string;
    path: string;
    reason: string;
    evidenceRefs?: string[];
    stale?: boolean;
  }>;

  nextAction?: string;
}
```

### 为什么暂不加入 facts / hypotheses

完整 fact/hypothesis 台账的风险包括：

- 早期“确认”的事实在代码变化后失效；
- 语义重复项不断积累；
- 模型花大量输出 token 反复维护状态；
- 新鲜工具证据与旧 fact 冲突；
- 状态机复杂度很快超过实际收益；
- 评测难以区分 checkpoint 与逐轮台账的真实增益。

因此应先证明五字段版本有效，再决定是否扩展。

---

## 6. Dormant / Active / Recovery 三阶段

### 6.1 Dormant

特点：

- Runtime 从第 1 轮开始记录基础事件；
- **必须捕获初始 goal 与用户 constraints**；
- 暂不向模型注入完整 J-space；
- 不要求模型逐轮输出 Patch；
- 保存工具调用、修改文件、测试结果等 Observation。

不能等到第 12 轮再从历史中事后提取用户约束，因为早期的“不要改测试”等要求可能已经被长工具输出稀释。

### 6.2 Active

触发条件可以先用简单规则：

```text
turns >= 12
或 toolCalls >= 15
或发生用户纠正
或同类工具失败 >= 2
或任务有多个 success condition
或即将 compaction
```

Active 后：

- 注入五字段 J-space；
- 主模型只在状态变化时提交极小 Patch；
- 高风险 commit point 可要求 `based_on`；
- 保留 rejected paths 防止重复失败。

### 6.3 Recovery

触发：

- compaction 后；
- 上下文污染；
- 重复失败；
- 目标漂移；
- 用户纠正；
- 工作区状态明显失配。

Recovery 可注入更完整 checkpoint，但仍不应恢复成完整历史重放。

---

## 7. 模型每次调用获得什么

### 7.1 稳定前缀

尽量保持字节稳定：

- system rules；
- tool schemas；
- 输出协议；
- Workspace Patch schema；
- 固定 `AGENTS.md`；
- 稳定的 Pi schema。

### 7.2 动态输入

- 当前用户输入；
- 最新工具结果或摘要；
- 当前必要的 Recall 片段；
- 当前 Observation；
- 当前 J-space；
- 当前激活 Skill 的少量有效规则。

### 7.3 信息优先级

当不同来源冲突时：

```text
当前用户明确纠正
>
最新工具观察
>
J-space 中仍有效的记录
>
历史 checkpoint
>
召回记忆
>
模型假设
```

核心规则：

> 新鲜证据优先于 J-space 记录。

J-space 不能成为比当前现实更权威的旧笔记。

---

## 8. Observation 与 Interpretation 分区

双方一致认可的边界是：

> Runtime 记录观察，模型记录解释。

### 8.1 Runtime 可自动记录

- 工具名称和参数；
- exit code；
- 测试是否通过；
- 修改了哪些文件；
- diff 行范围；
- 命令输出引用；
- next action 是否已经执行；
- 当前 turn；
- evidence ID；
- workspace version；
- 文件变化导致的 stale 标记。

这些信息进入独立 Observation / Evidence 区，不自动升级为 fact。

### 8.2 模型负责判断

- 结果意味着什么；
- 某条失败路径是否被排除；
- 是否满足 success condition；
- 是否需要改变目标或阶段；
- 当前风险；
- 下一步动作；
- 是否需要切换 Skill。

### 反例

Runtime 不应看到：

```text
npm test exit_code = 1
```

就直接写入：

```text
修复失败
```

因为失败可能来自无关测试。Runtime 只记录 Observation，由模型解释语义。

---

## 9. 模型如何维护状态

不允许模型每轮重写完整 `jspace.json`。

模型只提交领域化增量 Patch，例如：

```json
{
  "patch": [
    {
      "op": "add_rejected_path",
      "path": "升级认证库版本",
      "reason": "当前依赖版本与 lockfile 一致，问题仍复现",
      "evidence": ["tool_103"]
    },
    {
      "op": "set_next_action",
      "content": "检查服务端实际读取 token 的位置"
    }
  ]
}
```

没有认知变化时：

- 只输出 action；
- 不输出 `no_change`；
- 不要求复述 Runtime 状态。

### 9.1 Runtime 负责的不变量

- JSON Schema；
- 全局 ID；
- workspace version；
- evidence 是否存在；
- pinned constraint 不得非法删除；
- 状态迁移是否合法；
- 容量上限；
- canonical rendering；
- 新任务清理；
- stale 标记；
- 并发冲突（后续版本）。

原则：

> 模型维护语义，程序维护不变量。

---

## 10. `based_on` 的使用边界

不应对所有 action 强制 `based_on`，否则模型会为了满足 Schema 编造似是而非的引用，造成伪溯源。

只在高风险 commit point 强制：

- 写入或删除文件；
- 不可逆操作；
- 改变任务目标；
- 切换 primary skill；
- 否定用户明确要求；
- 声明任务完成。

普通搜索、读取、探索不强制。

运行时只做廉价校验：

- ID 是否存在；
- 状态是否合法；
- 引用是否为空；
- evidence 是否存在。

“引用内容是否真的支持动作”应放到**离线 Trace Grader**，不要做成每轮 LLM 门禁。

---

## 11. Stale 机制

这是防止状态污染的关键。

### 11.1 v1：文件级 stale

如果某条 constraint、rejected path 或未来扩展的 fact 关联到：

```text
src/auth.ts
```

而该文件被修改，则将相关状态标记：

```text
stale = true
```

不是删除，也不能继续当作强事实使用。

### 11.2 后续优化：行范围 stale

文件级 stale 安全但粗糙。在高频编辑场景中，可能导致模型反复重新确认无关内容。

后续可用：

```text
diff 修改行范围
∩
状态 source 行号范围
```

仅 stale 真正受影响的记录。

如果评测中发现“重新确认 stale 状态”成为主要 Patch 类型，再升级到行范围粒度。

---

## 12. Prompt Cache 结论

### 12.1 正确结论

J-space 作为动态尾部临时块，不会导致整个历史 cache 失效。

第 N 轮：

```text
稳定前缀
历史
用户消息 N
J-space N
```

第 N+1 轮：

```text
稳定前缀
历史
用户消息 N
Assistant N
新事件
J-space N+1
```

公共前缀仍可匹配到“用户消息 N”结束处。真正损失的是：

> 每次模型调用都需要为当前 J-space 支付一次未缓存 prefill。

### 12.2 成本按模型调用次数计算

Agent 一个用户 turn 内可能有多次 tool-use 循环。

因此开销约为：

```text
模型调用次数 × J-space token 数
```

- 300–500 token 的极简 J-space 通常可接受；
- 如果膨胀到 2,000+ token，并有上百次工具调用，成本会明显上升。

这也是坚持五字段极简版的重要理由。

### 12.3 Cache 规则

1. cache breakpoint 放在 J-space 之前；
2. J-space 不标 `cache_control`；
3. J-space 必须是序列化请求的最后一个 content block；
4. J-space 后不能再追加：
   - 工具重试提示；
   - 框架注入；
   - SDK 自动 system 内容；
   - 其他 Runtime metadata。
5. Runtime 必须加入断言：
   - 序列化后 J-space 不是最后块时直接报错。

### 12.4 不能做的事情

- 把动态 J-space 放在 system 后；
- 在历史中部插动态 summary；
- 每轮滚动压缩旧工具结果；
- 每轮重写前部 Working Memory；
- 把旧 J-space 永久追加进历史；
- 非确定性排序；
- 渲染时间戳或浮动评分；
- 每轮重新注入完整 `SKILL.md`。

历史压缩只能在明确 snapshot / compaction 边界做，不能滚动改写已缓存历史。

---

## 13. v0.5 与 v1 的消融设计

### 13.1 v0.5：Compaction Checkpoint Only

不做逐轮 Patch。

只实现：

1. 从第 1 轮捕获初始 goal 与 constraints；
2. Runtime 记录基础 Observation；
3. compaction 前调用主模型生成一次五字段 checkpoint；
4. compaction 后注入 checkpoint 恢复；
5. 评估恢复率、约束保持与 token。

目的：

> 判断仅靠 checkpoint 是否已经解决大部分问题。

Checkpoint 生成质量可能主导恢复率，因此它的 Prompt、Schema 与评测应单独设计。

### 13.2 v1：Incremental Minimal J-space

在 v0.5 基础上增加：

1. Dormant / Active / Recovery；
2. rejected paths 实时积累；
3. next action 按需更新；
4. 高风险 commit point 引用；
5. stale 标记；
6. 极小增量 Patch；
7. J-space 严格尾部注入。

目的：

> 测量逐轮维护相对 checkpoint-only 的增量价值。

如果 v1 相比 v0.5 没有显著提升，就不应继续扩展完整 fact/hypothesis 台账。

---

## 14. 暂不实现的功能

在 v0.5/v1 数据出来前，全部砍掉：

- 完整 fact 台账；
- hypothesis 生命周期状态机；
- 自动语义去重；
- 复杂 WorkspaceProjector 打分；
- 每轮独立 LLM Workspace 维护调用；
- 两个独立 LLM Router；
- 并发 Patch 合并；
- 多 Agent canonical J-space；
- 所有 action 强制 `based_on`；
- 运行时 LLM Trace Grader；
- 专门 Lostness Agent；
- 每轮完整 Workspace JSON 输出。

---

## 15. 评测指标

至少需要四个主指标。

### 15.1 Compaction 后恢复率

检查 compaction 后是否能正确恢复：

- 当前目标；
- 成功条件；
- 用户约束；
- 已拒绝路径；
- 下一步动作。

### 15.2 重复失败路径率

已经有明确失败证据的方案，后续是否被再次尝试。

可记录：

```text
rejected_path_reuse_count
rejected_path_reuse_rate
```

### 15.3 用户约束违反率

对带明确约束的任务统计：

- 修改了不允许修改的测试；
- 进行了只读任务之外的写操作；
- 询问了可自行验证的问题；
- 使用了用户明确禁止的工具或方案。

这是 `constraints` 字段是否有价值的直接指标。

### 15.4 长任务成功率与总成本

比较：

- plain；
- v0.5 checkpoint-only；
- v1 minimal J-space。

统计：

- pass rate；
- total input tokens；
- total output tokens；
- cache read/write；
- tool calls；
- failed tool calls；
- time to completion；
- runtime patch output tokens。

### 15.5 辅助指标

- J-space 平均 token；
- 每任务 Patch 次数；
- 每次 Patch 平均 token；
- stale 重新确认次数；
- Active 激活时机；
- checkpoint 生成错误率；
- 约束捕获遗漏率；
- commit point 伪引用率；
- J-space 后追加内容断言失败次数。

---

## 16. 建议的实验矩阵

| 版本 | 每轮 Patch | Compaction Checkpoint | Constraints | Rejected Paths | Stale | J-space 注入 |
|---|---:|---:|---:|---:|---:|---:|
| Plain | 否 | 否 | 否 | 否 | 否 | 否 |
| v0.5 | 否 | 是 | 是 | checkpoint 时生成 | 否 | 恢复后 |
| v1 | 按需 | 是 | 是 | 实时 | 文件级 | Active/Recovery |
| v1-no-rejected | 按需 | 是 | 是 | 否 | 文件级 | Active/Recovery |
| v1-no-constraints | 按需 | 是 | 否 | 实时 | 文件级 | Active/Recovery |

推荐优先跑：

1. Plain vs v0.5；
2. v0.5 vs v1；
3. v1 vs v1-no-rejected；
4. v1 vs v1-no-constraints。

这样才能知道：

- 是 checkpoint 起作用；
- 还是逐轮维护起作用；
- rejected paths 是否真的减少重复失败；
- constraints 是否真的降低违规。

---

## 17. 工作目录 Agent 检查任务

请检查当前工作目录中的实现，并回答以下问题。

### 17.1 现有模块映射

找出当前代码中对应或近似对应的模块：

- L0 Control Plane；
- L1 ContextBuilder / Render Mode；
- L2 WorkingMemory；
- Task Ledger；
- Snapshot；
- RecallRouter；
- Lostness Detector；
- Trace Grader；
- Skill Registry；
- Skill loader；
- Prompt 序列化；
- Cache control / breakpoint；
- Compaction；
- Artifact Store；
- Tool result normalization。

请列出：

```text
模块名称
文件路径
主要接口
当前职责
与本文设计的差距
```

### 17.2 Prompt 排序与缓存

重点检查实际序列化请求：

1. system、tools、history、runtime block 的真实顺序；
2. J-space 是否可以成为最后一个 content block；
3. SDK 是否会在其后追加隐藏注入；
4. 是否已有 cache breakpoint；
5. `cache_control` 当前标在哪里；
6. tool-use 循环中每次调用怎样重建 Prompt；
7. 当前是否滚动改写历史 summary；
8. compaction 是否会修改历史中部内容。

需要给出基于真实代码的结论，不要仅根据架构命名推测。

### 17.3 v0.5 最小改造方案

给出最小文件级施工方案，实现：

- 第 1 轮捕获 goal / constraints；
- compaction 前生成五字段 checkpoint；
- compaction 后恢复；
- checkpoint 严格尾部注入；
- 对 checkpoint 输出做 Schema 校验；
- 记录恢复率所需 trace。

要求：

- 列出修改文件；
- 新增接口；
- 数据结构；
- 测试；
- 预计 token 影响；
- 不引入独立维护模型调用。

### 17.4 v1 增量方案

在 v0.5 基础上，给出：

- Dormant / Active / Recovery 状态机；
- 激活阈值；
- 极小 Patch Schema；
- Observation Store；
- rejected paths；
- next action；
- 文件级 stale；
- 高风险 commit point；
- J-space 尾部断言。

### 17.5 风险检查

检查是否存在：

- Working Memory 每轮完整重写；
- Skill 全量注入；
- Recall 结果直接进入 Prompt；
- Runtime 状态与新鲜工具结果冲突；
- 旧任务状态泄漏到新任务；
- compaction 后约束丢失；
- cache prefix 被动态块打断；
- 输出 token 被状态维护显著占用；
- Trace Grader 需要额外在线 LLM 调用；
- 并发 worker 覆盖状态；
- 模型可无证据删除 pinned constraint。

### 17.6 最终输出要求

Agent 最终应提交：

1. 当前实现审计；
2. Plain / v0.5 / v1 对比；
3. 建议先做还是不做；
4. 最小施工表；
5. 风险与回滚方案；
6. 可直接运行的 eval 计划；
7. 明确指出哪些设计属于过度工程，暂不实现。

---

## 18. 推荐实施顺序

```text
阶段 0：只做审计
确认 Prompt 排序、compaction、cache 与现有 L2/L3 状态流。

阶段 1：v0.5
首轮捕获 goal/constraints + compaction checkpoint + recovery。

阶段 2：跑评测
Plain vs v0.5，确认恢复率是否真实提升。

阶段 3：v1
加入按需激活、rejected paths、next action、stale。

阶段 4：再次消融
v0.5 vs v1，确认逐轮维护的增量价值。

阶段 5：再决定是否扩展
只有 v1 数据明显为正，才考虑 facts/hypotheses、语义去重和多 Agent。
```

---

## 19. 最终架构判断

双方修订后的共同结论是：

> 五字段极简工作区、按需激活、尾部注入、commit point 强制引用、Observation/Interpretation 分区，与它要解决的问题——compaction 存活、重复失败和约束遗忘——在复杂度上基本匹配。

同时必须坚持：

- 先做 v0.5 checkpoint-only 基线；
- 再证明逐轮 Patch 的增量价值；
- 不把 Runtime 维护变成 output token 大头；
- 不在运行时增加额外 LLM Grader；
- 不让旧 J-space 污染历史；
- 不让 J-space 凌驾于最新工具证据；
- 不在数据出来前升级为完整认知工作区。

一句话概括：

> 先证明“极简执行工作区”有用，再考虑“完整认知工作区”；先解决 compaction 和约束遗忘，不要先造一个复杂的 Agent 操作系统。
