import type { AttemptRecord, ErrorCategory } from './types.js';

export interface DiagnosticInput {
  taskDescription: string;
  attempts: AttemptRecord[];
  errorCategory: ErrorCategory;
  errorSubtype: string;
  rawError: string;
}

interface DiagnosisEntry {
  inferReason: string;
  questions: [string, string];
}

const DIAGNOSIS_TABLE: Partial<Record<ErrorCategory, Record<string, DiagnosisEntry>>> = {
  tool: {
    'selector-not-found': {
      inferReason: '页面 DOM 结构与预期不一致，可能是登录态失效或前端版本变更',
      questions: ['该页面是否需要先登录？', '能否提供登录后该元素的可见 selector？'],
    },
    timeout: {
      inferReason: '操作超时，目标资源可能响应缓慢或已下线',
      questions: ['是否有网络代理或访问限制？', '可以提供该工具的备用端点或超时容限？'],
    },
    'resource-not-found': {
      inferReason: '目标文件或路径不存在，任务描述中的路径可能已变更',
      questions: ['目标文件是否已被移动或重命名？', '请确认正确的文件路径。'],
    },
    unknown: {
      inferReason: '工具执行失败，原因尚不明确',
      questions: ['该工具是否有已知的版本兼容问题？', '是否可以提供更详细的操作步骤？'],
    },
  },
  model: {
    'json-parse': {
      inferReason: '模型输出格式异常，JSON 解析失败——可能是上下文过长导致截断',
      questions: ['是否可以将任务拆分为更小的子步骤？', '是否需要切换到推理能力更强的模型？'],
    },
  },
  environment: {
    'auth-expired': {
      inferReason: 'API Key 或凭据已过期，外部服务拒绝请求',
      questions: ['请检查 API Key 是否仍有效', '是否需要切换到备用端点或模型？'],
    },
    'network-unreachable': {
      inferReason: '网络不可达，目标服务可能暂时离线或被防火墙拦截',
      questions: ['当前网络环境是否有代理设置？', '是否可以稍后重试或使用离线替代方案？'],
    },
  },
  user_input: {
    'ambiguous-task': {
      inferReason: '任务描述存在歧义，无法确定正确的执行意图',
      questions: ['请描述期望的最终输出是什么？', '是否有参考示例或约束条件可以补充？'],
    },
  },
  state_conflict: {
    conflict: {
      inferReason: '检测到状态冲突，多个操作对同一资源产生了竞争',
      questions: ['是否有其他并发任务在修改同一文件？', '是否可以暂停其他任务后重试？'],
    },
  },
};

const BORDER = '='.repeat(39);

function lookupEntry(category: ErrorCategory, subtype: string): DiagnosisEntry {
  const byCategory = DIAGNOSIS_TABLE[category];
  if (byCategory) {
    const entry = byCategory[subtype] ?? byCategory['unknown'];
    if (entry) return entry;
  }
  return {
    inferReason: `未知错误（${category}/${subtype}）`,
    questions: ['能否提供更多操作上下文？', '是否可以尝试简化任务再重试？'],
  };
}

function formatAttempts(attempts: AttemptRecord[]): string {
  if (attempts.length === 0) return ' （无尝试记录）';
  return attempts
    .map((a, i) => ` [${i + 1}] ${a.strategy} → ${a.reason ?? a.result}`)
    .join('\n');
}

export function renderDiagnosticReport(input: DiagnosticInput): string {
  const { taskDescription, attempts, errorCategory, errorSubtype } = input;
  const entry = lookupEntry(errorCategory, errorSubtype);

  return [
    BORDER,
    '',
    ' WARN: 需要你的帮助',
    '',
    ` 任务：${taskDescription}`,
    '',
    ' 已尝试：',
    formatAttempts(attempts),
    '',
    ` 疑似原因：${entry.inferReason}`,
    '',
    ' 请问：',
    ` 1. ${entry.questions[0]}`,
    ` 2. ${entry.questions[1]}`,
    BORDER,
  ].join('\n');
}

export function writeDiagnosticReport(
  input: DiagnosticInput,
  out: NodeJS.WritableStream = process.stdout,
): void {
  out.write(renderDiagnosticReport(input) + '\n');
}
