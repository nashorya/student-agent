# TUI 界面设计规范

**日期**：2026-05-06  
**项目**：student_agent  
**参考**：Claude Code / opencode 风格

---

## 目标

为 student_agent CLI 系统添加基于 Ink 的 TUI 界面，实现：

1. **信息可视化**：任务阶段、记忆状态、watchdog 信号实时显示在固定区域，不被输出流冲掉
2. **交互体验**：历史记录、自动补全、快捷键支持

风格参考 Claude Code / opencode：流式输出占主体，底部一行状态，输入在最下方，干净不花哨。

---

## 架构

**整体思路**：在现有 REPL 入口（`src/extension/index.ts`）外包一层 Ink 渲染层。Ink 接管终端渲染，内部维护一个 `AppState`，REPL 逻辑通过事件/回调更新这个状态，Ink 负责把状态渲染成界面。

**新增文件结构**：

```
src/tui/
├── app.tsx              # 根组件，布局：主输出区 + 状态栏
├── components/
│   ├── OutputArea.tsx   # 滚动输出区，显示对话历史
│   ├── StatusBar.tsx    # 底部状态栏
│   └── InputLine.tsx    # 输入行（替换 readline）
├── state.ts             # AppState 类型定义 + useAppState hook
└── index.ts             # Ink 入口，render(<App />)
```

现有的 `EventRenderer` 不删除，改为向 `AppState` 推送事件，由 Ink 组件消费。`src/extension/index.ts` 的 readline 循环替换为 Ink 的 `useInput` hook。

---

## 布局

**主输出区**：占据终端高度减去底部状态栏（1行）和输入行（1行）的剩余空间。内容超出时自动滚动到底部。

每条消息保留来源标记：

```
> 帮我修复登录 bug
Assistant: 正在分析代码...
Tool: read_file src/auth.ts
✓ DONE: 3.2s | 5 个工具调用
```

流式输出直接 append 到最后一条 Assistant 消息，不重新渲染整个列表（避免闪烁）。

**输入行**：固定在状态栏上方一行，用 Ink 的 `useInput` 替换 readline，保留：
- 历史记录（上下箭头）
- Escape 中止当前任务
- `/` 开头触发斜杠命令提示

**终端 resize**：Ink 原生处理 `SIGWINCH`，输出区高度自动重算，无需手动处理。

---

## 状态栏

底部状态栏固定一行，从左到右显示：

```
[任务名] Phase 2/3 · 重试:1 · 工具:12 · 00:42 · ● 运行中
```

字段说明：

| 字段 | 来源 | 备注 |
|------|------|------|
| 任务名 | `TasksManager` active task name | 超长截断 |
| Phase X/Y | active_phase_index / phases.length | — |
| 重试:N | 当前阶段 retry_count | >0 时高亮黄色 |
| 工具:N | 本次会话累计工具调用数 | — |
| elapsed | 当前任务耗时 | 秒级更新 |
| 状态指示 | agent 状态 | `● 运行中`（绿）/ `◌ 等待输入`（dim）/ `✗ 失败`（红）|

无 active task 时状态栏显示：`student-agent · 就绪`

---

## 错误处理与降级

如果终端不支持 Ink（非 TTY 环境、CI 管道），自动降级回现有的纯文本 REPL，不崩溃。

检测方式：`process.stdout.isTTY === false` 时跳过 Ink，直接走原有 readline 路径。

---

## 技术选型

| 库 | 用途 | 状态 |
|----|------|------|
| `ink` | TUI 框架 | 新增 |
| `react` | Ink 依赖 | 新增 |
| `chalk` | 颜色（状态栏内） | 已有 |
| `ora` | spinner（保留用于非 TTY 降级） | 已有 |

---

## 不在本次范围内

- 侧边栏 / 多面板布局
- 鼠标支持
- 记忆状态面板（preferences、candidates 可视化）
- watchdog 信号面板

这些可在后续迭代中作为独立面板叠加，不影响本次架构。
