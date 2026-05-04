# Legacy Phase 1 — 归档代码

此目录存放阶段一（最小闭环）的旧实现，在 Pi Extension 集成稳定后删除。

## 保留原因

- **渐进迁移**：新系统达到能力基线前保留参考
- **回滚备份**：极端情况下可以 `npm run dev:legacy` 切回
- **对比参照**：新 hooks 实现可与此处对比

## 文件说明

| 文件 | 说明 |
|---|---|
| `index.ts` | 旧 REPL 入口（XState + StreamAdapter） |
| `state-machine/machine.ts` | XState 状态机（5 个状态，3 级失败升级） |
| `state-machine/stream-adapter.ts` | 流式事件 → XState 事件适配器 |
| `state-machine/resource-manager.ts` | AbortController 资源管理 |
| `state-machine/stubs.ts` | 阶段一 stub 实现 |
| `executor/executor.ts` | 旧 Executor 类（工具调用 + 快照回滚） |

## 已迁移到新架构的等价实现

| 旧组件 | 新实现位置 |
|---|---|
| XState 状态机循环 | Pi 的 `Agent` 类（`agent-loop.ts`） |
| StreamAdapter | Pi 的 `turn_end` 事件 |
| Executor（快照） | `src/extension/hooks/snapshot.ts` |
| 三级失败升级逻辑 | `src/extension/hooks/failure-escalation.ts` |
| REPL 主循环 | `src/extension/index.ts` |

## 仍在原地的共享代码（不在此处）

以下文件被新 hooks 复用，因此保留在原位（未归档）：

- `src/core/state-machine/error-classifier.ts` → failure-escalation.ts
- `src/core/state-machine/diagnostic-reporter.ts` → failure-escalation.ts
- `src/core/state-machine/types.ts` → failure-escalation.ts
- `src/core/executor/snapshot.ts` → snapshot hook
- `src/core/executor/types.ts` → error-classifier

## 删除条件

当以下条件全部满足时，可删除此目录：

1. `npm run dev`（Pi 集成入口）能完整运行端到端任务
2. 三级失败升级在 Pi hooks 下验证通过
3. ReflectAgent 在 `agent_end` 事件下正确触发
4. 记忆注入（project-rules + preferences + questions）在 system prompt 中验证正确
