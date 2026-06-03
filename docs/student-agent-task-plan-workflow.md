# Student-Agent Task/Plan Workflow Design

## Problem

Student-Agent 当前已经有轻量 task 能力：`TasksManager` 记录 `active`、`completed`、`cancelled`，phase 通过文本信号推进，eval baseline 已能验证 task 闭环不回退。下一步的问题不是继续加一组 CRUD 工具，而是定义 task/plan 在产品和工程上的边界。

Task 系统应该帮助 agent 和用户共同澄清目标、积累任务上下文、展示可解释进度，并把技术验证和用户验收分开。它不应该让所有问题都进入重型流程，也不应该把目标不清误判为失败。

本设计是未来架构说明，不改变现有 runtime、task manager、tools、discovery tools 或 eval 逻辑。

## Design Principles

- 渐进式披露：简单任务只给模型轻量规则，复杂任务才加载完整 task/plan 工作流。
- Plan 和 todo 分层：plan 是意图、权限和方案层；todo 是执行状态层。
- 澄清不是失败：目标不清、验收标准缺失、用户偏好不明，属于 clarification/discovery。
- 验证先于完成：agent 不能只因代码改完就宣称完成，必须记录技术验证证据。
- 用户验收是独立阶段：尤其是前端、产品、视觉任务，技术通过不等于用户满意。
- Task memory 有边界：任务内信息默认只服务当前 task，长期 memory 写入必须有用户确认。
- Eval 是开发反馈：eval failure 不直接改变用户任务状态，只影响开发侧改造优先级。

## Trigger Policy

默认策略是“能不用完整 task/plan 就不用”。进入 task/plan 的门槛应由任务复杂度、风险、模糊度和验收方式共同决定。

### 不应触发完整 task/plan

- 简单问答，例如概念解释、命令含义、代码片段说明。
- 简单解释或 code review 中的一两个明确问题。
- 单文件小修改，且用户目标、验收方式、风险都明确。
- 明确、低风险、一步完成的操作，例如运行一个测试、查看一个文件、改一个文案。
- 用户只是询问方案，还没有要求执行。
- 用户显式要求“先别改”“只分析”“只回答”。

这些场景可以使用普通对话或轻量 checklist。agent 可以在内部跟踪几步工作，但不应创建完整 task，也不应要求 plan approval。

### 应触发 task/plan

- 多步骤工程改造，涉及多个文件、模块、测试或迁移。
- 需求模糊，需要连续澄清或在执行中保留设计决策。
- 涉及产品、视觉、交互、用户满意度或人工验收。
- 需要长期上下文积累，例如跨回合、跨 session、需要恢复的任务。
- 明确包含多个阶段：探索、计划、执行、验证、复盘。
- 用户显式要求“制定计划”“分阶段做”“开任务”“进入 task 模式”。
- 执行中发现 blast radius 变大，原本的小任务需要升级为完整计划。

触发完整 task/plan 后，agent 必须先形成可审阅的目标、约束、验收标准和计划，再进入执行。

## Progressive Disclosure Levels

| Level | 名称 | 触发条件 | Agent 可见规则 | TUI 展示 | 用户确认 | Memory 策略 |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 普通对话 | 问答、解释、低风险一步操作 | 不加载 task 规则；直接回答或执行 | 不展示 task 面板 | 不需要 | 不写 task memory |
| 1 | 轻量 checklist | 2 到 4 步短任务，目标明确 | 只维护短 todo；完成后给验证摘要 | 可展示紧凑 checklist | 通常不需要 | 默认不持久化 |
| 2 | Task working memory | 需要澄清、执行和上下文保留 | 维护 goal、constraints、decisions、verification 等任务上下文 | 展示任务理解和执行进度 | 关键澄清点需要确认 | task-local，结束后可建议提升 |
| 3 | Full plan mode | 多文件、多阶段、高风险或用户显式要求计划 | 先探索，再输出 plan；获批后执行；plan approval 和 todo progress 分离 | 展示 plan 状态、todo、验证状态 | 进入执行前需要 plan approval | task-local，稳定决策可建议写入长期 memory |
| 4 | Multi-session / subagent / long-running task | 跨 session、后台长任务、子代理、长流程 | 需要恢复点、owner、阻塞关系、取消/重试策略 | 展示 task registry、owner、blockers、run id | 创建、取消、恢复、分派需要确认 | task-local 为主，完成后做 memory review |

升级规则：Level 可以向上升级，但不应自动降级后丢失信息。例如 Level 1 执行中发现需求模糊，应升级到 Level 2 并把已有 checklist 转成 working memory。Level 3 plan 被用户否决时，回到 planning 或 clarifying，而不是进入 failure。

## Task Working Memory

Task working memory 是任务期间的结构化理解层，不等同于 todo。它保存 agent 在澄清、探索、执行、验证、用户反馈中积累的信息。

建议字段：

```text
goal
acceptance_criteria
constraints
user_preferences
project_facts
open_questions
decisions
design_feedback
verification_results
changed_files
```

字段语义：

- `goal`：当前任务要达成的用户结果，不是工具步骤。
- `acceptance_criteria`：用户或任务可验证的完成标准。
- `constraints`：范围、风险、禁止事项、兼容性要求。
- `user_preferences`：本任务中明确表达的偏好，例如视觉风格、实现取舍、交互偏好。
- `project_facts`：通过读取代码、配置、文档确认的项目事实。
- `open_questions`：仍需澄清的问题；存在高影响问题时不能进入执行。
- `decisions`：已经确认的方案选择及原因。
- `design_feedback`：用户对产品、视觉、文案、体验的反馈。
- `verification_results`：测试、build、lint、截图、人工检查等证据。
- `changed_files`：执行阶段实际涉及的文件，供 review 和恢复使用。

默认持久化策略：

- Task-local：`project_facts`、`decisions`、`verification_results`、`changed_files` 默认只服务当前 task。
- 可建议提升：反复出现的用户偏好、稳定项目规则、长期有效的技术约束，可以在任务结束后建议写入长期 memory。
- 必须确认：长期 memory 写入前必须让用户确认，不能由 task runtime 自动写入。
- 不写入长期 memory：临时调试线索、一次性失败细节、未确认偏好、被用户否定的设计方向。

## Plan / Todo / Verification Relationship

Plan、todo、working memory、verification、user acceptance 是五个不同层次：

| 层次 | 作用 | 典型内容 | 完成条件 |
| --- | --- | --- | --- |
| Working memory | 任务理解 | 目标、约束、事实、问题、决策 | 足够支持下一步行动 |
| Plan | 方案和权限 | 阶段、文件范围、风险、验证方式 | 用户批准或低风险自动通过 |
| Todo | 执行状态 | 当前步骤、已完成步骤、阻塞步骤 | 所有步骤完成或任务取消 |
| Verification | 技术证据 | test/build/lint/eval/screenshot/manual check | 验证项通过或记录无法运行原因 |
| User acceptance | 用户验收 | 用户确认、修改意见、满意度 | 用户接受，或明确无需人工验收 |

关键不变量：

- Plan approval 不等于任务完成，只表示允许按计划执行。
- Todo completed 不等于 technical verification passed。
- Technical verification passed 不等于 user accepted。
- User requested revision 不等于 failure，应进入 revision loop。
- Eval failure 不属于用户任务的 runtime 状态，只属于开发侧质量信号。

## Runtime State Machine

状态机需要区分“信息不足”和“执行失败”。信息不足发生在执行前，属于澄清；失败发生在执行或验证后，属于 runtime 问题。

### Intake and Planning

```text
intake
-> clarifying
-> planning
-> awaiting_plan_approval
```

- `intake`：判断是否需要 task/plan，并确定 progressive level。
- `clarifying`：收集 goal、constraints、acceptance criteria、user preferences。
- `planning`：探索项目事实，形成计划和验证策略。
- `awaiting_plan_approval`：等待用户确认、修改或取消。

如果用户要求继续澄清，保持在 `clarifying`。如果用户否定计划，回到 `planning` 或 `clarifying`。这些都不是 failure。

### Execution and Verification

```text
executing
-> technical_verification
-> user_review
-> accepted
-> completed
```

- `executing`：按 plan/todo 执行修改或操作。
- `technical_verification`：运行测试、build、lint、eval 或其他技术检查。
- `user_review`：展示结果、证据和剩余风险，等待用户验收。
- `accepted`：用户确认满意，或任务类型明确不需要人工验收。
- `completed`：task runtime 收尾，记录 final summary。

### Retry and Failure

```text
executing
-> retrying
-> blocked
-> needs_replan
-> failed
```

- `retrying`：工具失败、测试失败或实现偏差后进行有限恢复。
- `blocked`：缺少权限、环境、外部状态或用户输入，无法继续。
- `needs_replan`：原 plan 与事实不符，继续执行风险过高。
- `failed`：恢复失败且无法给出安全下一步。

失败状态必须带诊断：失败来源、已尝试恢复、剩余风险、需要用户提供什么。

### Cancellation

```text
intake | clarifying | planning | awaiting_plan_approval | executing | user_review
-> cancelled
```

用户显式取消、范围被撤回、或任务目标不再需要时进入 `cancelled`。取消不是失败。

## Frontend Review Loop

前端任务必须把“技术通过”和“用户满意”分开处理。build、typecheck、lint、测试通过，只能证明技术层面没有明显错误；视觉、交互、文案、品牌感和可用性仍需要 visual review 与 user review。

前端正常路径：

```text
executing
-> technical_verification
-> visual_review
-> user_review
-> accepted
-> completed
```

`visual_review` 应记录：

- 页面或组件的运行入口。
- 截图、浏览器检查或可视化验证结果。
- 响应式视口检查结果。
- 已知视觉风险，例如溢出、遮挡、加载失败、空白画布。

用户不满意路径：

```text
user_review
-> revision_requested
-> clarify_feedback
-> update_working_memory
-> revise
-> visual_review
-> user_review
```

处理原则：

- 用户说“不喜欢”“不对”“换个感觉”不是 failure。
- agent 应把反馈转成 `design_feedback`、`constraints` 或 `acceptance_criteria`。
- 反馈模糊时进入 `clarify_feedback`，不能盲目重做。
- 修改后必须重新经过 visual review，再回到 user review。

## Failure Model

Student-Agent 保留三层失败机制，各层职责不同，不能混用。

| 层级 | 含义 | 示例 | 用户工作流影响 |
| --- | --- | --- | --- |
| Tool failure | 单次工具调用失败 | 超时、路径越界、edit mismatch、权限不足、输出过大 | 记录并尝试恢复；不一定改变 task 状态 |
| Task/plan runtime failure | 任务执行层失败 | 多次恢复失败、验证持续不过、plan 与事实冲突、需要 replan | 进入 `retrying`、`blocked`、`needs_replan` 或 `failed` |
| Eval failure | 开发侧评估失败 | baseline 退化、behavior diagnostics、correctness score 下降 | 不进入用户任务状态；用于改造优先级和回归测试 |

非失败项：

- 目标不清。
- 验收标准缺失。
- 用户偏好不明。
- 用户要求改计划。
- 用户对前端结果不满意。

这些都属于 clarification、discovery 或 revision，而不是 failure。

## TUI Presentation

TUI 至少展示两类信息：执行进度和任务理解。目标是让用户知道 agent 正在做什么、为什么这么做、当前还缺什么。

执行进度示例：

```text
[x] 探索代码结构
[x] 生成计划
[ ] 实现修改
[ ] 运行验证
[ ] 等待用户确认
```

任务理解示例：

```text
Goal:
Acceptance Criteria:
Constraints:
Open Questions:
User Preferences:
```

前端任务示例：

```text
[x] build passed
[x] screenshot checked
[ ] user accepted
```

展示规则：

- Level 0 不显示 task 面板。
- Level 1 可显示紧凑 checklist，不显示完整 working memory。
- Level 2 显示任务理解面板和 todo。
- Level 3 显示 plan approval 状态、todo、verification。
- Level 4 显示 owner、run id、blockers、resume/cancel 状态。

## Eval Implications

本设计文档阶段不修改 eval task definitions、instructions、correctness checks 或 bash diagnostic scoring。现有 eval 应继续作为 discovery tools 和 task baseline 的接受测试。

未来 task/plan 工具化完成后，可以新增 eval，但应分开验证：

- Trigger policy：简单任务不误触发 full plan，复杂任务能进入 task/plan。
- State machine：最终完成时 task status 为 `completed`。
- Clarification：目标不清时进入澄清而不是失败。
- Frontend review：技术验证、visual review、user review 分层。
- Revision loop：用户不满意后进入 revision_requested，而不是 failed。
- Eval isolation：eval failure 只影响开发反馈，不污染用户 task runtime。

## Open Questions

以下问题留给后续实现阶段，不影响本文档设计结论：

- Task working memory 存储在现有 `tasks.json`、独立文件，还是未来 task registry。
- Level 1 checklist 是否需要持久化，或只存在于当前 session。
- Full plan mode 的用户批准 UI 是 inline prompt、TUI 面板，还是专门命令。
- Visual review 的最低自动化要求是什么：截图即可，还是必须有视口矩阵。
- Level 4 子代理和长期任务是否需要单独的 run registry。

## Implementation Phases

建议后续按阶段实现，不一次性重写 task runtime。

1. 文档和 prompt 对齐：把触发门槛、failure 术语、plan/todo 分层写入 task 相关 guidance。
2. Working memory v1：在 task 内增加 goal、constraints、acceptance criteria、verification results 等字段。
3. State machine v1：扩展状态，区分 clarification、execution、verification、user review、failure。
4. TUI v1：展示任务理解面板和执行 checklist，前端任务显示 visual/user review。
5. Tooling v1：在状态机稳定后再考虑 task_create、task_update、task_status 等结构化工具。
6. Eval v2：新增 task/plan 行为 eval，保留现有 baseline 作为回归保护。

## References

- [obra/superpowers](https://github.com/obra/superpowers)：参考其按 skill metadata 渐进加载工作流、writing-plans、executing-plans 和 checkpoint 思路。
- [superpowers writing-plans](https://github.com/obra/superpowers/blob/main/skills/writing-plans/SKILL.md)：参考 bite-sized plan、明确文件范围和验证步骤的计划结构。
- [superpowers executing-plans](https://github.com/obra/superpowers/blob/main/skills/executing-plans/SKILL.md?plain=1)：参考按步骤执行、更新 todo、验证后完成、阻塞时停止询问的流程。
- [Claude Code permission modes](https://code.claude.com/docs/en/permission-modes)：参考 plan mode 作为分析和权限模式，而不是普通文本计划。
