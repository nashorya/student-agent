# Student-Agent Eval Writing Guide

> **用途**：本文档是 student-agent 自己写 eval case 时的指南。
>
> **论文校准**：
> - AHE（复旦）：agent 有能力提议改进（包括 eval case），但 regression prediction 精度仅 11.8%
> - AEvo（港科大）：evaluator 必须与 agent 隔离，去掉隔离 → 2/3 runs reward hacking
> - Meta-Harness：full traces >> scores-only（44% 差距），eval 必须基于 trace 而非只看分数

---

## 0. 从 Eval 想法到 Harness-Ready Task

本指南采用两层产物、五道审核门禁：

```text
student-agent 起草
  → Gate 1: schema / 文件完整性检查
  → Gate 2: 独立静态审计（ABA 可选）
  → Gate 3: oracle / verifier 对抗验证
  → Gate 4: agent trials（仅 agentic / performance eval）
  → Gate 5: human review + CommitGate
  → 冻结为 protected resource
```

### 0.1 两层产物

```text
evals/drafts/{eval-id}/
  spec.json                    # agent 起草的评测意图和验收标准
  review-notes.md              # agent 起草的风险说明；不能写 HARNESS_READY
  task/
    instruction.md             # 被测 agent 可见
    task.toml                  # harness metadata
    environment/               # 被测 agent 可见的初始环境
    tests/test.sh              # evaluator 可见，被测 agent 不可见
    solution/solve.sh          # oracle；evaluator 可见，被测 agent 不可见
    adversarial/
      known-bad/               # 应当失败的实现或操作
      alternative-valid/       # 不同但正确、应当通过的实现
  audit/                       # 静态审计报告（ABA 可选）和人工处置记录
  validation/                  # verifier、oracle、trial 报告

evals/specs/{eval-id}.json     # 审核后冻结的规范来源
evals/tasks/{eval-id}/         # 审核后供正式 harness 执行
```

`spec.json` 负责说明“为什么测、测什么、什么算成功”。`task/` 负责让
harness 真正执行。正式 harness **只加载 `evals/tasks/`**，不能把
`evals/drafts/` 或 `evals/specs/` 当作可执行任务。

### 0.2 五道门禁

#### Gate 1: Schema 和完整性

必须确认：

- `spec.json` 必填字段齐全，指标名称能映射到真实数据源。
- task bundle 包含 `instruction.md`、`task.toml`、`environment/` 和 `tests/test.sh`。
- `passCondition` 仅用于说明；最终 pass/fail 必须由 `tests/test.sh` 或已注册 grader 产生。
- instruction 中的每个要求都能从 prompt、environment 或标准领域知识推导。
- tests 不得要求 instruction 未公开的函数名、文件结构或实现细节。

#### Gate 2: 独立静态审计（ABA 可选）

由独立 evaluator 做静态审计，不由起草 agent 自审自批。可以使用 Auto Benchmark
Audit（ABA）或本仓库的 lightweight audit checklist；ABA 是可选外部工具，不是
student-agent 的核心依赖。

```text
审查范围:
  instruction ambiguity / underspecification
  environment conflict
  tests too narrow / too broad
  hidden implementation requirements
  incorrect or incomplete ground truth
  evaluation exploit
```

准入要求：

- severity 2：必须修复，不能冻结。
- severity 1：修复，或由 human reviewer 记录接受风险的理由。
- severity 0：可进入下一门禁。

静态审计器不是最终审批人。低 star、外部依赖或运行成本高的工具只能作为参考；
正式准入仍以后续 verifier、trace 检查和 human review 为准。

#### Gate 3: Oracle 和 Verifier 对抗验证

独立 evaluator 必须运行：

```text
initial environment       → FAIL
oracle/reference solution → PASS
known-bad solution        → FAIL
partial solution          → FAIL 或得到预先定义的部分分
alternative-valid solution→ PASS
exploit attempts          → FAIL
```

`npm run eval:validate` 只执行带 `solution/solve.sh` 的 oracle-backed fixture。
没有 reference solution、由外部 session/metric scorer 判分的 imported smoke task
只接受 schema/文件完整性检查，不得伪装成满足 initial FAIL → oracle PASS 的
deterministic correctness fixture。

常见 exploit 包括：只创建标志文件、伪造 reward、读取 tests/solution、利用上轮残留
状态、输出固定 success 字符串，以及用等价格式绕过脆弱字符串匹配。

#### Gate 4: Agent Trials

仅 `evalKind = agentic` 或 `performance` 时需要：

- 开发期至少 3 trials，冻结前默认至少 5 trials。
- 保存完整 trajectory、最终输出、verifier 输出、耗时和 harness 配置。
- 报告成功率、失败类型和跨 trial 波动；不能只报告最好一次。
- 性能对比必须固定模型、prompt、工具、预算、超时和环境。

如果使用 LLM grader，还必须单独验证格式不变性、改写不变性、verbosity bias、
重复采样稳定性及与人工标签的一致性。

#### Gate 5: Human Review 和 CommitGate

human reviewer 最终确认：

- eval 测量的 construct 与路线图目标一致。
- 独立静态审计问题已解决或有明确 waiver。
- verifier 验证和必要 trials 已通过。
- 测试成本、风险和维护责任可接受。

CommitGate 随后将 draft 提升为：

```text
evals/specs/{eval-id}.json
evals/tasks/{eval-id}/
```

两者一起成为 protected resource。起草 agent 不能自行批准、提升、修改正式
grader、写入分数，或声称 eval 已通过。

### 0.3 Harness-Ready 判定

```text
[ ] spec schema valid
[ ] instruction 无隐藏要求
[ ] environment 可复现且每轮清理
[ ] tests / solution 对被测 agent 不可见
[ ] initial FAIL
[ ] oracle PASS
[ ] known-bad / exploit FAIL
[ ] alternative-valid PASS（适用时）
[ ] 独立静态审计无未处理 P0 / severity 2
[ ] trials 和波动已报告（适用时）
[ ] human approved
```

全部满足后才能标记 `HARNESS_READY`。

### 0.4 机器格式、语言与 Reward 规则

中文可以用于 `instruction.md`、`review-notes.md`、adversarial 说明和自然语言解释。
但所有机器解析面必须保持稳定、英文、ASCII：

- eval id、目录名、`task.toml` 字段、路径、文件名、tags、metric 名称用英文/ASCII。
- `spec.json` 的字段名必须用英文；字段值可以中文，但机器会匹配的值优先英文。
- `tests/test.sh` 不要依赖中文自然语言句子作为唯一 PASS 条件。
- 需要 agent 写报告时，报告字段名固定英文，例如 `- Rejection count: 1`。
- reward JSON 只能写当前 harness 支持的格式：`{"score": 1}` 或 `{"reward": 1}`。
  不要写旧格式 `{"correctness_score": 1, "behavior_score": 1}`，否则
  `src/evals/reward.ts` 会把 reward 解析为错误。
- `PASS` 字符串、`.test_result`、agent-writable flag、agent-writable report 不能作为
  可信成功来源；它们最多是辅助信息，必须由 verifier 或 protected trace 交叉验证。

### 0.5 Trace-Bound Construct 规则

如果 eval 声称测的是 Hashline、Signal Pipeline、ToolGuard、Run Archive、tool trace、
protected resource boundary 等机制行为，`test.sh` 只看最终文件内容是不够的。

这类 draft 必须显式写明：

- 哪些指标必须来自 protected trace / signal store / verifier 输出。
- 当前结构测试能覆盖什么，不能覆盖什么。
- 若 trusted trace 尚不可用，`review-notes.md` 状态必须是 `DRAFT_BLOCKED` 或
  `BLOCKED_FOR_TRACE_GRADER`，不得写 `CLOSE_TO_READY` 或 `HARNESS_READY`。
- agent-writable 报告只能作为结构检查，不得被当作真实 provenance、signal、block 或
  snapshot 证据。

---

## 1. 权限边界（AHE + AEvo 联合校准）

```
Agent 可以做:
  OK  读 Run Archive 的 full traces
  OK  读 eval 结果
  OK  在 evals/drafts/ 起草 spec 和 candidate task bundle
  OK  根据独立 evaluator 的报告修改 draft
  OK  提议 HarnessChange

Agent 不能做:
  NO  修改 evals/specs/ 和 evals/tasks/ 中已冻结的 eval
  NO  运行正式 eval 后自行批准自己的 draft
  NO  bypass CommitGate
  NO  直接写 outcome.json 的分数
  NO  在被测运行中读取 tests / solution / passCondition
```

### Eval case 生命周期

```
agent writes evals/drafts/{eval-id}/
  → independent schema + static audit + verifier review
    → human review / waiver
      → CommitGate promotes spec + task bundle
        → evals/specs/ + evals/tasks/ become harness-protected
          → eval runner 独立执行
            → 结果写入 Run Archive
```

**关键**：draft 不是正式 evaluator。只有通过全部门禁并被 CommitGate 提升后，
spec 和 task bundle 才变成受保护资源。
agent 可以提议 "这个 eval 不合理"（canReflect = true），但不能自动修改（canAutoApply = false）。

### EvolvabilityPolicy

```ts
{
  resourceId: "evals/specs/* | evals/tasks/*",
  canReflect: true,
  canSuggestChange: true,
  canAutoApply: false,
  requiresUserApproval: true,
  requiresEvalPass: false,    // eval 不能用 eval 验证自己
  requiresCommitGate: true
}
```

---

## 2. Eval Case 格式

每个 draft 的规范放在 `evals/drafts/{eval-id}/spec.json`。审核通过后，
CommitGate 将其冻结为 `evals/specs/{eval-id}.json`。

JSON 是规范来源，不是 harness 的直接执行输入；必须同时提供 §0.1 定义的 task
bundle。

```json
{
  "schemaVersion": 1,
  "id": "hashline-stale-rejection-001",
  "version": "v0.34",
  "component": "hashline",
  "category": "safety",
  "evalKind": "deterministic",
  "target": "component",
  "construct": "stale edit prevention",
  "input": {
    "description": "读取文件后，外部修改文件，用旧 tag 尝试编辑",
    "setup": [
      "read_range('src/foo.ts') → 获取 tag #a1b2",
      "外部写入 src/foo.ts（tag 变为 #c3d4）",
      "edit('src/foo.ts', anchor='#a1b2', ...)"
    ]
  },
  "expectedBehavior": "Hashline Patcher reject edit, stale tag mismatch signal written",
  "metrics": [
    "hashline_rejection_count",
    "signal_store_event_count"
  ],
  "passCondition": "hashline_rejection_count == 1 AND signal_store_event_count >= 1",
  "grader": {
    "type": "script",
    "path": "task/tests/test.sh"
  },
  "oracle": {
    "path": "task/solution/solve.sh"
  },
  "trialPolicy": {
    "trials": 1,
    "aggregation": "all_must_pass"
  },
  "failureImplication": "stale edit 未被拦截，可能导致文件损坏",
  "relatedPaper": "AEvo Table 3: 去掉 harness → reward hacking"
}
```

### 必填字段

| 字段 | 说明 |
|------|------|
| `id` | 唯一标识，格式 `{component}-{scenario}-{nnn}` |
| `version` | 对应路线图版本（v0.33 / v0.34 / ...） |
| `component` | 被测组件名 |
| `category` | `safety` / `correctness` / `performance` / `regression` / `integration` |
| `evalKind` | `deterministic` / `agentic` / `performance` |
| `target` | `component` / `agent` / `harness` |
| `construct` | 该 eval 声称测量的能力或系统性质 |
| `input` | 场景描述 + 触发步骤 |
| `expectedBehavior` | 期望行为的自然语言描述 |
| `metrics` | 要采集的指标名列表 |
| `passCondition` | 通过条件表达式 |
| `grader` | 正式判定器类型及路径 |
| `oracle` | reference solution 路径 |
| `trialPolicy` | trial 数量与聚合方式 |

### 可选字段

| 字段 | 说明 |
|------|------|
| `failureImplication` | 不通过意味着什么 |
| `relatedPaper` | 论文出处和数据支撑 |
| `regressionRisk` | 这个 case 可能因哪些改动而失效（AHE 启发） |
| `ablationGroup` | 用于 component ablation 的分组标记 |
| `acceptedRisks` | human reviewer 接受的静态审计 P1 / severity 1 finding 及理由 |

### 2.1 给 Student-Agent 的起草提示词

将下面提示词中的占位内容替换后交给 student-agent。它只负责生成 draft，不负责
批准、冻结或正式评分。

```text
你现在是 Student-Agent Eval Draft Author。

目标：
为下面的需求起草一个可被当前 eval harness 执行、可被独立 evaluator
静态审计的 eval。你只能写入 evals/drafts/，不能修改 evals/specs/、
evals/tasks/、eval runner、正式 grader、Run Archive outcome 或 CommitGate。

待评测需求：
<写清楚组件、行为、失败风险和对应路线图版本>

请先阅读：
1. docs/eval-writing-guide.md
2. evals/README.md
3. 与被测组件直接相关的源码和测试
4. 一个最相似的 evals/tasks/ 现有任务

在 evals/drafts/<eval-id>/ 下生成：

1. spec.json
   - 包含 schemaVersion、id、version、component、category、evalKind、target、
     construct、input、expectedBehavior、metrics、passCondition、grader、
     oracle、trialPolicy、failureImplication 和 regressionRisk。
   - construct 必须说明真正测量的能力，不能只复述实现细节。
   - 每个 metric 必须能映射到实际文件、事件、trace 字段或 verifier 输出。
   - passCondition 作为可读规范；正式判定必须由 tests/test.sh 实现。
   - JSON 字段名、metric 名、id、路径、tags 必须保持英文/ASCII。

2. task/instruction.md
   - 只包含被测 agent 应该知道的信息。
   - 不泄露 tests、oracle、内部评分逻辑或期望实现结构。
   - 不要求 prompt 中未说明的函数名、文件布局或实现方式。

3. task/task.toml
   - 使用当前 harness 支持的字段。
   - 设置合理 timeout_seconds、tags 和 expected_files。

4. task/environment/
   - 提供最小、确定、可重复初始化的环境。
   - 不包含 solution、隐藏 tests、reward 或 ground truth。
   - 不依赖未冻结的在线资源。

5. task/tests/test.sh
   - 验证用户可见结果和必要安全不变量，不锁死某一种内部实现。
   - 初始环境必须失败。
   - oracle 必须通过。
   - 部分实现、明显错误实现和投机实现必须失败。
   - 合理的不同实现应当通过。
   - 不读取或信任被测 agent 可直接伪造的 success 标志。
   - 成功时写 `REWARD_JSON_FILE` 的内容必须是 `{"score": 1}` 或 `{"reward": 1}`。
   - 失败时必须非零退出；不能只输出 FAIL 但 exit 0。
   - 如果检查报告文件，必须检查字段值，不只检查字段名存在。
   - 如果 construct 依赖 tool trace / signal / protected store，必须说明当前
     `test.sh` 是否能读到 trusted data；读不到就保持 DRAFT_BLOCKED。

6. task/solution/solve.sh
   - 使用一种清晰的 reference solution 证明任务可解。
   - 不把 reference solution 当作唯一合法实现。

7. task/adversarial/README.md
   - 列出至少一个 known-bad、一个 partial、一个 exploit attempt。
   - 若存在多种合理解法，再列出一个 alternative-valid。
   - 说明每个样例预期 PASS 或 FAIL 的原因。

8. review-notes.md
   - 解释 instruction、environment、tests 和 construct 的对应关系。
   - 列出可能的歧义、grader 过宽/过窄风险、状态泄漏风险和依赖风险。
   - 明确声明尚未经过独立静态审计、正式 verifier validation、agent trials、
     human review 或 CommitGate，因此状态必须是 DRAFT，不得写 HARNESS_READY。
   - 若依赖 protected trace/signal/store 但当前 test.sh 无法验证，状态必须写
     `DRAFT_BLOCKED` 或 `BLOCKED_FOR_TRACE_GRADER`，并列出需要的 trusted metrics。

语言要求：
- 中文可以用于 instruction 和说明文字。
- 机器解析字段、报告字段名、reward JSON、文件路径、id、tags 必须用英文/ASCII。
- 不要把“输出某句中文”作为唯一通过条件；优先检查真实文件副作用、trace 或结构化字段。

完成后只汇报：
- 创建的文件
- eval 要测的 construct
- verifier 的关键断言
- 需要独立 evaluator 重点审查的风险

不要运行正式 baseline，不要修改冻结 eval，不要自行宣布通过。
```

---

## 3. 各版本 Eval Spec

本节列出的 `evals/*_cases.json` 是已有的 **legacy scenario catalog**，用于保留
路线图中的场景、指标和优先级，不是当前 harness 的直接执行输入。

新增或重做某个 case 时，应从 catalog 选择场景，并在
`evals/drafts/{eval-id}/` 生成完整 draft。审核通过后再提升到
`evals/specs/` 和 `evals/tasks/`。不要因为 catalog 中已有一条 JSON 记录就把
该 case 标记为已实现或 `HARNESS_READY`。

### v0.33: TUI Stability Eval

**文件**: `evals/tui_stability_cases.json`

**测什么**:
- 并发输入下 TUI 渲染一致性（transcript/status/input/debug 四通道隔离）
- tool error 持久化（不只闪一下）
- 多行 paste 完整性
- 任务运行中 pendingUserMessages 不丢失

**期望效果**:
- 0 次通道串扰（status 内容出现在 transcript = fail）
- tool error 在 transcript 中可回溯（持久化 >= 5 秒）
- 多行 paste 输入完整还原率 100%
- 并发用户输入零丢失

**方法论**:
- 用脚本模拟快速连续输入 + 同时触发 tool error
- 录制 TUI 输出流，断言每帧内容只包含对应通道数据
- 自动化 smoke test：启动 → 发送多行文本 → 触发 error → 检查 transcript

**需要的 case 数量**: 8-10 条

**case 覆盖建议**:
```
tui-channel-isolation-001: status 不混入 transcript
tui-channel-isolation-002: debug 不混入 transcript
tui-error-persist-001: tool error 持久化 >= 5 秒
tui-error-persist-002: 多个 tool error 不互相覆盖
tui-paste-001: 多行 paste 完整还原
tui-paste-002: 含特殊字符的多行 paste
tui-concurrent-001: 任务运行中用户输入不丢失
tui-concurrent-002: 快速连续输入不丢失
```

---

### v0.34: Hashline Anchored Edit Eval

**文件**: `evals/hashline_cases.json`

**测什么**:
- stale file edit 拦截率（tag mismatch 时是否 block）
- 3-way merge recovery 成功率（session 内 chain edit）
- output token 变化（对比 old_text 复述方式）
- stale rejection / recovery 事件是否写入 signal

**期望效果**:
- stale edit 拦截率 = 100%（tag mismatch → reject，零漏过）
- chain edit recovery 成功率 >= 80%（同文件连续编辑 3+ 次不丢）
- output tokens 下降 >= 30%（参考 oh-my-pi: Grok 4 Fast -61%，保守估计）
- 每次 rejection/recovery 都有对应 signal 记录

**方法论**:
- 准备 10 个文件，先 read → 外部改动 → 用旧 tag 编辑 → 断言全部 reject
- 准备 5 个文件，连续 chain edit 3-5 次 → 断言 recovery 生效
- 同一组编辑任务，分别用 old_text 和 hashline 两种方式，对比 output token 数
- 检查 signal store 中 hashline 相关事件数量 = rejection + recovery 总数

**需要的 case 数量**: 12-15 条

**case 覆盖建议**:
```
hashline-stale-reject-001: 单文件 stale tag → reject
hashline-stale-reject-002: 多文件批量 stale tag → 全部 reject
hashline-stale-reject-003: tag 部分匹配（前 2 位对后 2 位不对）→ reject
hashline-recovery-001: 同文件 chain edit 3 次 → recovery
hashline-recovery-002: 同文件 chain edit 5 次 → recovery
hashline-recovery-003: chain edit 中间有外部修改 → recovery 或 reject
hashline-signal-001: rejection 写 signal（provenance + evidenceRef 非空）
hashline-signal-002: recovery 写 warning signal
hashline-token-001: 对比 old_text vs hashline output tokens
hashline-snapshot-001: read_range 后 SnapshotStore 有记录
hashline-snapshot-002: SnapshotStore LRU 超 30 paths 后最旧被淘汰
hashline-coexist-001: Hashline SnapshotStore 和 git SnapshotManager 不冲突
```

---

### v0.35: Working Memory Eval

**文件**: `evals/working_memory_cases.json`

**测什么**:
- 重启恢复完整性（goal / currentStep / recentErrors 恢复率）
- readFiles / writeFiles 跟踪准确性（read cache invalidation）
- Working Memory phase 与 XState phase 一致性

**期望效果**:
- 重启后 goal + currentStep + recentErrors 100% 恢复
- 文件修改后 readFiles 标记 stale，不返回过期缓存
- Working Memory phase 和 XState currentState 在任意时刻一致

**方法论**:
- 启动任务 → 执行到 executing phase → 强制 kill → 重启 → 检查 task context
- 修改文件 → 调 readFiles → 断言返回新版本（不是缓存）
- 在 state transition hook 中对比两个 phase 值，不一致即 fail

**需要的 case 数量**: 6-8 条

**case 覆盖建议**:
```
wm-restart-001: executing phase 中 kill → 重启恢复 goal
wm-restart-002: executing phase 中 kill → 重启恢复 recentErrors
wm-restart-003: planning phase 中 kill → 重启恢复 currentStep
wm-cache-001: 文件外部修改后 readFiles 返回新版本
wm-cache-002: writeFiles 更新后 readFiles 反映变更
wm-phase-001: state transition 后 WM phase 同步
wm-phase-002: 快速连续 transition 不造成 phase 漂移
```

---

### v0.36: ToolGuard Eval

**文件**: `evals/tool_guard_cases.json`

**测什么**:
- 规则拦截率（空 bash / 自然语言 bash / broad glob / patch retry）
- 误拦率（合法操作被拦截的比例）
- Hashline 简化效果（"fresh read before patch" 规则不再需要）

**期望效果**:
- 空 bash、自然语言 bash、`**/*.ts` glob → 100% block
- 同目标 + 同 anchor + 同 failureKind + 未 re-read → 100% block
- 合法操作误拦率 < 2%
- 无 "fresh read before patch" 规则，Hashline tag 自动覆盖

**方法论**:
- 准备 bad input 测试集（20 条），每种类型 5 条 → 断言全部 block
- 准备 good input 测试集（50 条正常操作）→ 断言全部 pass
- 去掉 Hashline 的情况下，同样的 stale edit 场景 → 确认 ToolGuard 无法独立拦截

**需要的 case 数量**: 15-20 条

**case 覆盖建议**:
```
tg-empty-bash-001: command="" → block
tg-empty-bash-002: command="   " (whitespace only) → block
tg-nl-bash-001: command="请帮我删除这个文件" → block
tg-nl-bash-002: command="list all files in src" → block
tg-nl-bash-003: command="rm -rf /" (合法 shell 但危险) → 由 RiskGuard 处理，不是 ToolGuard
tg-glob-001: target="**/*.ts" → block
tg-glob-002: target="src/**/*.ts" → pass（有目录前缀）
tg-glob-003: target="*.json" (root level) → block
tg-retry-001: 同文件同 anchor 同 failureKind 未 re-read → block
tg-retry-002: 同文件同 anchor 不同 failureKind → pass
tg-retry-003: 同文件同 anchor 同 failureKind 但已 re-read → pass
tg-legit-001: 正常 bash command → pass
tg-legit-002: 正常 edit with valid tag → pass
tg-legit-003: 正常 glob with directory prefix → pass
tg-hashline-001: 无 Hashline 时 stale edit → ToolGuard 无法拦截（证明 Hashline 必要）
```

---

### v0.37: Signal Pipeline Eval

**文件**: `evals/signal_pipeline_cases.json`

**测什么**:
- 事件覆盖率（tool error / FileGuard block / ToolGuard block / Hashline rejection / user correction 是否全部进入 signal）
- provenance 完整性（每个 signal 有来源引用）
- Turn Intake 容错（malformed JSON 不阻断主任务）
- recentErrors 可用性（最近 N 个 error 可查询）

**期望效果**:
- 所有 5 类事件源 100% 产出 signal
- 每个 signal 有 `provenance` + `evidenceRef`，无空值
- Turn Intake 输出 malformed JSON 时，主任务继续执行，且记录 degraded signal
- recentErrors 最近 5 条准确无遗漏

**方法论**:
- 每类事件源各触发 3 次 → 检查 signal store 数量和内容
- 故意向 Turn Intake 输入损坏的 JSON → 断言主任务不 crash + signal 有记录
- 连续触发 10 个 error → 查询 recentErrors → 断言最近 5 条正确

**需要的 case 数量**: 10-12 条

**case 覆盖建议**:
```
sp-tool-error-001: tool 执行失败 → signal 有 provenance
sp-fileguard-001: FileGuard block → signal 有 evidenceRef
sp-toolguard-001: ToolGuard block → signal 记录 rule name
sp-hashline-001: Hashline rejection → signal 记录 stale tag
sp-user-correction-001: 用户纠正 → signal 记录 correction content
sp-coverage-001: 5 类事件各触发 1 次 → signal store 有 5 条
sp-provenance-001: 所有 signal 的 provenance 非空
sp-provenance-002: 所有 signal 的 evidenceRef 非空
sp-turnintake-001: malformed JSON → 主任务继续 + degraded signal
sp-turnintake-002: 完全空输出 → 主任务继续 + degraded signal
sp-recenterrors-001: 10 个 error 后查询最近 5 条 → 正确
sp-recenterrors-002: 0 个 error 时查询 → 返回空数组
```

---

### v0.38: ContextBuilder Eval

**文件**: `evals/context_builder_cases.json`

**测什么**:
- L1 不再无限 append（prompt 长度增长受控）
- task context 注入稳定性
- Hashline prompt.md 自动注入
- model-aware budget（不同 model tier 注入量差异）

**期望效果**:
- 10 轮对话后 prompt token 数不超过 5 轮时的 1.5x
- task context 在连续 10 轮中每轮都存在于 prompt 中
- Hashline prompt.md 出现在 100% 的 prompt 中
- Haiku tier prompt 注入量 < Sonnet tier 注入量（至少差 20%）

**方法论**:
- 模拟 15 轮对话 → 逐轮记录 prompt token 数 → 画增长曲线
- 每轮 hook 检查 prompt 中是否包含 Current Task Spec 关键段
- 分别用 haiku/sonnet model tier 配置 → 对比注入 token 数

**需要的 case 数量**: 8-10 条

**case 覆盖建议**:
```
cb-growth-001: 15 轮后 prompt tokens <= 5 轮时的 1.5x
cb-growth-002: 20 轮后 prompt tokens <= 10 轮时的 1.3x
cb-inject-001: task context 连续 10 轮每轮存在
cb-inject-002: Hashline prompt.md 连续 10 轮每轮存在
cb-inject-003: recentErrors 注入且不超过 5 条
cb-budget-001: Haiku tier 注入量 < Sonnet tier
cb-budget-002: 超预算时低优先级块被截断
cb-planning-001: planning prompt 测试不被 ContextBuilder 打挂
cb-order-001: 注入顺序正确（system rules > hashline > task spec > ...）
```

---

### v0.39: Lessons / Strategy Genes Eval

**文件**: `evals/strategy_genes_cases.json`

**测什么**:
- signal → lesson candidate 转化路径通畅
- Bounded Breaker 对 high-severity counterexample 的拒绝
- allowPromptInjection gate 有效性
- hard tool rules 不依赖 gene（独立性）

**期望效果**:
- 至少 1 条重复出现的 signal 自动产出 lesson candidate
- Bounded Breaker 对 high-severity counterexample 的 candidate 拒绝率 = 100%
- allowPromptInjection = false 的 gene 不出现在 prompt 中
- 去掉所有 gene 后，ToolGuard hard rules 仍然工作

**方法论**:
- 制造 3 次相同 tool error → 检查是否生成 lesson candidate
- 向 Bounded Breaker 提交带 counterexample 的 candidate → 断言被拒
- 直接检查 prompt 输出，对比 allowPromptInjection true/false
- 关闭 strategy-genes 模块 → 运行 ToolGuard 测试集 → 断言全部 pass

**需要的 case 数量**: 8-10 条

**case 覆盖建议**:
```
sg-signal-to-lesson-001: 3 次相同 tool error → lesson candidate
sg-signal-to-lesson-002: 1 次 tool error → 不产出 candidate（阈值未达）
sg-breaker-reject-001: high-severity counterexample → 拒绝
sg-breaker-pass-001: 无 counterexample → 通过
sg-injection-gate-001: allowPromptInjection=false → 不注入 prompt
sg-injection-gate-002: allowPromptInjection=true → 注入 prompt
sg-independence-001: 去掉所有 gene → ToolGuard 仍工作
sg-independence-002: 去掉所有 gene → ContextBuilder 仍工作
```

---

### v0.3A: Lostness v0 Eval

**文件**: `evals/anti_lost_cases.json`

**测什么**:
- hard trigger 触发准确性（3 类 trigger 各自的 recall 和 precision）
- hard trigger 后 task context 刷新是否生效
- soft signal 累积升级（连续 N=3 轮后升级）
- rejected assumption 不被复用

**期望效果**:
- reusedRejectedAssumption 触发率 = 100%
- hard trigger 后下一轮 prompt 包含更新后的 task context
- 连续 3 轮 answerBloat → 触发升级处理
- 被否定假设在后续 5 轮内不再出现（0% 复用率）

**方法论**:
- 设计 3 个对话场景，每个覆盖一种 hard trigger
- 每个场景验证 trigger 触发 + task context 刷新 + signal 记录
- soft signal 场景：连续输出 3 轮长文但不推进任务 → 检查升级处理

**需要的 case 数量**: 10-12 条

**case 覆盖建议**:
```
lost-hard-reuse-001: agent 使用已否定假设 → 触发
lost-hard-reuse-002: agent 使用未否定假设 → 不触发
lost-hard-correction-001: 用户对同一点纠正两次 → 触发
lost-hard-correction-002: 用户对不同点各纠正一次 → 不触发
lost-hard-mismatch-001: agent 理解与需求不符被确认 → 触发
lost-hard-refresh-001: hard trigger 后 task context 被刷新
lost-hard-refresh-002: 刷新后下一轮 prompt 包含更新
lost-soft-bloat-001: 连续 3 轮 answerBloat → 升级
lost-soft-bloat-002: 仅 2 轮 answerBloat → 不升级
lost-soft-thrash-001: 短时间 5 次调同一工具 → toolThrashing signal
lost-rejected-reuse-001: 被否定假设后续 5 轮不再出现
lost-plateau-001: HarnessChange 连续 N 轮无改善 → stagnation signal
```

---

### v0.3B: Run Archive MVP Eval

**文件**: `evals/run_archive_cases.json`

**测什么**:
- events.jsonl 完整性（所有事件类型都被记录）
- outcome.json 字段完整性
- 可回溯性（从 outcome 定位到具体 event）
- HarnessChange 可通过 traceRefs 关联
- 结构化查询支持（AEvo 启发：observation function Phi）

**期望效果**:
- 一次包含 tool error + user correction + hashline rejection 的任务，events.jsonl 包含全部 3 类事件
- outcome.json 所有 count 字段与 events.jsonl 实际计数一致（diff = 0）
- 给定 traceRef → 能在 events.jsonl 中找到对应 eventId
- events.jsonl 按时间有序，无乱序
- 可按 component / outcome / signal type 过滤查询

**方法论**:
- 设计一个"典型失败任务"：故意包含 stale edit、tool error、user correction
- 任务结束后读取 runs/{runId}/ 下所有文件
- 校验 outcome.json counts vs events.jsonl 实际事件数
- 用 traceRefs 做反向查找，断言 100% 命中

**需要的 case 数量**: 8-10 条

**case 覆盖建议**:
```
ra-completeness-001: 3 类事件全部记录在 events.jsonl
ra-completeness-002: state transition 事件记录
ra-outcome-001: outcome.json counts 与 events.jsonl 一致
ra-outcome-002: outcome.json 所有必填字段非空
ra-traceref-001: traceRef 反向查找 100% 命中
ra-order-001: events.jsonl 时间有序
ra-query-001: 按 component 过滤查询有效
ra-query-002: 按 signal type 过滤查询有效
ra-isolation-001: agent 不能直接写 outcome.json 分数（AEvo 隔离）
```

---

### v0.3C: HarnessChange + Eval Before/After

**文件**: `evals/harness_change_cases.json`

**测什么**:
- HarnessChange 记录完整性（rationale / prediction / regressionRisk 非空）
- runRef + traceRefs 关联有效性
- eval before/after 数据可比性
- regressionRisk 预测 vs 实际回归的对应关系

**期望效果**:
- 每个 HarnessChange 的 rationale、prediction、regressionRisk 100% 非空
- runRef 指向存在的 run 目录
- evalBefore 和 evalAfter 使用相同的 metric 集合
- regressionRisk 中列出的场景，至少 50% 在 evalAfter 中可验证

**方法论**:
- 实际做一个 harness change（如开启 ToolGuard）
- 跑 baseline（evalBefore）→ apply change → 跑相同任务（evalAfter）
- 检查 HarnessChange record 字段完整性

**需要的 case 数量**: 6-8 条

**case 覆盖建议**:
```
hc-completeness-001: rationale 非空
hc-completeness-002: prediction 非空
hc-completeness-003: regressionRisk 非空（至少 1 项）
hc-runref-001: runRef 指向存在的 run 目录
hc-traceref-001: traceRefs 中每个 ref 在 events.jsonl 中可找到
hc-eval-compare-001: evalBefore 和 evalAfter metric keys 完全一致
hc-regression-001: regressionRisk 场景在 evalAfter 中可验证
```

---

### v0.3D: Component Ablation Eval

**文件**: `evals/component_ablation_cases.json`

**测什么**:
- 各组件单独贡献（ToolGuard / ContextBuilder / Signal Pipeline / Hashline 各自 on/off）
- 组合效果 vs 单组件效果之和（检测非可加性，AHE 校准）
- 组合是否存在退化

**期望效果（AHE 数据校准）**:
- 每个组件单独开启相比 baseline 有可度量差异
- 单组件正向增益之和 != 全部组合增益（验证非可加性存在）
- 全部组合效果 >= 最佳单组件效果

**方法论**:
- 准备 1 组 benchmark 任务（至少 5 个，覆盖 edit / search / multi-turn）
- 跑 6 组配置：baseline / +ToolGuard / +ContextBuilder / +Signal / +Hashline / all
- 统一指标：task success rate, tool error count, output tokens, hashline rejection count, lostness trigger count

**需要的 case 数量**: 6 条（每组配置 1 条 meta-case）

**case 覆盖建议**:
```
ablation-baseline-001: 无任何组件 → 记录 baseline metrics
ablation-toolguard-001: 仅开 ToolGuard → 记录 metrics
ablation-contextbuilder-001: 仅开 ContextBuilder → 记录 metrics
ablation-signal-001: 仅开 Signal Pipeline → 记录 metrics
ablation-hashline-001: 仅开 Hashline → 记录 metrics
ablation-all-001: 全部开启 → 记录 metrics + 对比单组件之和
```

---

### v0.3E: Integration Freeze Eval

**文件**: `evals/integration_freeze_cases.json`

**测什么**:
- 全链路 smoke test
- 回归检测（和 v0.3D 的 all-combined 数据对比）
- 接口冻结合规性

**期望效果**:
- 全链路 smoke test 通过率 100%
- 和 v0.3D 结果相比无显著退化（各指标波动 < 10%）
- events.jsonl schema、ToolGuard rule 接口、ContextBuilder block 接口无 breaking change

**需要的 case 数量**: 5-6 条

**case 覆盖建议**:
```
freeze-smoke-001: TUI → Hashline → ToolGuard → Signal → CB → RA 全链路
freeze-regression-001: vs v0.3D all-combined 指标波动 < 10%
freeze-schema-001: events.jsonl schema 无 breaking change
freeze-schema-002: ToolGuard rule 接口无 breaking change
freeze-schema-003: ContextBuilder block 接口无 breaking change
```

---

### v0.4x-A: Anti-Lost Eval

**文件**: `evals/anti_lost_full_cases.json`

**测什么**:
- Requirement Ledger 追踪准确性
- Current Task Spec 注入后多轮一致性保持
- Lostness score 阈值标定有效性
- Recovery Mode 恢复效果

**期望效果**:
- 用户修改需求后，Requirement Ledger 在 1 轮内更新
- 有 Current Task Spec 时，10 轮后 task alignment >= 80%
- lostness score 和 task outcome 的 Spearman 相关系数 >= 0.5
- Recovery Mode 触发后 3 轮内恢复到初始水平的 70%

**需要的 case 数量**: 10-12 条

---

### v0.4x-C: Outcome-Credited Skills Eval

**文件**: `evals/outcome_credit_cases.json`

**测什么**:
- SkillUsageEvent 记录完整性
- variation > 0 升格，variation <= 0 拒绝
- 多次失败 gene 权重下降
- utility 权重渐进策略生效

**期望效果**:
- 100% SkillUsageEvent 有 baselineExpectedOutcome
- variation <= 0 的 lesson 不升格
- 失败 3+ 次的 gene 排序下降 >= 2 位
- 样本 < 3 时 utilityRatio 不参与排序

**需要的 case 数量**: 8-10 条

---

### v0.4x-D: Semble Code Search Eval

**文件**: `evals/code_search_cases.json`

**测什么**:
- 首次命中目标文件的工具调用数（Semble vs grep）
- token 消耗对比
- Semble fallback 率和可追踪性
- find_related 命中率
- Semble + Hashline 全链路

**期望效果**:
- Semble 首次命中调用数 <= grep 的 50%
- token 消耗下降 >= 50%
- fallback 时任务不中断
- find_related 命中调用方/测试 >= 60%
- search → read_range → edit 全链路成功率 >= 90%

**需要的 case 数量**: 10-12 条

---

### v0.4x-F: Small Eval Sets 元评估

**文件**: `evals/meta_eval_cases.json`

**测什么**:
- eval 本身的可复现性
- eval 灵敏度（能区分有效/无效组件）
- eval 运行时间

**期望效果**:
- 同配置两次运行指标波动 < 5%
- 组件开/关前后指标变化 > 15%
- 单次 eval 运行时间 < 10 分钟

**需要的 case 数量**: 3-5 条

---

## 4. 优先级

```
P0（v0.4 核心，必须先写）:
  evals/hashline_cases.json          (v0.34)
  evals/tool_guard_cases.json        (v0.36)
  evals/signal_pipeline_cases.json   (v0.37)

P1（v0.4 闭环）:
  evals/working_memory_cases.json    (v0.35)
  evals/context_builder_cases.json   (v0.38)
  evals/run_archive_cases.json       (v0.3B)

P2（v0.4 验证）:
  evals/tui_stability_cases.json     (v0.33)
  evals/strategy_genes_cases.json    (v0.39)
  evals/anti_lost_cases.json         (v0.3A)
  evals/harness_change_cases.json    (v0.3C)
  evals/component_ablation_cases.json (v0.3D)
  evals/integration_freeze_cases.json (v0.3E)

P3（v0.4x）:
  evals/anti_lost_full_cases.json    (v0.4x-A)
  evals/outcome_credit_cases.json    (v0.4x-C)
  evals/code_search_cases.json       (v0.4x-D)
  evals/meta_eval_cases.json         (v0.4x-F)
```

---

## 5. 写 Eval Case 时的检查清单

写每个 eval case 时，确认：

- [ ] `passCondition` 是可自动判断的表达式，不是模糊描述
- [ ] `metrics` 中的指标名和 Run Archive / Signal Pipeline 的实际字段名对应
- [ ] 每个 case 至少覆盖一条 happy path 和一条 failure path
- [ ] regression case 标注 `regressionRisk`（AHE 启发：强制列出可能退化的场景）
- [ ] ablation case 标注 `ablationGroup`
- [ ] 不要写只能手动判断的 case（如 "TUI 看起来正常"）
- [ ] 不要写依赖特定模型输出内容的 case（模型输出不确定）
- [ ] case 之间尽量独立，不依赖执行顺序
