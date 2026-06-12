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
   如果已有项目结构/规则上下文，优先直接使用已有上下文，不要为了确认而读文件。
   如果 CLAUDE.md 或 AGENTS.md 不存在，不要反复探测；可只读取 package.json 或直接规划。
   不要读取任何 src/ 下的源代码文件。
2. **不要编写任何代码，不要修改任何文件。**
3. 将任务拆分为 2 至 5 个聚焦的 Phase。即使任务很小，也必须至少拆成“执行”和“验证”两个 Phase。
   每个 Phase 描述应足够具体，
   使执行时只需读取 3-5 个相关文件即可完成。
4. Phase 内容必须是自然语言目标，不能包含 TASK_START、PHASE_DONE 或任何控制标记。
   每个 Phase 必须彼此不同，不能用同一句话重复凑数。
5. 可以在 TASK_START 前输出一个 TASK_CONTEXT 块，记录任务理解；如果信息未知，留空即可。
6. **必须**以下列格式输出计划，不要输出其他任何内容：

[TASK_CONTEXT]
goal: 用户想达成的结果
acceptance_criteria: 验收标准 1 | 验收标准 2
constraints: 约束 1 | 约束 2
open_questions:
requires_user_acceptance: false
requires_visual_review: false
[/TASK_CONTEXT]
[TASK_START name="简短任务名称"]
Phase 1: 具体描述，说明要做什么、涉及哪些文件
Phase 2: 具体描述
Phase 3: 具体描述（如有必要）
[/TASK_START]

现在请基于已有上下文输出计划；只有在缺少必要结构信息时，才读取最多 1 个结构性文件。`;
}

export function buildPlanningRepairPrompt(userRequest: string): string {
  return `[规划修正模式 — 上一轮规划无效，请重新输出计划]

用户请求：
${userRequest}

上一轮输出没有形成 2 至 5 个有效 Phase。请严格修正：

1. 不要读取文件，不要调用工具，不要修改文件。
2. 必须拆成 2 至 5 个互不重复的 Phase；小任务也要至少包含“执行”和“验证”两个 Phase。
3. Phase 内容只能是自然语言目标，不能包含 TASK_START、PHASE_DONE 或任何控制标记。
4. 可输出最小 TASK_CONTEXT 块；TASK_START 是必需的。
5. 只输出下面格式，不要输出解释：

[TASK_CONTEXT]
goal: 用户想达成的结果
acceptance_criteria:
constraints:
open_questions:
requires_user_acceptance: false
requires_visual_review: false
[/TASK_CONTEXT]
[TASK_START name="简短任务名称"]
Phase 1: 具体描述
Phase 2: 具体描述
[/TASK_START]`;
}

const ANALYSIS_PHASE_RE =
  /(分析|理解|解释|说明|总结|审计|评估|调研|梳理|设计|方案|提案|建议|architectural|architecture|understanding|analy[sz]e|explain|design|proposal|audit|assess|review|recommend)/iu;
const EXPLICIT_IMPLEMENTATION_RE =
  /(实现|修复|修改|新增|添加|更新|编辑|写入|改代码|改文件|落地|执行修改|implement|fix|modify|change|add|update|create|edit|write|apply_patch)/iu;

export function isReadOnlyAnalysisPhase(phaseDesc: string): boolean {
  return ANALYSIS_PHASE_RE.test(phaseDesc) && !EXPLICIT_IMPLEMENTATION_RE.test(phaseDesc);
}

export function buildPhaseExecutionPrompt(phaseName: string, phaseDesc: string, phaseIndex: number, totalPhases: number): string {
  const readOnlyPhase = isReadOnlyAnalysisPhase(phaseDesc);
  const actionGuidance = readOnlyPhase
    ? `- 本 Phase 判定为分析/方案类：保持只读，不要修改任何文件。
- 可以读取相关文件、运行只读检查，或在上下文充分时直接产出结论、设计方案或审计结果。
- 不要调用 edit/write/apply_patch；除非本 Phase 明确要求实现、修改或修复代码。`
    : `- 必须实际调用工具完成本 Phase 的读取、修改或验证动作；不要只用文字描述“将要读取/将要修改/将要运行”`;
  const mutationGuidance = readOnlyPhase
    ? ''
    : `- 修改文件前必须先读取目标文件的当前内容，不能凭旧上下文猜测
- 避免对大块 JSX/TSX 使用 edit 精确 oldText 替换；多处或结构性改动优先使用 apply_patch
- edit 只用于小范围、稳定、刚读到的单点文本替换`;

  return `[执行模式 — Phase ${phaseIndex + 1}/${totalPhases}]

当前任务：${phaseName}
本 Phase 目标：${phaseDesc}

请专注执行上述 Phase 目标：
${actionGuidance}
- 路径默认是相对项目根目录；如果 Phase 目标包含 "src/foo.ts" 这类路径，直接用 Phase 目标中的相对路径调用工具，不要向用户询问路径格式
- 只读取与本 Phase 直接相关的文件（不超过 5 个）
${mutationGuidance ? `${mutationGuidance}\n` : ''}- 如果任何工具调用失败，最终说明必须区分“已验证事实”和“失败/未验证检查”，不要仅凭失败工具输出给出确定审计结论
- 没有实际完成本 Phase 目标前，不要输出 PHASE_DONE
- 完成后输出完整信号（Phase 编号从 1 开始）：
  [PHASE_DONE phase=${phaseIndex + 1}]
  已完成：简短说明本 Phase 实际完成了什么
  [/PHASE_DONE]
- 不要提前做其他 Phase 的工作`;
}
