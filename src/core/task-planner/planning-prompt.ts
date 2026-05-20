/**
 * 规划阶段 prompt 构造器。
 *
 * 规划阶段限制：
 *   - FileGuard 设为 planning 模式（最多读 3 个文件）
 *   - 只允许读取结构性文件（CLAUDE.md、package.json、顶层目录）
 *   - 必须输出 TASK_START 信号，不要实现任何代码
 */

export function buildPlanningPrompt(userRequest: string): string {
  return `[规划模式 — 只制定计划，不实现代码]

用户请求：
${userRequest}

---

你现在处于规划阶段。要求严格遵守以下规则：

1. **只允许读取最多 3 个文件**，仅限结构性文件（如 CLAUDE.md、package.json）。
   不要读取任何 src/ 下的源代码文件。
2. **不要编写任何代码，不要修改任何文件。**
3. 将任务拆分为 2 至 5 个聚焦的 Phase。每个 Phase 描述应足够具体，
   使执行时只需读取 3-5 个相关文件即可完成。
4. **必须**以下列格式输出计划，不要输出其他任何内容：

[TASK_START name="简短任务名称"]
Phase 1: 具体描述，说明要做什么、涉及哪些文件
Phase 2: 具体描述
Phase 3: 具体描述（如有必要）
[/TASK_START]

现在请查看 CLAUDE.md 了解项目结构，然后输出计划。`;
}

export function buildPhaseExecutionPrompt(phaseName: string, phaseDesc: string, phaseIndex: number, totalPhases: number): string {
  return `[执行模式 — Phase ${phaseIndex + 1}/${totalPhases}]

当前任务：${phaseName}
本 Phase 目标：${phaseDesc}

请专注执行上述 Phase 目标：
- 只读取与本 Phase 直接相关的文件（不超过 5 个）
- 修改文件前必须先读取目标文件的当前内容，不能凭旧上下文猜测
- 避免对大块 JSX/TSX 使用精确 oldText 替换；多处或结构性改动优先使用 apply_patch/patch 风格修改
- 如果使用 edit 精确替换，只替换小范围、稳定、刚读到的文本锚点
- 完成后输出 [PHASE_DONE phase=${phaseIndex + 1}] 信号（Phase 编号从 1 开始）
- 不要提前做其他 Phase 的工作`;
}
