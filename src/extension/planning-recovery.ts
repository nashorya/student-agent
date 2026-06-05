export type PlanningFailureReason = 'error' | 'missing-task-start' | 'empty-phases';

export type PlanningFailureKind =
  | 'unknown'
  | 'fileguard_glob_too_broad'
  | 'fileguard_reference_read'
  | 'fileguard_planning_read_limit'
  | 'missing_task_start'
  | 'empty_phases'
  | 'aborted_or_interrupted'
  | 'model_timeout';

export type PlanningRecoveryAction = 'retry' | 'revise' | 'cancel';

export interface PlanningFailureInfo {
  kind: PlanningFailureKind;
  userSummary: string;
  retryHint: string;
  internalDetail: string;
}

export function classifyPlanningFailure(_input: {
  reason: PlanningFailureReason;
  detail?: unknown;
  planText?: string;
}): PlanningFailureInfo {
  const detail = stringifyDetail(_input.detail);
  const planText = _input.planText?.trim() ?? '';
  const haystack = `${detail}\n${planText}`;

  if (_input.reason === 'missing-task-start') {
    return {
      kind: 'missing_task_start',
      userSummary: '规划格式不完整',
      retryHint: '重新规划时不要解释，只输出 TASK_CONTEXT 和 TASK_START，并包含 2 至 5 个 Phase。',
      internalDetail: planText || detail || 'missing TASK_START',
    };
  }

  if (_input.reason === 'empty-phases') {
    return {
      kind: 'empty_phases',
      userSummary: '规划阶段为空',
      retryHint: '重新规划时至少拆出“执行”和“验证”两个不同 Phase。',
      internalDetail: planText || detail || 'empty phase list',
    };
  }

  if (/glob 模式过于宽泛|too broad|thousands of files/iu.test(haystack)) {
    return {
      kind: 'fileguard_glob_too_broad',
      userSummary: '读取范围太宽',
      retryHint: '改用更具体的目录或文件范围；优先使用已知上下文，不要扫描整个仓库。',
      internalDetail: detail,
    };
  }

  if (/pi-mono\/|只读参考包|readonly reference|不要直接读取其文件/iu.test(haystack)) {
    return {
      kind: 'fileguard_reference_read',
      userSummary: '参考包不可直接读取',
      retryHint: '不要读取参考包源码；只根据已暴露 API、README 或已有上下文规划。',
      internalDetail: detail,
    };
  }

  if (/规划阶段.*已读取.*上限|最多读|read.*limit|tool calls.*limit/iu.test(haystack)) {
    return {
      kind: 'fileguard_planning_read_limit',
      userSummary: '规划读取次数超限',
      retryHint: '不要继续读取文件；直接基于已有上下文输出 TASK_START 计划。',
      internalDetail: detail,
    };
  }

  if (/request was aborted|abort|aborted|interrupted|中止/iu.test(haystack)) {
    return {
      kind: 'aborted_or_interrupted',
      userSummary: '请求被中止',
      retryHint: '确认仍要继续后，重新发起规划。',
      internalDetail: detail,
    };
  }

  if (/timeout|timed? out|超时/iu.test(haystack)) {
    return {
      kind: 'model_timeout',
      userSummary: '模型响应超时',
      retryHint: '缩小任务范围，先规划最小可执行步骤。',
      internalDetail: detail,
    };
  }

  return {
    kind: 'unknown',
    userSummary: '规划遇到问题',
    retryHint: '换一种更保守的方式重新规划；少读文件，只输出 TASK_START。',
    internalDetail: detail || planText || 'unknown planning failure',
  };
}

export function buildPlanningRecoveryMenu(_failure: PlanningFailureInfo): string {
  return [
    `规划没成：${_failure.userSummary}。`,
    '下一步：',
    '  [1] 我换一种方式重试',
    '  [2] 我补充/改写任务描述',
    '  [q] 取消',
  ].join('\n');
}

export function buildPlanningRecoveryPromptQuestion(_failure: PlanningFailureInfo): string {
  return [
    buildPlanningRecoveryMenu(_failure),
    '选择 [1]: ',
  ].join('\n');
}

export function parsePlanningRecoveryAnswer(_answer: string): PlanningRecoveryAction {
  const trimmed = _answer.trim().toLowerCase();
  if (trimmed === 'q' || trimmed === 'quit' || trimmed === 'cancel' || trimmed === '取消') return 'cancel';
  if (trimmed === '2' || trimmed === 'revise' || trimmed === 'rewrite' || trimmed === '补充' || trimmed === '改写') {
    return 'revise';
  }
  return 'retry';
}

export function buildPlanningRetryRequest(_userRequest: string, _failure: PlanningFailureInfo): string {
  return [
    _userRequest.trim(),
    '',
    '上一轮规划失败，需要换一种方式重新规划。',
    `上一轮规划失败原因：${_failure.userSummary}`,
    `重试提示：${_failure.retryHint}`,
  ].join('\n');
}

export function mergePlanningRevision(_userRequest: string, _revision: string): string {
  const revision = _revision.trim();
  if (!revision) return _userRequest;
  return [
    _userRequest.trim(),
    '',
    '补充说明：',
    revision,
  ].join('\n');
}

export function buildPlanningRevisionQuestion(failure: PlanningFailureInfo): string {
  return `请补充你希望我优先处理的范围（当前问题：${failure.userSummary}）：`;
}

function stringifyDetail(detail: unknown): string {
  if (detail instanceof Error) return detail.message;
  if (typeof detail === 'string') return detail.trim();
  if (detail === null || detail === undefined) return '';
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}
