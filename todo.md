# TUI 渲染问题修复 — 已完成

## 原始问题
1. ✅ status、phase、updatedAt、content 等内部状态被渲染进了聊天正文
2. ✅ 输入框和状态栏会覆盖正文
3. ✅ 流式输出时消息闪烁、消失、重复
4. ✅ tool error/status 没有稳定持久化到 transcript
5. ✅ console/stdout/stderr 可能直接污染 TUI

## 修复方案

### 1. UI 状态拆分（4 类）

- **transcriptMessages**（`messages` + `completedMessageIds` + `activeAssistantMessageId`）
  - 只存 user/assistant/tool/error 的持久消息
  - system 瞬态消息通过 `bridge.setStatus()` → `currentStatus` 显示在底部状态栏

- **currentStatus**（新增 `currentStatus: string` 字段）
  - 只显示在底部状态栏，必须单行截断，不能进入正文
  - 用于瞬态消息："已请求中止"、"OK: 模型切换"、"当前没有运行中的任务"等
  - 新增 `SET_STATUS` / `CLEAR_STATUS` action

- **inputValue**（已有 `inputValue` + `cursorPos` + `inputHistory` + `historyIndex`）
  - 只显示在输入框，不能进入正文

- **debugLogs**（新文件 `src/tui/debug-events.ts`）
  - 写入 `.student-agent/debug-ui-events.jsonl`，不直接输出到 terminal

### 2. 新增文件

- `src/tui/logger.ts` — 统一日志模块，替代业务层 console.log
  - TUI 模式写文件，非 TUI 模式写 stderr
  - error 级别始终写 stderr
  - 新增 `setTuiMode()` / `isTuiMode()` / `safeStdout()`

- `src/tui/debug-events.ts` — 调试事件记录器
  - 记录 appendMessage/setStatus/clearStatus/toolResult 事件
  - 每行一个 JSON 对象
  - 通过 `STUDENT_AGENT_DEBUG_UI=1` 环境变量启用

### 3. 架构变更

| 组件 | 变更 |
|------|------|
| `state.ts` | 新增 `currentStatus` 字段 + `SET_STATUS` / `CLEAR_STATUS` action |
| `bridge.ts` | 新增 `setStatus()` / `clearStatus()` 方法 + debug 事件记录 |
| `app.tsx` | 集成 `<StatusBar />` 到布局（OutputArea → StatusBar → InputLine） |
| `StatusBar.tsx` | 重写：显示 currentStatus（优先）或 taskStatus，单行截断 |
| `InputLine.tsx` | 移除内联 TaskStatusPanel，只保留纯输入功能 |
| `event-renderer.ts` | tool_execution_start 时 `setStatus(正在调用...)`, tool_execution_end 时 `clearStatus()`；tool error 通过 `addMessage('error', ...)` append 到 transcript；非 TUI 模式用 `process.stderr.write` 替代 `console.log` |
| `extension/index.ts` | 瞬态消息改用 `bridge.setStatus()`，持久内容保持 `bridge.addMessage('system', ...)` |

### 4. 瞬态消息 vs 持久内容分类

**→ setStatus（瞬态，状态栏）**
- "当前任务仍在运行，消息已排队"
- "当前没有运行中的任务"
- "已请求中止当前任务"
- "当前任务仍在运行，不能切换模型/修改设置"
- "已取消" / "已取消设置"
- "OK: 模型已切换为 ..." / "OK: 已应用设置：..."
- "当前无活跃任务"
- "已重命名为：..."
- "已丢弃当前任务：..."
- "候选查看功能待实现"
- "git 仓库已初始化，快照回滚已启用"
- "[DesignStudy] 正在处理设计命令…"
- "[DesignStudy] 风格描述最多等待 Xs"
- "[DesignStudy] 检测到后续任务，已启用风格"
- "[规划中] 正在分析任务并制定执行计划…"
- "正在调用 {toolName}"（event-renderer）

**→ addMessage（持久，聊天正文）**
- 帮助文本（getHelpText）
- 计划确认文本（formatPlanAwaitingConfirmation）
- 任务状态详情（formatTaskStatus）
- 阶段完成/任务完成消息
- 设计命令输出（handleDesignCommand）
- Review/feedback 结果
- 错误消息（Agent Error、Task error、规划失败等）
- 等待验收消息
- Why/plan 命令输出
