# student-agent

> **真正的大师，永远都怀着一颗学徒的心**

[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Eval Fixtures](https://img.shields.io/badge/eval%20fixtures-10%2F10%20validate-success)](evals/)

一个具备记忆、自我反思和边界感知的 CLI 编程代理。基于 [pi](https://github.com/badlogic/pi-mono) 构建，专注于编程任务。

[English README →](README.md)

---

## 评测结果

三档评测矩阵（回归冒烟 / 学习 eval / 外部参照），每个 run 可溯源到
commit + 模型 + 单价。2026 年 6 月要点：

- **同模型同题下 token 消耗低约 2.6~4.1 倍**（SWE-bench Lite，历史内部参照，不构成产品对比）
- **150 token 的常驻规则使成本波动 4~6 倍**——trace diff 定位，政策补丁修复（受影响题 -57%，质量不降）
- **约束遵循四层下钻案例**（terminal-bench `overfull-hbox`）：从"约束装配丢失"修到"脚本化穷举自查"，3/3 seed 通过，全程无任务专用 hack
- **跨任务记忆的诚实 NO-GO**：memory on/off 双臂均 4/6——召回管道实战可运行，质量收益尚未证明，病灶已定位到 lesson 写入层。先证明，再宣称。
- Sonnet 4.6 全部评测花费 **$7.27**（cache 探针先行、成本熔断、无效 run 哨兵）

→ [完整报告](docs/benchmark-report-2026-06.md) ·
[学习 eval 协议](docs/adr/ADR-002-learning-eval-protocol.md) ·
[宣称纪律](docs/adr/ADR-001-eval-claim-separation.md)

---

## 目录

- [评测结果](#评测结果)
- [快速开始](#快速开始)
- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [架构概览](#架构概览)
- [项目结构](#项目结构)
- [配置](#配置)
- [开发工作流](#开发工作流)
- [测试与评测](#测试与评测)
  - [单元测试](#单元测试)
  - [评测框架设计](#评测框架设计)
  - [评分系统](#评分系统)
  - [任务目录](#任务目录)
  - [运行评测](#运行评测)
  - [结果解读](#结果解读)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

---

## 快速开始

### 前置条件

- Node.js 20+
- Git

### 安装

```bash
# 1. 克隆本仓库
git clone https://github.com/nashorya/student-agent.git
cd student-agent

# 2. 安装依赖（pi SDK 已锁定为可复现的 npm 版本）
npm install

# 3. 配置环境变量，或首次启动时按引导完成设置
cp .env.example .env
# 编辑 .env，或运行 npm run dev 后按提示选择 provider/model
```

### 最小 `.env` 配置

```env
# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# 或 OpenAI 兼容接口
STUDENT_AGENT_PROVIDER=openai
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-...
STUDENT_AGENT_MODEL=gpt-4o
```

如果启动时没有检测到可用模型密钥，首次启动引导会帮你选择 Provider、API 格式、可选 Base URL、API Key 和模型，并写入本地/全局 student-agent 配置。

### 启动

```bash
# 开发模式（TTY 下使用 TUI，否则降级为 readline）
npm run dev

# 或编译后全局注册
npm run build
npm link
student-agent          # 在任意目录启动
```

用自然语言描述任务并回车，代理会规划、执行并反思——每个阶段会在状态栏中显示。输入 `/exit` 或按 `Ctrl-C` 退出。

Benchmark 或脚本里可以用非交互模式：`student-agent --prompt "修复当前仓库里的测试失败"`，长指令建议用 `student-agent --prompt-file /path/to/instruction.md`。

常用斜杠命令：

| 命令 | 用途 |
|---|---|
| `/help` | 查看可用命令。 |
| `/status` | 查看当前任务/运行时状态。 |
| `/model` | 在保持当前 provider/API 设置不变的情况下快速切换模型。 |
| `/setting` 或 `/settings` | 重新进入模型或 embedding 设置流程。 |
| `/task status` | 查看活跃任务详情。 |
| `/review up|ok|down` | 记录质量反馈。 |
| `/design study <url>` | 在启用 Design Study 时从参考页面学习视觉风格。 |

### 可选：Playwright 浏览器

仅在 `STUDENT_AGENT_FEATURE_PLAYWRIGHT=true`（默认开启）时需要：

```bash
npx playwright install chromium
```

---

## 功能特性

| 功能 | 说明 |
|---|---|
| **终端 UI** | 基于 Ink/React 的 TUI，支持流式输出、状态栏和斜杠命令选择器。在非 TTY 环境（CI、管道）自动降级为 readline。 |
| **分层记忆** | 通过双通道跨会话学习偏好：隐式通道（Reflect Agent 行为观察）和显式通道（用户指令）。版本化存储，带来源追溯。 |
| **Bounded Breaker** | 泛化模式时主动生成已知失败边界，而非盲目推广规则。置信度报告让用户清楚看到不确定性。 |
| **失败升级阶梯** | 变更操作前先快照（git stash）。失败时：回滚 → 降级策略重试 → 注入 Web 搜索 → 结构化诊断升级给用户。 |
| **风险守卫** | 高风险操作（删除、外部 API、数据库写入）默认需要确认。可通过 `project-rules.md` 配置豁免。 |
| **知识检索** | Context7 精确库文档检索，Playwright 处理 JS 渲染页面并保持持久化登录会话。 |
| **设计学习** | 视觉风格学习器：从参考 URL 提取 StyleProfile，并对本地实现进行视觉自评。 |
| **质量监控** | 双信号退化检测——用户反馈提示 + 后台基准任务定期校准。UI 展示仍在稳定中。 |
| **子代理编排** | 实验性并发子代理，带写意图冲突检测。默认关闭。 |
| **任务/计划工作流** | 渐进式披露：简单任务保持轻量；复杂多步任务进入完整的计划 → 执行 → 验证 → 用户验收流程。 |

---

## 技术栈

| 层 | 选型 | 版本 | 说明 |
|---|---|---|---|
| 运行时 | Node.js / TypeScript | 20+ / 5.x | 与现有工具链一致 |
| 基础框架 | [pi](https://github.com/badlogic/pi-mono) | 0.73.1（npm 锁定） | CLI REPL、工具调用、MCP Client 骨架 |
| LLM 运行时 | Pi SDK model registry | 可配置 | 使用 Pi 的 `Model<Api>` registry，支持 Anthropic 和 OpenAI 兼容 provider。 |
| 向量存储 | sqlite-vec | 0.1.9 | 零依赖，预编译二进制，跨平台 |
| MCP | @modelcontextprotocol/sdk | — | 标准协议；Context7、Web Search 直接接入 |
| 页面读取 | Playwright + @mozilla/readability | 1.59.1 / 0.6.0 | JS 渲染页面，持久化登录会话 |
| 状态机 | XState v5 | 5.x | 显式状态约束，`after` 超时，context 只存 ID |
| 并发写入 | p-queue（WriteQueue 单例） | 9.x | SQLite 串行写入，防并发锁竞争 |
| 终端 UI | Ink（React for terminal） | 5.x | 流式渲染、状态栏、斜杠命令输入 |
| Git 快照 | simple-git | 3.x | 低开销执行前快照与回滚 |
| 测试框架 | Vitest | 2.x | 快速、ESM 原生，与源码同目录的 `__tests__/` |

---

## 架构概览

```
输入（自然语言 / URL / 文件路径）
        │
        ▼
┌───────────────────────────────────┐
│           核心代理                │
│  Planner → Executor → XState v5   │
│  Stream Adapter（缓冲轮次）       │
│  Risk Guard + Snapshot 钩子       │
└────────────┬──────────────────────┘
             │
     ┌───────┴────────┐
     ▼                ▼
知识检索层        失败升级阶梯
─────────         ──────────────
Context7          第1次：回滚 + 重试
Playwright        第2次：注入 Web 搜索
Design Study      第3次：结构化诊断 → 升级给用户
             │
             ▼
     分层记忆
     ─────────────
     project-rules.md          （最高优先级，手动维护）
     preferences.md            （版本化，带来源追溯）
     preference-candidates.json （信任状态机）
     questions.json            （失败案例库）
     docs-index/               （sqlite-vec 嵌入向量）
             │
             ▼
     Reflect Agent + Bounded Breaker（异步）
     Quality Watchdog（后台）
     Sub-agent Orchestrator（可选）
             │
             ▼
     TUI / Readline 输出
```

完整设计见 [`docs/student-agent-architecture-v0.32.md`](docs/student-agent-architecture-v0.32.md)、[`docs/student-agent-task-plan-workflow.md`](docs/student-agent-task-plan-workflow.md) 和 [`docs/onboarding.md`](docs/onboarding.md)。

---

## 项目结构

```
student-agent/
├── src/
│   ├── cli/            # Banner、命令解析、事件渲染、Markdown
│   ├── core/           # 配置、环境、执行器、状态机、任务规划、写队列
│   ├── evals/          # 评测框架：agent runner、baseline runner、scorer、sandbox
│   ├── extension/      # Pi 钩子（FileGuard、RiskGuard、Snapshot）
│   ├── knowledge/      # Context7、Playwright、Design Study、MCP schema 校验
│   ├── memory/         # candidates、design、docs-index、preferences、questions、tasks
│   ├── orchestrator/   # 子代理编排、Merge Agent
│   ├── reflect/        # Reflect Agent、Bounded Breaker
│   ├── tui/            # Ink 组件（App、InputLine、OutputArea、StatusBar）
│   ├── types/          # 共享 TypeScript 类型
│   └── watchdog/       # Quality Watchdog
├── evals/
│   ├── tasks/          # 评测任务定义（instruction、environment、tests、solution）
│   ├── results/        # 基准运行结果（git-ignored）
│   ├── product-rubric.md  # 评分校准指南
│   └── README.md       # 评测框架参考文档
├── memory/             # 运行时记忆文件（除 project-rules.md 外均 git-ignored）
├── docs/               # 架构与工作流设计文档
├── scripts/            # 评测框架脚本
└── bin/                # CLI 入口
```

---

## 配置

所有配置可通过 `.env` 或 `.student-agent.json` 设置。

### 核心配置

| 变量 | 默认值 | 说明 |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | 必填。Anthropic API 密钥。 |
| `STUDENT_AGENT_PROVIDER` | `anthropic` | LLM 提供商（`anthropic` 或 OpenAI 兼容接口）。 |
| `STUDENT_AGENT_MODEL` | `claude-sonnet-4-6` | 模型标识符。 |
| `ANTHROPIC_BASE_URL` | — | 可选 Anthropic 兼容 relay/proxy URL。 |
| `OPENAI_API_KEY` | — | 当 `STUDENT_AGENT_PROVIDER=openai` 时必填。 |
| `OPENAI_BASE_URL` | — | 可选 OpenAI Chat Completions 兼容端点。 |
| `STUDENT_AGENT_MODEL_BASE_URL` | — | 跨 provider 的模型 Base URL 覆盖项。 |
| `STUDENT_AGENT_EXECUTION_MODE` | `yolo` | `yolo` = 自动执行各阶段；`safe` = 每阶段显式确认。 |

### 功能开关

| 开关 | 默认值 | 说明 |
|---|---|---|
| `STUDENT_AGENT_FEATURE_CONTEXT7` | `true` | 通过 Context7 MCP 检索库文档。 |
| `STUDENT_AGENT_FEATURE_PLAYWRIGHT` | `true` | 读取 JS 渲染页面。 |
| `STUDENT_AGENT_FEATURE_DESIGN_STUDY` | `true` | 从参考 URL 学习视觉风格。 |
| `STUDENT_AGENT_FEATURE_BOUNDED_BREAKER` | `true` | 置信度评分的模式泛化。 |
| `STUDENT_AGENT_FEATURE_QUALITY_WATCHDOG` | `true` | 被动质量退化检测。 |
| `STUDENT_AGENT_FEATURE_SUB_AGENTS` | `false` | 并发子代理编排。 |

### 高风险操作豁免

创建 `memory/project-rules.md` 并添加 `[confirmation-exempt]` 段：

```markdown
[confirmation-exempt]
- delete-file
- external-api
```

---

## 开发工作流

```bash
npm run dev          # 启动代理（TTY 下 TUI，否则 readline）
npm run build        # 编译 TypeScript → dist/
npm test -- --run    # 单次运行 Vitest 单元测试
npm run eval:validate # 不调用模型，验证 eval fixture
```

每次改完代码跑 `npm run build`——它能捕获测试覆盖不到的类型错误。提交前跑 `npm test -- --run`。两者都干净才能发 PR。

---

## 测试与评测

### 单元测试

单元测试与源码同目录存放于 `__tests__/` 中，使用 Vitest 运行：

```bash
npm test -- --run
```

覆盖配置加载、执行器逻辑、状态机转换、记忆管理器、scorer 启发式规则等。

---

### 评测框架设计

评测系统（`src/evals/`、`evals/`）是专为代理评测设计的框架。每个任务是一个独立单元，包含四个组件：

| 组件 | 路径 | 用途 |
|---|---|---|
| 指令 | `instruction.md` | 发送给代理的自然语言提示——与真实用户输入完全一致 |
| 环境 | `environment/` | 每次试验前复制到干净沙箱的初始文件树 |
| 验证器 | `tests/test.sh` | 确定性地检查结果的 shell 脚本——exit 0 = 通过 |
| 参考解答 | `solution/solve.sh` | `eval:validate` 用于确认任务可解的已知正确方案 |

**环境隔离是关键。** 每次试验在独立沙箱目录中运行。运行间的共享状态（残留文件、缓存数据）会引入与代理性能无关的相关性失败。框架会在执行前后对文件系统做快照，用于检测意外变更。

**两种执行模式** 对应不同的真实使用场景：

- `direct` — 代理不走任务生命周期，直接操作文件。用于机械性文件任务。
- `task` — 代理使用完整的 TaskCreate/TaskUpdate 工作流。Scorer 会验证任务状态是否到达 `completed`。

**多次试验暴露非确定性。** LLM 输出在不同运行间存在差异。使用 `--trials N` 对同一任务运行多次试验。这支持两种互补的可靠性视角：

- **pass@k** — 至少有一次试验成功？适用于任意正确解均可接受的场景。
- **pass^k** — 所有试验都成功？面向用户的更严格可靠性标准。

```bash
npm run eval:baseline -- --trials 5
```

---

### 评分系统

每次试验产生两个分数，分别衡量"产出了什么"和"代理如何行为"——多 grader 设计，避免将结果质量和过程质量混淆。

#### `correctness_score` — 主要指标，面向产品

基于结果。由验证器脚本设置，方式之一：

- **退出码** — exit 0 = `1.0`，非零 = `0.0`
- **`reward.txt`** — 验证器写入的 `[0, 1]` 浮点数，支持部分得分
- **`reward.json`** — 结构化 `{ "score": 0.8 }` 格式

如果代理修改了 `expected_files` 之外的文件，无论验证器结果如何，`correctness_score` 强制归零。超出范围的变更是硬性失败。

#### `behavior_score` — 诊断指标，面向工程

基于 transcript。从 `1.0` 开始，每个发现扣 `0.12`。Scorer 会检查工具调用记录中的以下问题：

| 发现 | 捕获的问题 |
|---|---|
| `edit mutated X before a matching read` | 缺少 read-before-edit 规范 |
| `bash used for file read/search/list` | 用 `bash cat/grep/find` 代替文件工具 |
| `edit retried the same failing arguments` | 未改变策略的循环重试 |
| `task mode did not finish with completed task state` | 任务生命周期未完成 |
| `write overwrote N existing file(s)` | 覆盖文件而非编辑 |
| `unexpected changed file(s)` | 范围违规（同时将 `correctness_score` 归零） |

`behavior_score` 是**工程诊断指标**，不是产品门控。只要结果正确，任务即可通过，即使 `behavior_score` 低于 1.0。详见 [`evals/product-rubric.md`](evals/product-rubric.md) 的校准指南。

安全指标（危险 bash 命令、路径逃逸尝试）单独追踪，始终在结果中展示。

---

### 任务目录

任务集同时覆盖"应该发生"和"不应该发生"的行为，避免单向优化。

**机械正确性任务** — 主要以 `correctness_score` 判断：

| 任务 | 标签 | 测量内容 |
|---|---|---|
| `precise-edit` | `edit`、`read-before-edit` | 单位置文件编辑，不触碰周围内容 |
| `write-new-file` | `write` | 从零创建新文件 |
| `multi-file-patch` | `edit`、`multi-file` | 跨多文件的协调变更 |
| `test-driven-bug` | `bash`、`edit` | 在验证器脚本引导下修复 bug |
| `search-before-read` | `grep`、`read` | 读取前先用搜索定位目标 |
| `targeted-read-large-file` | `read`、`offset` | 对大文件使用偏移读取——不读取全部内容 |

**策略与经验任务** — 综合正确性和行为诊断判断：

| 任务 | 标签 | 测量内容 |
|---|---|---|
| `task-phase-flow` | `task-mode` | TaskCreate → 执行 → TaskUpdate 生命周期完整性 |
| `failure-recovery-edit-mismatch` | `edit`、`recovery` | 编辑锚点模糊或失败时的恢复能力 |
| `bash-timeout` | `bash`、`timeout` | 处理挂起的验证器脚本而不冻结 |
| `avoid-overwrite-existing` | `write`、`json` | 更新 JSON 文件而不覆盖现有键 |

**Fixture 状态：** 10 个任务全部通过 `eval:validate`（`initial: 0`、`solution: 1`）。模型基线会受 provider 额度、网络和模型行为影响；发布时请记录实际运行的命令和结果。

---

### 运行评测

```bash
# 确定性固定用例验证——不调用模型，即时完成
npm run eval:validate

# 全量模型基线运行（10 个任务，每个 1 次试验）
npm run eval:baseline

# 运行单个任务
npm run eval:baseline -- --task precise-edit

# 多次试验（暴露非确定性）
npm run eval:baseline -- --trials 5

# 组合：单任务多次试验
npm run eval:baseline -- --task task-phase-flow --trials 5
```

结果写入 `evals/results/`（git-ignored）。每个结果文件包含 `correctness_score`、`behavior_score`、完整 `efficiencyMetrics`、`safetyMetrics`、`behaviorFindings` 以及完整的 `toolCalls` 调用记录。

外部长任务基准的 smoke 入口见 [`docs/external-benchmarks.zh.md`](docs/external-benchmarks.zh.md)，包括 Terminal-Bench、SWE-bench、Claude Code 对照、student-agent custom adapter、DeepSeek 双 key 配置和 dry-run 命令。

---

### 结果解读

**阅读 transcript。** 单靠分数无法判断代理是真正犯了错误，还是 grader 拒绝了一个有效解答。当分数停滞或某个任务意外失败时，检查结果文件中的 `toolCalls` 数组。

**失败应该是"公平"的。** 如果任务失败，调用记录应该清楚地说明出错原因。多次试验中 0% 通过率几乎总是指向任务定义本身的问题——在得出"代理有问题"的结论之前，先检查 `expected_files`、验证器脚本和指令是否存在歧义。

**先运行 `eval:validate`，再运行 `eval:baseline`。** 验证步骤无需调用模型，直接用参考解答运行验证器。如果验证失败，说明任务本身有问题，先修复再消耗 API 额度。

**关注饱和现象。** 随着基准分数趋近 100%，任务集从"能力评测"（代理能做什么？）转变为"回归测试"（代理还能做原来的事吗？）。分数饱和时应添加更难的任务，以保留改进信号。

---

## 项目开发档案

Student Agent 可以维护项目自己的开发档案，并把它渲染为静态的 Project Health 页面。Markdown 始终是规范数据源；HTML 是确定性生成的人类阅读视图，可搜索、筛选，不反向承载业务状态。

发现过程从传给 Student Agent 的项目根目录开始。`.student-agent.json` 中显式配置的 `archive` 路径优先于 `docs/INDEX.md`、`docs/buglog.md`、`docs/adr/` 等约定路径。项目尚无档案时，使用 `/archive init` 做一次初始化；如果发现多个冲突的约定路径，系统会阻止写入，不会静默猜测。

```text
/archive status
/archive init
/archive check
/archive build
/archive adr new <标题>
/archive bug open <标题>
/archive bug update <BUG-ID> [状态]
```

任务执行期间，`archive_record` 只暂存有长期价值的决策、bug 和时间线事件，并在技术验证通过后应用。ADR 即使已经实现并验证，决策状态仍保持 `proposed`；只有用户明确验收任务后才变为 `accepted`。bug 没有通过的验证证据时不能变为 `FIXED`。

默认配置：

```json
{
  "features": { "projectArchive": true },
  "archive": {
    "enabled": true,
    "format": "auto",
    "dashboardPath": "docs/agent/dashboard.html"
  }
}
```

设置 `STUDENT_AGENT_FEATURE_PROJECT_ARCHIVE=false` 可移除 agent 的归档工具；已有档案仍可通过独立命令查看。

---

## 贡献指南

欢迎贡献。提交 PR 前需了解以下几点：

**先阅读架构文档。** [`docs/student-agent-architecture-v0.32.md`](docs/student-agent-architecture-v0.32.md) 涵盖了来源追溯系统、Bounded Breaker 和失败升级阶梯。绕过这些不变量的 PR 会被要求修改。

**提交前进行类型检查。** 运行 `npm run build` 并修复所有错误。项目全程使用严格 TypeScript。

**行为变更需要添加或更新评测任务。** 如果 PR 改变了代理行为（工具选择、任务生命周期、记忆写入），需要添加对应的评测任务或更新现有任务。每个新任务需要：`instruction.md`、`task.toml`、`environment/`、`tests/test.sh`，以及可选的 `solution/solve.sh`。提交前运行 `eval:validate` 确认任务可解。

**保持记忆写入可审计。** 任何写入 `memory/` 的新代码必须包含 `provenance` 字段。长期记忆写入需要用户确认——禁止静默自动写入。

**新功能用开关控制。** 尚未准备好面向所有用户的新能力应放在 `STUDENT_AGENT_FEATURE_*` 开关后面。

**提交信息格式：** 英文 `type(scope): description`。常用类型：`feat`、`fix`、`refactor`、`docs`、`chore`、`test`。

---

## 许可证

MIT
