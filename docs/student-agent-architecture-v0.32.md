# Student Agent — 架构设计文档 v0.32

> 一个有自知之明的编程代理。领域聚焦（编程）、知道边界（知道何时问）、有记忆（可回滚，能学习）。
>
> **"A true master is an eternal student."**

本文档覆盖 student-agent 的核心系统设计：整体架构、信息可信度体系、分层记忆、失败升级、子代理、Bounded Breaker、Stream Adapter、质量监控等。配套阅读：[Task/Plan 工作流设计](student-agent-task-plan-workflow.md) | [入职指南](onboarding.md)。

---

## 一、整体架构

```
┌─────────────────────────────────────────────────────────┐
│                        INPUT LAYER                       │
│         用户自然语言指令 / 显式 URL / 文件路径            │
└────────────────────────┬────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│                       CORE AGENT                         │
│                                                          │
│   Planner                                                │
│   任务分解，静态依赖分析（仅承诺 import/config 级别）     │
│   子代理开启时：Read Intent / Write Intent 声明 + 锁检测 │
│   Merge Agent 作为内部 Synchronizer 汇总 patch/冲突       │
│   输出无冲突任务树供用户确认后执行                        │
│                                                          │
│   Executor                                               │
│   每次执行前自动快照，持有文件写权限                      │
│   高风险操作默认需确认，可通过 project-rules.md 豁免     │
│                                                          │
│   State Machine（XState v5）                             │
│   硬性管控所有状态流转，含中断处理状态                    │
│   context 只存 ID 和标志，资源由外部管理器持有            │
│   execution_timeout: 120s（after 配置）                  │
│                                                          │
│   Stream Adapter                                         │
│   位于 AI SDK 与 XState 之间                             │
│   缓冲流式 Tool Call 事件，回合结束时发送原子事件         │
│   EXECUTION_ROUND_COMPLETE → 一次快照点 = 一次状态转移   │
│   契约：120s 内交付事件，或什么都不交付                   │
└──────────┬────────────────────────┬─────────────────────┘
           ↓                        ↓
┌──────────────────┐   ┌────────────────────────────────────┐
│ KNOWLEDGE        │   │ FAILURE ESCALATION LADDER           │
│ RETRIEVAL        │   │                                     │
│                  │   │ Attempt 1                           │
│ Context7 MCP     │   │ 每次执行前快照 → 回滚               │
│ 主流公开库文档    │   │ 策略空间：降级/拆分/上下文复位      │
│ 精确版本检索      │   │ /扩展思考/模型切换                  │
│                  │   │                                     │
│ Playwright       │   │ Attempt 2                           │
│ JS渲染页面       │   │ 提取检索意图 → 成功：Web Search 注入 │
│ 持久化登录会话    │   │             → 失败：跳过直接 Attempt 3│
│ 域名白名单机制    │   │                                     │
│                  │   │                                     │
│ Design Study     │   │                                     │
│ 视觉风格学习模式  │   │                                     │
│                  │   │ Attempt 3+                          │
│ Web Search MCP   │   │ 中断执行，生成结构化诊断报告         │
│ 第二级失败时触发  │   │ 向用户提问，写入 questions.json      │
└──────────────────┘   │ 携带 provenance 字段                │
                       └────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────┐
│                    LAYERED MEMORY                        │
│                所有写入携带 provenance 字段               │
│                                                          │
│  project-rules.md           最高优先级，手动维护          │
│  preferences.md             正式偏好，版本化存储          │
│  preference-candidates.json 偏好候选池，含信任状态机      │
│  design-candidates.json    设计候选池，含信任状态机       │
│  design-profiles/          已确认 StyleProfile            │
│  design-critiques.json     视觉自评记录                   │
│  questions.json             失败案例库，含可信度标记      │
│  docs-index/                sqlite-vec 文档向量库         │
│                                                          │
│  优先级层叠注入 prompt：                                  │
│  system baseline → project-rules → preferences → task   │
└─────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────┐
│              REFLECT AGENT + BOUNDED BREAKER（异步）      │
│                                                          │
│  Reflect Agent：                                         │
│  扫描会话历史 + git diff，提取行为模式                    │
│  检测可合并/可泛化模式 → 触发 Bounded Breaker            │
│  单一模式直接升级，不触发 Breaker                        │
│  执行记忆清理                                            │
│                                                          │
│  Bounded Breaker（条件性子步骤）：                        │
│  仅在语义合并/抽象泛化时触发                              │
│  主动生成 unknown_risk_zones → 优先进入策略库            │
│  生成置信度报告，决策权交还用户                           │
└─────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────┐
│              SUB-AGENT SKILL（按需开启）                  │
│  默认关闭，用户显式开启后主代理变为 Orchestrator          │
│  Planner 输出任务树前完成 Write Intent 冲突检测           │
│  用户确认无冲突任务树后并行分发                           │
│  运行时冲突由状态冲突错误类型接管，注入冲突信息重新分解   │
│  Footer 实时展示各子代理状态 + token 消耗 + 累计成本      │
└─────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────┐
│              QUALITY WATCHDOG（双信号源）                 │
│  信号一：用户反馈（每 5 个任务主动询问）                  │
│  信号二：基准任务低频校准（每周/每 20 个任务后台运行）    │
│  ≥2 指标同时退化 → 全屏警报，不自动修改任何行为          │
└─────────────────────────────────────────────────────────┘
```

---

## 二、信息可信度体系

### 核心原则

所有影响未来决策的写入操作必须携带 **provenance 字段**，并经历从 `unverified` 到 `user-confirmed` / `re-observed` 的信任状态流转。没有 provenance 的信息不注入决策上下文。

### Provenance 字段结构

```json
{
  "provenance": {
    "source_type": "reflect-agent",
    "task_id": "task_20260501_001",
    "session_ref": "session_20260501_143022",
    "created_at": "2026-05-01T14:30:22Z",
    "trust_status": "unverified"
  }
}
```

`source_type` 枚举：
- `reflect-agent`：反思代理隐式提取
- `user-explicit`：用户显式指令
- `user-confirmed`：用户明确确认
- `web-search`：外部检索注入
- `re-observed`：多次独立观察验证
- `bounded-breaker`：Breaker 生成的置信度报告
- `playwright-design-study`：Playwright 视觉风格学习
- `dembrandt-design-study`：Dembrandt 可选后端视觉提取
- `playwright-visual-critic`：实现后本地页面视觉自评

### 信任状态流转

```
unverified  →  re-observed（同一模式被独立观察 ≥N 次）
unverified  →  user-confirmed（用户明确认可）
re-observed →  user-confirmed（architecture 类必须此路径）
任意状态    →  contested（出现相悖观察）
contested   →  archived（长期未解决，移入归档）
```

---

## 三、分层记忆系统

### 文件结构

```
memory/
├── project-rules.md              # 项目铁律，最高优先级，手动维护
├── preferences.md                # 正式偏好，版本化存储
├── preferences-history/          # preferences.md 历史版本
│   ├── v1_20260501.md
│   └── v2_20260503.md
├── preference-candidates.json    # 偏好候选池，含信任状态机
├── design-candidates.json        # 设计候选池，未确认视觉规则
├── design-profiles/              # 已确认 StyleProfile
│   └── eatconfusion-neobrutalism.json
├── design-active-profile.json    # 当前 UI 实现使用的 StyleProfile
├── design-critiques.json         # Playwright 视觉自评记录
├── questions.json                # 失败案例库，含可信度标记
├── quality-feedback.json         # 用户质量反馈
├── benchmark-results/            # 基准任务回放结果
└── docs-index/                   # sqlite-vec 向量数据库
    ├── agent.db
    └── metadata.json
```

### 偏好学习双通道

```
隐式通道（行为观察）：
  Reflect Agent 观察 → preference-candidates.json（trust: unverified）
  scope 枚举：code-style / control-flow / architecture / tool-preference / communication
  升级条件（按 scope）：
    code-style / control-flow / tool-preference / communication → ≥2次，自动升级
    architecture → ≥3次且 trust: re-observed，需用户确认后升级
  升级时写入 preferences.md 并创建版本快照

  合并/泛化时：触发 Bounded Breaker（见第七节）
    → confidence: high   → 自动合并，附带完整 Breaker 报告
    → confidence: moderate → 写入 + APPLY_WITH_CAUTION 标记，提示用户
    → confidence: low    → 不合并，保留为独立条目

显式通道（用户指令）：
  "以后不要加注释" / "用 map 不要用 for"
  → trust: user-explicit，直接写入 preferences.md + 版本快照
  → 跳过候选池，跳过 Breaker
```

### preference-candidates.json 结构

```json
{
  "candidates": [
    {
      "id": "pref_001",
      "pattern": "用户删除了生成代码中的行内注释",
      "scope": "code-style",
      "observations": 2,
      "first_observed": "2026-05-01T10:23:00Z",
      "last_observed": "2026-05-03T14:11:00Z",
      "contradictions": 0,
      "status": "observed",
      "trigger_context": "任何文件",
      "breaker_report": null,
      "provenance": [
        {
          "source_type": "reflect-agent",
          "task_id": "task_20260501_001",
          "session_ref": "session_20260501_143022",
          "trust_status": "unverified"
        }
      ]
    }
  ]
}
```

### questions.json 结构

```json
{
  "questions": [
    {
      "id": "q_001",
      "error_type": "tool-error",
      "error_subtype": "selector-not-found",
      "context": "Playwright 无法定位登录按钮",
      "stack_trace": "...",
      "attempts": [
        { "strategy": "降级重试", "result": "失败", "reason": "元素动态渲染" },
        { "strategy": "Web Search 注入", "result": "失败", "reason": "文档过时" }
      ],
      "resolution": "使用 waitForSelector 替代直接 click，超时设置为 5000ms",
      "resolved_at": "2026-05-02T09:30:00Z",
      "status": "resolved",
      "hit_count": 2,
      "last_hit": "2026-05-04T11:00:00Z",
      "provenance": {
        "source_type": "user-confirmed",
        "task_id": "task_20260502_003",
        "session_ref": "session_20260502_093011",
        "trust_status": "user-confirmed"
      }
    }
  ]
}
```

### 记忆清理策略

```
questions.json 清理规则：
  → 超过 90 天未被命中且 status: resolved → 移入 questions-archive.json
  → status: unverified 且超过 30 天无 resolution → 标记为 stale，降低检索权重

preference-candidates.json 清理规则：
  → contradictions ≥ observations → 直接丢弃
  → 超过 60 天未有新观察且未升级 → 降级为 archived
  → archived 超过 30 天 → 删除
```

### Design Study Skill / Visual Style Learner

Playwright 分成两种模式：

```
content-read mode:
  目标：回答网页写了什么
  输出：Readability markdown / 文本摘要
  边界：用户启用 Playwright 后不做域名白名单限制，仅允许 http/https

design-study mode:
  目标：回答网页如何建立视觉风格，哪些规则可迁移
  输出：DesignCandidate / StyleProfile / DesignCritique
```

设计学习流程由 XState 管控，浏览器与外部提取器资源不进入 context：

```
DESIGN_STUDY_REQUESTED
  → OPEN_REFERENCE_URLS
  → CAPTURE_SCREENSHOTS
  → EXTRACT_COMPUTED_STYLE_SAMPLES
  → IDENTIFY_COMPONENT_PATTERNS
  → PRODUCE_STYLE_PROFILE_CANDIDATE
  → BOUNDED_BREAKER_FOR_DESIGN_GENERALIZATION
  → WRITE_DESIGN_CANDIDATE
  → USER_CONFIRM_OR_REOBSERVE
```

采样内容：
- 首屏与移动端截图
- 按角色抽取按钮、卡片、输入框、标签、标题、正文
- `getComputedStyle` 的颜色、字体、边框、圆角、阴影、间距
- 重复组件的布局密度与移动端稳定性

`design-candidates.json` 只存未验证观察；用户确认或多次独立观察后才升级到 `design-profiles/*.json`。Dembrandt 可以作为可选 extractor 后端，但必须由用户显式配置命令，系统不自动安装外部工具。Design Study 必须由 `/design study` 显式触发，参考 URL 不使用通用 Playwright 内容读取白名单，但仍限制为 `http/https`。

实现后视觉自评流程：

```
IMPLEMENT_UI
  → PLAYWRIGHT_SCREENSHOT_LOCAL_PAGE
  → COMPARE_WITH_STYLE_PROFILE
  → SCORE(color, border/shadow, typography, components, density, mobile)
  → score < threshold: 注入 critique failures，要求修正
```

设计泛化必须进入 Bounded Breaker：例如从“参考页按钮有 4px 黑边”提升到“所有交互组件用粗黑边”时，要标注输入框、小标签、密集列表、移动端拥挤等失败边界。

---

## 四、失败升级阶梯

### 错误分类体系（五类）

| 大类 | 子类示例 | 恢复策略 |
|---|---|---|
| 环境错误 | 网络不可达、API Key 过期、权限不足 | 不消耗重试次数，直接报告用户 |
| 工具错误 | Playwright selector 找不到、工具版本不兼容 | 降级重试 / 拆分重试 |
| 模型错误 | 幻觉、格式错误、推理谬误 | 上下文复位 / 扩展思考 |
| 用户输入错误 | 任务描述模糊、需求冲突 | 主动问询 |
| 状态冲突错误 | 子代理并行操作同一文件 | 回退 Orchestrator，注入冲突信息重新分解 |

### 快照粒度

```
触发时机：每次 Executor 工具调用执行前自动快照
实现：git 本地操作，开销极低
快照内容：工作区文件 diff（不含外部副作用）
回滚语义：仅恢复文件系统状态
```

### 回滚承诺边界

```
✅ 承诺回滚：工作区文件修改 / 工具自身产生的新建删除文件
❌ 不承诺回滚：外部 API 调用副作用 / 数据库写入 / 环境变量修改
   → 不可逆操作执行前显式告知用户
```

### 高风险操作确认机制

```
默认需要用户确认的操作类别：
  - 删除文件 / 目录
  - 写入数据库
  - 调用外部 API（非幂等）
  - 修改环境变量

用户可在 project-rules.md 中配置豁免：
  [confirmation-exempt]
  - delete-file
  - external-api
```

### 策略空间（Attempt 1 可用）

| 策略 | 触发条件 | 行为 |
|---|---|---|
| 降级重试 | 工具调用返回不可恢复错误 | 用更底层工具替代 |
| 拆分重试 | 步骤粒度过粗导致超时/幻觉 | 将当前步骤拆为 3-5 个子步骤 |
| 上下文复位 | 输出偏离任务目标且无法自纠 | 保留任务定义，丢弃中间推理，重新规划 |
| 扩展思考 | 逻辑推理类任务失败 | 启用 extended thinking，预算翻倍 |
| 模型切换 | 特定类型错误重试后未解决 | 切换备选模型，仅限第三级失败时 |

### Attempt 2 搜索意图提取失败分支

```
尝试从错误信息提取检索意图
  → 提取成功：调用 Web Search MCP，注入结果重试
  → 提取失败（错误信息过于模糊）：
      跳过 Attempt 2，直接进入 Attempt 3
      诊断报告中注明："无法提取有效搜索意图，已跳过外部知识注入"
```

### 中断处理

```
触发：用户 Ctrl+C 或输入 /cancel

State Machine 中断状态流转：
  任意执行状态 → INTERRUPTED
    1. 停止所有 Executor 工具调用
    2. 子代理开启时：向所有子代理发送终止信号，等待优雅退出
    3. 执行文件系统回滚（还原到本次任务开始前的快照）
    4. 询问用户："已回滚本次任务的文件修改。是否触发 Reflect Agent 记录本次中断？"
    5. 用户确认 → 触发 Reflect Agent（记录中断原因，不写入 preferences）
       用户拒绝 → 直接退出，不留记录
```

---

## 五、子代理 Skill 实现详述

### Planner 依赖分析边界声明

```
承诺：静态 import / require / config-based 依赖检测
不承诺：
  - 字符串拼接路径（如 require(`./handlers/${type}`)）
  - eval / dynamic import 的运行时依赖
  - 外部服务的隐式共享状态

当静态分析无法覆盖时：
  → 任务树中标注"动态依赖风险"
  → 运行时若发生冲突，由状态冲突错误类型接管
```

### Write Intent 主动防护

```
Planner 在输出任务树前完成冲突检测：

1. 每个子任务声明 Write Intent（预计写入的文件列表）
2. Planner 在任务树确认前做全局交叉检查
3. 发现重叠：
   → 重新分解，将冲突文件归入单一子代理
   → 或将冲突文件拆出为独立的串行步骤
4. 用户看到的任务树是无冲突的

运行时兜底：
   → 实际写入时再次检测（Write Intent 可能因动态依赖失效）
   → 冲突触发状态冲突错误类型
```

### 任务分解流程

```
任务：重构 auth 模块
├── sub-agent-1：重构 auth/login.ts（写入：auth/login.ts）
├── sub-agent-2：重构 auth/token.ts（写入：auth/token.ts）
└── sub-agent-3：更新 tests/auth.test.ts（依赖 1、2，写入：tests/auth.test.ts）
⚠ 注意：auth/utils.ts 含动态依赖，冲突风险由运行时检测兜底
```

### 状态冲突处理

```json
{
  "error_type": "state-conflict",
  "conflicting_agents": ["sub-agent-2", "sub-agent-4"],
  "shared_resource": "src/utils/config.ts",
  "recommended_action": "re-decompose"
}
```

Orchestrator 注入冲突信息重新分解：

```
上次分解产生冲突：
sub-agent-2 和 sub-agent-4 同时操作了 src/utils/config.ts
请重新分解，确保每个文件只被一个子代理负责
```

---

## 六、隐式策略漂移防护

### preferences.md 版本化

```
每次写入 preferences.md 前：
  1. 复制当前版本到 preferences-history/v{N}_{timestamp}.md
  2. 写入新内容
  3. 在文件头部记录版本号和变更摘要

文件头部格式：
  # preferences.md
  # version: 3
  # last_updated: 2026-05-03T14:11:00Z
  # change: 新增 code-style 规则（来源：task_20260503_007）
```

### 决策来源追溯（/why 命令）

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 本次决策来源

 [偏好] code-style v2（2026-05-03 更新）
   → "不在生成代码中添加行内注释"
   → Breaker 报告：high confidence，已知失败场景：无
 [案例] q_001（命中 2 次）
   → "使用 waitForSelector 替代直接 click"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 七、Bounded Breaker（v0.3 新增）

### 设计范式

**不证明规则正确，只标注已知失败边界。**

用 AI 验证 AI 的智能上限同样受限——如果规则的缺陷隐藏得足够深，Breaker 自己也无法构想出那个反例。因此 Bounded Breaker 的目标不是"证明正确"，而是"主动寻找已知失败边界"，并将不确定性结构化地呈现给用户。

### 触发条件（准入规则）

| 触发场景 | 示例 | 是否进入 Breaker |
|---|---|---|
| Reflect Agent 发现两个候选偏好高度相似，提议合并 | "auth timeout 5000ms" + "payment timeout 5000ms" → "network timeout = 5000ms" | ✅ 必须进入 |
| Reflect Agent 将具体模式抽象为更高层规则 | "用户在 utils.ts 中删除了注释" → "用户不喜欢行内注释" | ✅ 必须进入 |
| 用户显式指令写入偏好 | "以后不要加注释" | ❌ 跳过，直接写入 |
| 单一模式被观察 ≥N 次，无合并无抽象 | "用户在测试文件中使用 describe" | ❌ 跳过，直接升级 |
| 信任状态从 unverified → re-observed，无合并无抽象 | 同一模式被多次观察到 | ❌ 跳过，仅升级信任状态 |

**核心原则：只有涉及语义改造（合并多个模式、或提升抽象层级）时，才触发 Breaker。**

### 冷启动保护

```
任务计数 < 20：
  所有 scope 的合并/泛化观察阈值统一提升至 ≥4 次
  原因：早期数据样本不足，泛化容易过拟合少量偶发行为

任务计数 ≥ 20：
  恢复各 scope 的原始阈值（code-style ≥2，architecture ≥3 等）

不引入新系统状态，仅在阈值判断时读取任务计数器。
```

### 在 Reflect Agent 流程中的位置

```
Reflect Agent 运行周期
    │
    ├── 1. 扫描会话历史 + git diff
    │
    ├── 2. 提取行为模式 → preference-candidates.json
    │
    ├── 3. 检测相似模式
    │       │
    │       ├── 无可合并模式 → 跳过 Breaker，直接更新观察计数
    │       │
    │       └── 发现可合并/可泛化模式 → 触发 Bounded Breaker
    │               │
    │               ├── 主动分析泛化后适用域扩大的部分
    │               │   → 扩大的范围优先进入策略库
    │               │
    │               ├── 策略选择器选取破坏策略
    │               ├── 生成置信度报告
    │               │
    │               ├── confidence: high     → 自动合并
    │               │                          必须附带完整 Breaker 报告
    │               │                          支持 /why 追溯
    │               ├── confidence: moderate → 写入 + APPLY_WITH_CAUTION
    │               │                          展示报告，由用户决策
    │               └── confidence: low     → 不合并，保留为独立条目
    │
    └── 4. 清理过期条目
```

### 主动生成 unknown_risk_zones

```
传统做法（被动）：
  跑完策略库，剩下没测到的 = unknown_risk_zones
  问题：unknown 是"黑洞"，用户不知道有多大

v0.3 做法（主动）：
  1. 分析泛化前的原始模式适用域
  2. 分析泛化后的规则适用域
  3. 计算差集 = 适用域扩大的部分
  4. 差集优先进入破坏策略的测试范围
  5. 测试未覆盖的差集 = unknown_risk_zones（已知自己不知道的）

效果：unknown_risk_zones 从"我没测到的"变成"我知道自己没测到的"
      用户看到的是一张地图，而不是一个黑洞
```

### 预算约束

| 约束项 | 值 |
|---|---|
| 每次 Reflect Agent 运行最多触发 Breaker 次数 | 3 |
| 单次 Breaker 的 Token 预算 | 10k |
| 单次 Breaker 的时间预算 | 1 次 LLM 调用 |
| 预算耗尽后的行为 | 剩余候选规则标记为 unverified，附注"未进入 Breaker，跳过验证" |

### 置信度报告结构

```json
{
  "rule": "所有网络请求的超时时间 = 5000ms",
  "original_patterns": [
    "auth timeout 5000ms",
    "payment timeout 5000ms"
  ],
  "generalization_delta": {
    "original_scope": ["auth module", "payment module"],
    "generalized_scope": ["all network requests"],
    "expansion": ["file upload", "streaming response", "webhook", "third-party API"]
  },
  "status": "bounded",
  "confidence_level": "moderate",
  "breakers_applied": [
    {
      "strategy": "极端值测试",
      "result": "未发现反例"
    },
    {
      "strategy": "上下文对抗测试",
      "result": "找到反例，大文件上传场景失败"
    }
  ],
  "known_failure_context": ["large file upload > 50MB"],
  "unknown_risk_zones": ["streaming response over HTTP/2", "webhook long-polling"],
  "recommendation": "APPLY_WITH_CAUTION",
  "provenance": {
    "source_type": "bounded-breaker",
    "task_id": "task_20260503_007",
    "trust_status": "bounded"
  }
}
```

### 不触发 Breaker 的边界情况

| 场景 | 原因 |
|---|---|
| 用户显式 /review 确认的偏好 | 用户已作为最终仲裁者 |
| preferences.md 已存在的规则被命中 | 不是新规则，无需审查 |
| questions.json 的 resolution | 故障恢复记录，不是行为规则 |
| 单一模式的信任状态升级 | 计数变化，不是语义变化 |
| 规则的 contradictions 增加导致降级 | 衰减，不是生成 |

---

## 九、Stream Adapter 与超时契约

### 设计目的

AI SDK 的流式输出是逐 token 到达的事件流，XState 需要原子的状态转移事件。两者之间存在阻抗不匹配：如果直接将流式事件喂给状态机，状态机会在每个 token 上触发转移判断，既低效又难以管控快照粒度。

**Stream Adapter 的职责**：缓冲一个完整执行回合内的所有流式 Tool Call 事件，回合结束时向 XState 发送一个原子的 `EXECUTION_ROUND_COMPLETE` 事件。

```
一个执行回合 = 一次 LLM 调用 + 其产生的所有工具调用结果
             = 一次快照点
             = 一次状态转移
```

### Stream Adapter 与 XState 的契约

```
Stream Adapter 承诺：
  在 120 秒内完成一个执行回合的缓冲并交付 EXECUTION_ROUND_COMPLETE
  或什么都不交付（由 XState 的 after 超时接管）

Stream Adapter 不感知计时逻辑：
  超时检测完全由 XState after(120000) 配置处理
  Adapter 无需内置定时器
```

### 超时处理流程

```
XState 等待 EXECUTION_ROUND_COMPLETE
    │
    ├── 120s 内收到 → 正常状态转移，执行快照
    │
    └── 120s 超时（after 触发）→ EXECUTION_TIMEOUT
            │
            ├── 快照回滚（还原到本轮执行前状态）
            ├── 保留超时计数（timeout_count + 1）
            │
            ├── timeout_count ≤ 2 → 重试
            │     注入上下文：
            │     "上次执行因超时中断（已回滚）。
            │      中断前最后确认完成的工具调用：[tool_name]（如有）。
            │      请从头重新规划本轮执行，不要假设上次的中间状态仍然有效。"
            │
            └── timeout_count > 2 → 进入失败升级阶梯（Attempt 2/3）
```

### 子代理场景

```
超时仅影响产生超时的子代理，不影响其他子代理
Orchestrator 收到子代理超时通知后决策：
  → 重新分配该子任务给新的子代理
  → 或将该子任务标记为跳过，在诊断报告中注明
```

---

## 十、上下文压缩机制

```
触发条件：context 使用量达到 70%
压缩方式：
  单次长任务     → 滚动摘要（独立调用，保留任务目标+关键决策+未解决问题）
  跨任务/session → 结论写入 questions.json 和 preferences.md 持久化

Cache 策略（Anthropic prompt cache）：
  system prompt          → cache_control: ephemeral（必中）
  project-rules.md       → cache_control: ephemeral（变化极少）
  preferences.md         → cache_control: ephemeral（变化极少）
  questions.json 摘要    → 视长度决定
  当前任务上下文         → 不缓存
  子代理开启后任务树      → 确认后打入 cache，所有子代理共享
```

---

## 十一、质量监控层（Quality Watchdog）

### 信号源一：日常质量感知（用户反馈）

```
触发方式：CLI Footer 常驻静默提示（不全屏打断主任务流程）

Footer 显示：
  3 个任务后可以评价我的表现：[👍] [✅] [👎]

用户点击 👎 时：追问一个开放式问题
  "是代码不够简洁，还是我选错了工具？"
  → 回答写入 quality-feedback.json

局限性：用户会疲劳、会麻木，该信号会随时间退化，不能是唯一信号源
```

### 信号源二：低频基准任务校准

```
触发时机：每周 或 每 20 个任务后，后台静默运行
基准任务：2-3 个固定任务（CRUD / bug修复 / 模块重构），不使用外部依赖，保证可复现

评估维度：
  策略稳定性        是否还首选策略空间内的正确策略
  任务分解稳定性    子代理开启时，任务树分解模式是否剧烈偏移
  信息来源健康度    是否大量依赖 unverified 或 stale 信息
  视觉一致性        UI 实现是否偏离已确认 StyleProfile
  设计候选健康度    是否大量依赖 unverified design candidates

警报规则：≥2 个指标同时退化 → 触发全屏警报
          单一指标退化 → 记录，不打扰用户

警报后行为：输出结构化报告，不自动修改任何系统行为，是否干预由用户决定
```

### 双信号源冗余逻辑

```
用户反馈有效     → 以用户反馈为准（更贴近真实体感）
用户反馈退化     → 基准任务捕获结构性偏移
两者同时失效     → 系统无感知地持续退化（Quality Watchdog 存在的根本原因）
```

---

## 十二、原型阶段验证边界警告

### 验证阶段划分

| 阶段 | 条件 | 验证目标 |
|---|---|---|
| 原型阶段 | 单一用户、干净环境、简单任务 | 控制流正确性 |
| Beta 阶段 | 多用户、3 周真实使用 | 长期行为稳定性、Quality Watchdog 有效性 |
| 稳定阶段 | 持续使用 | 目标函数漂移的实际发生率 |

```
✅ 原型可验证：
  - State Machine 流转、失败升级触发、中断处理
  - questions.json 写入与命中、preferences 双通道
  - Planner 任务分解基本逻辑
  - Context7 / Playwright 文档检索链路
  - Bounded Breaker 触发条件与置信度报告格式

❌ 原型无法验证：
  - 长期行为稳定性（偏移风险在第 20-50 个任务后才出现）
  - 目标函数漂移（可能在没有任何错误的情况下悄悄发生）
  - preference-candidates 的模式签名校准
  - Bounded Breaker 的策略库覆盖率是否足够
```

> **警告**：原型阶段跑通 ≠ 架构验证成功。不要在原型阶段就锁架构、加功能。真正的风险在 Beta 阶段才会显现——此时 Quality Watchdog 必须已经就位。

---

## 十三、工程基础

### 基于 pi 二次开发

Student Agent 基于 [pi（badlogic/pi-mono）](https://github.com/badlogic/pi-mono) 进行二次开发，而非从零搭建。

**pi 已经提供的能力（无需重写）：**
- CLI 的基本 REPL 循环
- 工具注册与调用机制
- 流式输出管理
- MCP Client 集成
- TypeScript 运行时骨架

**Student Agent 在 pi 之上叠加的差异化能力：**
- XState 状态机（替代 pi 的线性执行流）
- 三级失败升级阶梯
- 分层记忆系统（preferences / questions / docs-index）
- Reflect Agent + Bounded Breaker（异步后台）
- Quality Watchdog
- 子代理 Skill（按需开启）
- Prompt Cache 策略

**开发策略：**
先跑通 pi 的核心循环，再逐步将 Student Agent 的模块嵌入，不破坏 pi 的基础结构。

---

## 十四、实现注意事项

### SQLite 并发写入冲突防护

Reflect Agent、Bounded Breaker、questions.json 写入、preference-candidates 更新等多个组件可能在异步环境下并发操作同一 SQLite 数据库文件，直接写盘会产生锁竞争和数据损坏风险。

**方案：WriteQueue 单例**

```
所有组件不直接写盘
写入请求统一提交给 WriteQueue
WriteQueue 串行执行所有写操作

实现：
  const writeQueue = new PQueue({ concurrency: 1 })

  // 任何组件写入时：
  await writeQueue.add(() => db.run(sql, params))
```

WriteQueue 是进程级单例，在应用启动时初始化，所有需要写盘的模块引用同一实例。读操作不受限制，可并发。

---

## 十五、技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| Runtime | Node.js + TypeScript | 与现有工具链一致 |
| 基础框架 | pi（badlogic/pi-mono） | CLI REPL、工具调用、MCP Client 骨架 |
| LLM | Anthropic SDK（Claude） | 原生支持 prompt cache、extended thinking |
| 向量存储 | sqlite-vec | 零依赖，预编译二进制，跨平台 |
| MCP | @modelcontextprotocol/sdk | 标准协议，Context7 / Web Search 均可接入 |
| 页面读取 | Playwright + @mozilla/readability | 处理 JS 渲染与登录态 |
| 状态机 | XState v5 | 显式状态约束，after 超时，context 只存 ID |
| 并发写入 | p-queue（WriteQueue 单例） | SQLite 串行写入，防并发锁竞争 |
| CLI UI | Ink（React for terminal） | 流式渲染、Footer 图标、子代理进度展示 |

---

## 十六、技术债登记

| 编号 | 描述 | 优先级 |
|---|---|---|
| TD-01 | MCP Schema 校验层：检索层增加校验装饰器，失败时标记"不可信来源" | v0.3 |
| TD-02 | 动态知识缓存（project-kb.json）：缓存外部文档，需处理版本一致性 | v0.3 |
| TD-03 | 向量嵌入模型选型：本地嵌入 vs API 嵌入的冷启动/网络依赖取舍 | 开发前确认 |
| TD-04 | Playwright 会话加密存储：browser-profile/ 需加密；域名白名单不再默认限制显式 Playwright 行动 | 开发期 |
| TD-05 | 策略选择器决策树形式化：选择哪个策略的决策树尚未形式化 | 开发期 |
| TD-06 | 模式签名校准：反思代理生成签名的 prompt 需反复测试 | 开发期 |
| TD-07 | Breaker 策略库版本化维护：策略库本身需要随时间更新，否则会退化 | Beta 阶段 |

---

## 十七、开放问题

1. **questions.json 归档阈值差异化**：90 天是否合适？不同 scope 的 question 是否需要不同衰减周期
2. **/why 命令的追溯深度**：只展示直接来源，还是追溯完整来源链（某个偏好是从哪个任务观察来的）
3. **子代理 Merge Agent**：处理多个子代理输出文件间整合的可选后处理步骤，内置还是做成 skill
4. **Bounded Breaker 的策略库初版内容**：需要在开发前设计好初始策略集合，覆盖哪些基本的破坏方式

---

*文档版本：v0.32 | 已进入开发阶段，大部分设计已实现；细节可能落后于 src/ 源码，以源码为准*

---

## 附录：版本变更摘要

**v0.31**
- 修正一：SQLite 并发写入冲突防护，新增 WriteQueue 单例
- 修正二：Quality Watchdog 反馈疲劳，改为 Footer 常驻静默图标，取消全屏打断
- 修正三：Bounded Breaker 冷启动防护，任务数 < 20 时统一提升合并阈值至 ≥4 次
- 修正四：新增 Stream Adapter，解决流式输出与 XState 的阻抗匹配问题
- 修正五：Stream Adapter 超时兜底，XState after 120s 接管，超时重试上下文注入规范
- 合并发布：Design Study Skill / Visual Style Learner，支持显式网页风格学习、StyleProfile 记忆和本地视觉自评
- 子代理硬化：Merge Agent 定位为 Orchestrator 内部 Synchronizer；SubAgentTask 增加 readIntent，调度前执行 reader-writer/write-write 锁检查
- 技术债收敛：Context7/MCP 响应增加 schema 校验；新增 project-kb.json TTL 缓存；Breaker 报告写入 strategy_version
- 开放问题收敛：questions.json 引入 decay_factor；/why 默认展示直接来源，/why --trace 展示完整溯源；/review 接入质量反馈主路径（*Gemini 审阅*）

**v0.3**
- 新增 Bounded Breaker：仅在语义合并/抽象泛化时触发，生成置信度报告替代机械的通过/不通过判定
- 新增主动生成 unknown_risk_zones：分析泛化后规则适用域扩大的部分，优先进入策略库
- confidence_level: high 的自动合并强制附带完整 Breaker 报告，支持 /why 追溯
- Breaker 策略库本身需要版本化维护，登记为技术债 TD-07
- 范式升级说明：不证明规则正确，只标注已知失败边界

**v0.21**
- 新增质量监控层（Quality Watchdog）：用户反馈主路径 + 基准任务低频校准，双信号源冗余
- 新增原型阶段验证边界警告：明确原型能验证什么、不能验证什么（*ChatGPT 主要贡献*）

**v0.2**
- 新增信息可信度体系（provenance + 信任状态机）
- 新增隐式策略漂移防护（preferences 版本化 + 决策来源追溯）
- 明确快照粒度（每次 Executor 执行前快照）
- 新增 Planner 依赖分析边界声明
- 新增子代理 Write Intent 主动防护
- 新增搜索意图提取失败分支
- 新增中断处理状态（Ctrl+C / /cancel）
- 新增高风险操作确认机制
- 新增记忆清理策略（*DeepSeek + ChatGPT + Claude 三方审阅*）
