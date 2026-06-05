# Done

## ✅ UIState 四通道隔离
- `state.ts` 已将 AppState 严格分为 messages / currentStatus / inputValue / debugLogs 四通道
- `bridge.ts` 确保各通道互不污染
- 注释明确标注每个字段的归属通道

## ✅ 支持多行粘贴
- `paste-buffer.ts` 已实现：`/paste` 开始 → 逐行收集 → `/end` 提交 → `/cancel` 取消
- 支持 `parseCommand` 调用 `/paste <content>` 一次性提交

## ✅ 任务运行中用户新输入进入队列
- `input-queue.ts` 已实现：`enqueueSubmit` 排队 → `pendingCount()` 查看 → UI 显示 pendingMessageCount
- `bridge.ts` 通过 `SET_PENDING_MESSAGE_COUNT` action 更新 UI

# Pending

## 2. 禁止业务层直接 console.log
- TUI 模式：`console-redirect.ts` 已劫持 console 输出到 debug 日志
- Readline 回退模式：extension/index.ts 中斜杠命令仍使用 console.log（可接受，因无 TUI bridge）
- 待做：审计并清理 hooks/ 中的 console.warn 调用

## 3. tool error 必须持久化到 transcript
- 待调研：工具调用错误是否已持久化到 transcript，或仅闪现到 status

## 📦 新的 eval task：preference-aware-edit
- 创建时间：2026-06-05
- 目的：测试 agent 是否能主动读取 project-rules.md 并遵循其中的代码风格约定
- 指令含中文，测试双引号规则遵循
- 状态：✅ `eval:validate` 通过（initial: 0, solution: 1）
- TODO：
  - [ ] 运行 baseline 确认 agent 实际行为
  - [ ] 考虑添加更多偏好相关的 eval task（如类型标注偏好）
