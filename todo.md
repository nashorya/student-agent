# Done

## ✅ 注入效果实验预注册草案 v0（2026-07-19）
- `docs/proposals/injection-effect-experiment-prereg-v0.md`：H1/H2、三臂、题库规则、写死判读、预算熔断
- 状态：草案；作者批准后冻结设计；题库附录待选
- 关单后队列：**作者批准冻结** → 题库筛查表 → 附录 push

## ✅ ADR-008 Measured Harness Evolution（2026-07-19，纯文书）
- 落档 `docs/adr/ADR-008-measured-harness-evolution.md`：定位声明，无代码改动
- 图关系：clarifies→ADR-001；motivates→injection-effect-experiment；defers→chronicle:P3/P4
- INDEX 时间轴已登记；`npm run chronicle:build` 验收上图
- 不改 README、不动 ADR-001 原文

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

## 2. ✅ 禁止业务层直接 console.log
- TUI 模式：`console-redirect.ts` 已劫持 console 输出到 debug 日志
- Readline 回退模式：extension/index.ts 中斜杠命令仍使用 console.log（可接受，因无 TUI bridge）
- ✅ hooks/、executor/、memory/docs-index/、reflect/ 中的 console.warn 已全部替换为 logger.warn

## 3. ✅ tool error 已经持久化到 transcript
- 单个工具调用的错误（isError=true）通过 Pi tool_result 消息机制始终在 transcript 中，LLM 可见
- agent.state.errorMessage（高级别 agent 错误）通过 bridge.addMessage('system', ...) 写入了 transcript
- 无需额外修改

## 📦 新的 eval task：preference-aware-edit
- 创建时间：2026-06-05
- 目的：测试 agent 是否能主动读取 project-rules.md 并遵循其中的代码风格约定
- 指令含中文，测试双引号规则遵循
- 状态：✅ `eval:validate` 通过（initial: 0, solution: 1）
- 状态：✅ `eval:baseline` 通过（correctness: 1, behavior: 1, 4 tool calls, 0 failed）

## 📦 新的 eval task：preference-type-annotations
- 创建时间：2026-06-06
- 目的：测试 agent 是否能主动读取 project-rules.md 并遵循显式类型标注的约定
- 指令含中文，测试类型标注规则遵循
- 状态：✅ `eval:validate` 通过（initial: 0, solution: 1）
- 状态：暂未运行 baseline

## 📦 新的 eval task：shopping-cart
- 创建时间：2026-06-06
- 目的：测试 agent 实现购物车功能的多阶段开发能力，含 addItem/removeItem/getTotal（含 8% 增值税）三个函数
- 指令含中文，包含 4 个 Phase，需输出 PHASE_DONE 信号
- 初始环境：types.ts（类型定义）、products.ts（商品数据）、cart.ts（空函数占位）、main.ts（调用流程）
- 状态：✅ `eval:validate` 通过（initial: 0, solution: 1）
- 状态：暂未运行 baseline
