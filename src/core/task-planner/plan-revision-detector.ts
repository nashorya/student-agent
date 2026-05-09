import type { Task } from '../../memory/tasks/types.js';
import type { PlanRevisionDiffType } from '../../memory/plan-revisions/types.js';

export interface PlanSnapshot {
  taskId: string;
  taskName: string;
  phases: string[];
  summary: string;
}

export interface DetectedPlanRevision {
  agentPlanSummary: string;
  userRevisionSummary: string;
  diffType: PlanRevisionDiffType;
  reasonInferred: string;
}

export function createPlanSnapshot(task: Task): PlanSnapshot {
  const phases = task.phases.map((phase) => phase.description);
  return {
    taskId: task.id,
    taskName: task.name,
    phases,
    summary: summarizePlan(task.name, phases),
  };
}

export function detectPlanRevisionIntent(
  input: string,
  activeTask: Task | null,
  snapshot: PlanSnapshot | null,
): DetectedPlanRevision | null {
  const text = input.trim();
  if (!text || !activeTask || !snapshot || activeTask.id !== snapshot.taskId) {
    return null;
  }

  const diffType = classifyDiffType(text);
  if (!diffType) return null;

  return {
    agentPlanSummary: snapshot.summary,
    userRevisionSummary: summarizeRevision(text),
    diffType,
    reasonInferred: inferReason(diffType),
  };
}

export function summarizePlan(taskName: string, phases: string[]): string {
  const phaseText = phases
    .slice(0, 5)
    .map((phase, index) => `Phase ${index + 1}: ${compact(phase, 80)}`)
    .join(' | ');
  return compact(`${taskName}: ${phaseText}`, 500);
}

function classifyDiffType(text: string): PlanRevisionDiffType | null {
  const normalized = text.toLowerCase();

  if (/(验收|标准|通过条件|完成标准|acceptance|criteria)/i.test(text)) {
    return 'acceptance_criteria_change';
  }
  if (/(稳妥|保守|低风险|别重构|不要重构|别重做|不要重做|risk)/i.test(text)) {
    return 'risk_tolerance_change';
  }
  if (/(先.+再|顺序|调换|提前|放后面|before|after)/i.test(text)) {
    return 'sequencing_change';
  }
  if (/(优先|最重要|先做|先修|先处理|priority)/i.test(text)) {
    return 'priority_change';
  }
  if (/(只做|先别|暂时不|不要|别做|去掉|移除|缩小|收窄|scope down)/i.test(text)) {
    return 'scope_reduction';
  }
  if (/(加上|增加|扩展|顺便|也做|再做|scope up)/i.test(text)) {
    return 'scope_expansion';
  }
  if (/(改成|换成|用.+实现|不要用|方案|策略|架构|implementation)/i.test(text)) {
    return 'implementation_strategy_change';
  }

  if (/^(报错|失败|不行|错了|有问题|还是不对)$/i.test(normalized)) {
    return null;
  }
  return null;
}

function summarizeRevision(input: string): string {
  return compact(input.replace(/\s+/g, ' '), 300);
}

function inferReason(diffType: PlanRevisionDiffType): string {
  switch (diffType) {
    case 'priority_change':
      return '用户调整了计划优先级，应在后续规划中更早处理其强调的事项。';
    case 'scope_reduction':
      return '用户倾向于缩小本轮范围，避免一次性做过多改动。';
    case 'scope_expansion':
      return '用户希望本轮计划覆盖额外工作，但仍需避免过度泛化。';
    case 'risk_tolerance_change':
      return '用户表达了风险偏好，应优先选择更稳妥的执行路径。';
    case 'sequencing_change':
      return '用户调整了执行顺序，应记录其对工作节奏的偏好。';
    case 'acceptance_criteria_change':
      return '用户修改了验收标准，应在后续执行和总结中显式对齐。';
    case 'implementation_strategy_change':
      return '用户修改了实现策略，应把它作为决策证据而不是硬规则。';
  }
}

function compact(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
}
