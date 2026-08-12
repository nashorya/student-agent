# ADR-009：升级到受维护的 Pi，并删除旧 TUI、以 pi-tui 重建 Student Agent 工作台

- 状态：accepted (Phase 0 done; Phase 1+ pending)
- 日期：2026-08-12
- 实现状态：Phase 0 done — `@earendil-works/pi-*` 0.84.1、`src/core/pi-compat`、旧 `src/tui*` 已删、交互暂 readline；GLM thinking 真实请求复验与新 shell 待 Phase 0 收尾 / Phase 1
- 取代：[`docs/plan-legacy-cleanup.md`](../plan-legacy-cleanup.md) 中「保留/渐进迁 tui-v2」路线；与 [`docs/plan-pi-successor-migration.md`](../plan-pi-successor-migration.md) 的 Phase 0 对齐并扩展为含 TUI 重建批次

## 背景

Student Agent 当前同时存在两类基础设施债务。

第一类是 Pi 依赖。当前运行时仍精确锁定在 `@mariozechner/pi-*` 0.73.1，而 TUI 已单独使用 `@earendil-works/pi-tui` 0.78.1。现有迁移计划已经确认旧 Pi 包弃用、Node 基线变化、模型 API 变化以及 provider capability 映射问题，尤其是 GLM-5 `thinking` 参数目前仍依赖额外兼容逻辑。

第二类是产品层。现有交互入口分散在 `src/tui/`（Ink/React v1）与 `src/tui-v2/`（自研行级 renderer + 部分 pi-tui）。二者都不是目标工作台：信息架构不稳，主 Agent 的 reasoning、tool call、Plan/Todo、Subagent、Memory、状态栏未形成可扫读结构；继续打补丁只会重复实现新版 pi-tui 已提供的 viewport / layout / overlay 能力。

本轮工作的目标不是增加 WebUI，也不是更换整个 Agent runtime，而是在一次明确的基础设施窗口中：

1. 先把 Pi 迁移到官方维护中的 `@earendil-works/pi-*`（同代同版本）；
2. **删除全部既有 TUI 实现**（`src/tui/`、`src/tui-v2/`、`src/tui-runtime.ts` 及 Ink / OpenTUI 相关依赖），不为 tui-v2 做兼容补丁或渐进美化；
3. 基于新版 `pi-tui` **从零重建** Student Agent 自己拥有的 TUI shell；
4. 让 Plan、Subagent 和 Agent 当前行为成为一等 UI 状态，而不是散落在日志中的事件。

## 决策

### 1. 统一迁移到官方维护的 Pi successor packages

Student Agent 将从旧的：

- `@mariozechner/pi-agent-core`
- `@mariozechner/pi-ai`
- `@mariozechner/pi-coding-agent`

迁移到同代、同版本的：

- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`

迁移时统一锁定同一个已发布版本（当前施工目标：**0.84.1**），不混用不同代 Pi 包。

Node.js 最低版本同步提升到新版 Pi 要求的基线（**≥22.19**）。

Pi migration 与 TUI rebuild **分成两个连续批次**。先保证运行时迁移完成并可用（非交互 / eval / smoke），再开始 UI 重建，避免同时改变 runtime 和 presentation 两个大变量。Phase 0 **不对** `tui` / `tui-v2` 做 API 适配投资；交互入口可暂时仅保留 headless，直到 Phase 1 新 shell 可启动。

模型 API 采用 **compat 优先**：业务经 `@earendil-works/pi-ai/compat` + 本地薄 adapter（如 `src/core/pi-compat`）接入；不在本批次全面迁到 `createModels()`。

### 2. 删除全部旧 TUI，禁止继续演进 tui-v2

**删除范围（Phase 1 合入前完成或与新 shell 同 PR 删除）：**

| 路径 / 依赖 | 处理 |
|---|---|
| `src/tui/` | 删除（Ink/React 实现） |
| `src/tui-v2/` | 删除（自研行级 renderer；**不做** `TUI`→`TuiMainScreen` 等过渡修补） |
| `src/tui-runtime.ts` | 删除（v1/v2 选择器与 `STUDENT_AGENT_TUI` 逃生口一并废除） |
| `ink`、`react`、`@types/react` | 卸载 |
| `@opentui/core`、`@opentui/solid`、`solid-js` | 卸载 |
| 仅服务于旧 TUI 的测试与脚本开关 | 删除或改写 |

**删除前必须迁出的非 UI 共享件**（仍被 core / extension / eval 引用）迁到非 `tui*` 目录，例如 `src/cli/` 或 `src/runtime/`：

- `logger` / `safeStdout` / `setTuiMode`
- `input-queue`、`paste-buffer`、`prompt-log`
- `debug-events`、`console-redirect`
- 终端清理等与产品 shell 无关的工具函数

**桥接契约**：旧 `TUIBridge` / v2 bridge 不作为长期 API。新 shell 定义自己的 UI projection 接口；`event-renderer` 与 extension 入口改为对接新接口（或 Phase 0 仅保留非交互路径）。

### 3. Pi 继续作为 runtime dependency，但不拥有 Student Agent 的产品界面

Student Agent 不采用 Pi 自带的 Interactive Mode 作为主界面。

Pi 继续提供：

- LLM/provider runtime
- agent session / agent loop 基础能力
- tool calling 基础能力
- terminal rendering primitives（`pi-tui`）

Student Agent 自己拥有：

- Context Runtime
- Planner / Task lifecycle
- Subagent orchestration
- Memory / Reflection / Recovery
- Risk Guard
- TUI information architecture
- TUI state model
- TUI visual identity

目标边界：

```text
Student Agent Core
        │
        │ state / events
        ▼
Student TUI Shell   ← 新建目录，例如 src/tui-shell/
        │
        │ pi-tui components
        ▼
Terminal

Student Agent Core
        │
        ▼
Pi Runtime
```

TUI 不作为 Pi Interactive Mode 的插件层实现。

### 4. 新 TUI 采用固定工作台布局

宽屏模式采用双栏布局：

```text
┌────────────────────────────────────┬──────────────────┐
│ Main Transcript                    │ Plan / Todo      │
│                                    │                  │
│ reasoning                          │ ✓ inspect repo   │
│ tool calls                         │ ● implement      │
│ diffs                              │ ○ verify         │
│ assistant output                   ├──────────────────┤
│                                    │ Subagents        │
│                                    │                  │
│                                    │ ● main           │
│                                    │ ├─ ✓ researcher  │
│                                    │ └─ ● worker      │
├────────────────────────────────────┴──────────────────┤
│ Composer                                              │
├───────────────────────────────────────────────────────┤
│ mode · model · ctx · cost · branch · session          │
└───────────────────────────────────────────────────────┘
```

核心原则：

- 主区回答「Agent 现在正在做什么」；
- Plan 回答「整体做到哪一步」；
- Subagents 回答「有哪些并行工作正在发生」；
- Composer 始终固定在底部；
- Status bar 只显示运行中真正有价值的状态。

### 5. Transcript 从日志流改为 Agent activity timeline

不再把所有事件渲染成等权的 `Assistant:` / `Tool:` / `System:` 日志行，改为有层级的 activity timeline（reasoning 可见、tool 用紧凑 receipt、error/recovery/verification 有独立语义）。

### 6. Plan / Subagent / Memory 的 UI 边界

- Plan sidebar **直接消费**现有 Planner / Task lifecycle，不创建第二套 Todo 真相源。
- Subagent 第一阶段：agent tree、running/done/failed、当前摘要、elapsed；不做完整 subagent terminal multiplexing。
- Memory 默认以 activity event 暴露；详情走 sidebar/overlay；不为 Memory 建 WebUI。

### 7. 使用 pi-tui 作为唯一 TUI rendering foundation

新版 TUI 以 `@earendil-works/pi-tui` 为底层，优先采用：

- full-screen / controlled viewport（如 `TuiAltScreen`）
- `VStack` / `HStack` / `ScrollView`
- editor、focus、overlays
- differential rendering、synchronized output
- virtual terminal testing、semantic theme

**禁止**把旧 `tui-v2` 行级 renderer 拷进新目录当核心。只有在新版 `pi-tui` 明确无法覆盖时，才保留局部自定义 primitive。

### 8. 响应式布局与统一 Theme

- Wide（约 `>= 120` columns）：Transcript | Plan/Agents 右栏常驻。
- Compact：仅 Transcript + Composer + Status；Plan/Agents 快捷键或 overlay。
- 建立 Student semantic theme（text/muted/accent/…）；组件只消费语义 token。

## 不做

- WebUI；Electron / desktop wrapper；
- 用 Ink / React 或 OpenTUI / Solid 重写新 TUI；
- 重写 Pi agent loop；自研新 provider framework；
- 为了 TUI 重写 Planner、Memory 或 Subagent core；
- 第一阶段完整 subagent terminal multiplexing；
- **对 `src/tui-v2` 做任何功能增强或 API 迁移补丁**（仅允许为删代码而改引用）。

## 备选方案（结论）

| 方案 | 结论 |
|---|---|
| A. 继续扩展 tui-v2 renderer | **否决** — 重复维护 terminal infrastructure |
| B. Ink / React 重写 | **否决** — 与 Pi 升级后的 pi-tui 栈重复切换成本 |
| C. Pi Interactive Mode + extension | **否决** — 产品信息架构归属 Pi，Plan/Subagent/Memory 无法一等展示 |
| D. Student-owned shell + pi-tui，并删除旧 TUI | **采纳** |

## 后果

### 正面

- Pi 依赖回到官方维护线；runtime 与 TUI 同代；
- 移除旧 Pi advisory 与双轨 TUI 维护成本；
- TUI 从日志查看器升级为 Agent 工作台；信息架构属 Student Agent。

### 负面

- Node ≥22.19；
- Phase 0→1 之间交互式 CLI 可能短暂不可用（仅 headless/eval）；
- 需一次性迁出 logger 等共享件并重接 extension；
- Plan/Subagent/Memory 需建立 read-only UI projection。

## 实施顺序

### Phase 0：Pi successor migration

1. 锁定 `@earendil-works/pi-*` **0.84.1**；
2. Node.js ≥22.19；README / engines 更新；
3. 迁移 model / provider / session API（`modelRuntime`、`setRuntimeApiKey` 等）；
4. 收口 `pi-ai/compat` + 本地 adapter；
5. 验证 GLM-5 thinking 实际请求；
6. build + Vitest + `eval:validate`；
7. faux-provider smoke；真实 provider 最小 smoke；
8. 确认旧 Pi advisory 消失。

Phase 0 **不**重构 TUI，**不**修补 tui-v2。交互入口若因旧 TUI 与新 Pi 不兼容而失败，以非交互路径验收为准。

### Phase 1：删除旧 TUI + 新 shell foundation

1. 迁出共享非 UI 模块；
2. 删除 `src/tui/`、`src/tui-v2/`、`src/tui-runtime.ts`；卸载 ink/react/opentui/solid；
3. 新建 Student-owned full-screen shell（pi-tui）；
4. semantic theme、UI state projection、responsive layout；
5. 固定 Composer 与 Status bar；接上 extension 入口。

### Phase 2：Main Transcript（activity timeline）

reasoning / tool receipt / diff / error / recovery / verification / follow-bottom。

### Phase 3：Plan + Subagents

Planner projection、Plan sidebar、Subagent tree、compact overlay。

### Phase 4：Memory + polish

memory activity、overlay、shortcuts、scroll/resize、visual polish。

## 验收

### Pi migration

- 不再依赖 `@mariozechner/pi-*`；
- Pi 核心包来自同一 `@earendil-works` 发布版本；
- Node baseline 与新版 Pi 一致；
- TypeScript build、全量 Vitest 通过；
- provider/model、tool call、usage trace 无明显回归；
- GLM-5 thinking 经实际请求验证；
- 旧 Pi security advisory 消失。

### TUI 删除与重建

- 仓库中不存在 `src/tui/`、`src/tui-v2/`、`src/tui-runtime.ts`；
- 无 `ink` / `@opentui/*` 产品依赖；
- 无 `STUDENT_AGENT_TUI` 双轨开关；
- 常见尺寸下：可判断 Agent 当前在做什么；Plan step 与 Subagent 状态一眼可见；reasoning 可见；Composer 不被顶出；transcript 可独立滚动且手动上滚不被强制拉回；compact/resize 不破坏布局；至少覆盖 80×24、100×30、140×40、180×50 的 deterministic layout tests。

## 相关文档

- [`docs/plan-pi-successor-migration.md`](../plan-pi-successor-migration.md)
- [`docs/plan-legacy-cleanup.md`](../plan-legacy-cleanup.md)（本 ADR 取代其 TUI 渐进清理策略）
- [`docs/buglog.md`](../buglog.md)（BUG-008）
- `package.json`
- Pi coding-agent / pi-tui 官方文档

## 图关系

```text
ADR-009 --extends--> plan-pi-successor-migration (Phase 0)
ADR-009 --supersedes-tui-strategy--> plan-legacy-cleanup
ADR-009 --motivates--> new src/tui-shell (name TBD)
ADR-009 --deletes--> src/tui, src/tui-v2, src/tui-runtime.ts
```
