# 修改要求：write_lesson 供给 v2 修补（fixups）

状态：待执行 · 2026-08-14 · 基线 `feat/lesson-authoring-v2`（含 `8dda2f4b` cherry-pick 与 v0.5 三臂改版）

背景一句话：2026-08-14 live 烟测（12 run，Django 族四臂旧仪器）暴露三件事——`write_lesson` 零调用（工具与指令均在场）、legacy lesson 注入的是模板废话、族被 glm-5.2 当前栈打穿。本单只修供给侧与仪器周边，**不动晋升链，不点火正式批**。

## R1 · 弧线触发提醒（核心）

- 现状：逐字指令常驻系统提示词，模型 12 run 零调用。
- 要求：session 内**确定性**检测「tool_error → 其后同文件/同工具操作转绿」弧线（复用 `write-lesson-tool.ts` 已有的 sessionEvents 缓冲），命中时在**该次转绿的工具结果尾部**附一行提醒：
  > 你刚完成一次先错后改对，立即调用 write_lesson 记录（引用相关 toolCallId）。
- 约束：纯规则触发，不引入 LLM 判断；每条弧线最多提醒一次；提醒文本进代码常量（后续可冻结）。
- 验收：单测覆盖「错误→转绿→提醒出现」「无错误→无提醒」「同弧线不重复提醒」。

## R2 · 收尾收割

- 要求：run 收尾前（eval runner 侧），若本 run 出现过 tool_error 且 `write_lesson` 调用数为 0，追加**一轮**收割提示：
  > 回顾本次任务中先做错、后改对的地方（含走弯路），逐条调用 write_lesson 记录后再结束。
- 约束：只追加一轮，模型仍不写就放行，不重试、不作废 run；收割轮的 token 计入 run 总量并在 summary 记 `harvestTurn: true`。
- 验收：单测（有错误且零调用 → 触发；零错误或已调用 → 不触发）。

## R3 · 渲染兜底（止损 legacy 废话）

- 现状：legacy lesson 无 `cause`/`fixPattern`，注入体只剩 `Do not apply when: The triggering context is absent` 一类模板句（live 烟测 A-L task2 实录）。
- 要求：`renderLessonInjection` 对「无 cause 且无 fixPattern」的 lesson 返回空；召回侧（`jsonl-memory-store.ts`）对渲染为空的条目**整条跳过**，不占 top-k 坑位、不注入占位句。删除 `pattern omitted` 兜底文案。
- 验收：注入 fixture 快照中不再出现模板边界句与占位句；store 单测证明 legacy-only 池注入为空。

## R4 · 审计员时序校验

- 现状：`auditCitedEvidence` 只查存在性与谓词，引用发生在错误**之前**的转绿事件也能过审。
- 要求：按事件流顺序断言 error < fix(全部) < verification；违序 → `unanchored`，reason 注明 `out-of-order`。
- 验收：单测覆盖乱序三元组被隔离。

## R5 · write_lesson 不静吞异常

- 现状：`execute` catch 全吞，只回 `Recorded lesson failed.`。
- 要求：`details` 带 `errorKind`（如 `io` / `audit` / `unknown`）与一行 message；工具返回文本保持极简不变。
- 验收：单测。

## R6 · 模型换 glm-5.3（文书一格）

- 要求：v0.5 预注册采样表 `model` 改 `glm-5.3`、`profile` 改对应 profile（先确认 provider 配置里存在）；批准栏加一行勘误（作者已口头批准换模型）。runner 刮表机制不动。
- 验收：`--dry-run` 显示 `sampling.model = glm-5.3`。

## R7 · 族重筛（B 臂裸跑扫题，已批准直接跑）

- 现状：`F-DJ-MIGRATION-REFERENCE` 被 glm-5.2 当前栈 12/12 打穿，无分辨力；换 5.3 只会更穿。
- 要求：提供扫题脚本/模式——逐题跑 **B 臂裸配置**（无注入、无学习写入），只记 resolved 与 token；输出「当前栈会挂的题」清单。
- 扫题池：不限于旧候选筛查表——SWE-bench Lite 全量 Django 与 SymPy 题均可入池（沿用既有污染核查口径）。
- 预算：**作者已放宽，不设硬闸**；按 repo 分批跑（先 Django 后 SymPy），每批结束落中间产物，异常（限流/harness 异常）停批报告即可，不必停整个扫题。
- 重组族标准（扫完交作者定夺）：族内 ≥3 题、当前栈至少挂其中 2 题、成因同子系统/同缺陷类（沿用候选筛查表口径）。
- 验收：扫题结果清单（instance / resolved / tokens）+ 按上述标准给出 ≥2 个候选族草案。

## 禁区

1. 不动 `promoteRunLessonsAfterHarness` / `promoteHarnessEligibleLessons` / BUG-015 盖章语义。
2. 不跑正式三臂批（正式批仍需作者点火）；R7 扫题已批准，可直接跑。
3. R1/R2 提醒文本不得提及 harness 内部产物（AEvo 隔离不破）。
4. key 不入库。

## 完成定义

- R1–R6 全部验收通过，R7 交付扫题结果清单与候选族草案；
- `npx vitest run` 与 `tsc --noEmit` 全绿；
- 简报：改动清单、测试结果、R6 dry-run 输出、R7 题单与候选族。
