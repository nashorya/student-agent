/**
 * i18n 消息表 — 将用户面向诊断/恢复消息集中管理。
 *
 * 当前仅提供中文 (zh-CN) 翻译。如需添加新语言，扩展此 map 结构。
 */

export type Locale = 'zh-CN' | 'en-US';

let currentLocale: Locale = 'zh-CN';

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

// ── 消息表 ────────────────────────────────────────────

const messages: Record<string, Record<Locale, string>> = {
  // failure-escalation.ts
  'probe.miss': {
    'zh-CN': '只读探测未命中，不作为工具故障处理。',
    'en-US': 'Read-only probe missed, not treated as tool failure.',
  },
  'probe.guidance': {
    'zh-CN': '请根据这个结果继续缩小路径、关键词或检查候选文件是否存在；不要触发回滚或重新规划。',
    'en-US': 'Narrow down path or keywords, or check candidate files; do not trigger rollback or re-planning.',
  },
  'recovery.unavailable': {
    'zh-CN': '恢复动作：没有可用快照，未执行自动回滚。',
    'en-US': 'Recovery: no snapshot available, no rollback performed.',
  },
  'recovery.success': {
    'zh-CN': '恢复动作：已自动回滚到工具调用前的状态（snapshot: {{snapshotId}}）。',
    'en-US': 'Recovery: auto-rolled back to pre-tool-call state (snapshot: {{snapshotId}}).',
  },
  'recovery.failed': {
    'zh-CN': '恢复动作：自动回滚失败（snapshot: {{snapshotId}}）：{{reason}}',
    'en-US': 'Recovery: auto-rollback failed (snapshot: {{snapshotId}}): {{reason}}',
  },
  'recovery.advice.generic': {
    'zh-CN': '建议：尝试用不同的参数或方法重新执行。\n如果是文件操作，请检查路径是否存在。',
    'en-US': 'Suggestion: try different parameters or approach.\nFor file operations, check if the path exists.',
  },
  'recovery.advice.edit': {
    'zh-CN': '建议：不要重复使用同一段 oldText。\n必须先重新读取目标文件当前内容；单点小改用更小范围的 edit，结构性改动改用 apply_patch。',
    'en-US': 'Suggestion: do not reuse the same oldText.\nRe-read the target file; use smaller edit anchors or apply_patch for structural changes.',
  },
  'recovery.advice.write': {
    'zh-CN': '建议：目标路径的父目录不存在。\n先创建父目录或改用已存在路径，再重新执行写入。',
    'en-US': 'Suggestion: parent directory of target path does not exist.\nCreate parent directory first or use existing path.',
  },
  'recovery.advice.model': {
    'zh-CN': '建议：将当前步骤拆分为更小的子步骤。\n避免一次性输出过多内容。',
    'en-US': 'Suggestion: split current step into smaller sub-steps.\nAvoid outputting too much at once.',
  },
  'recovery.advice.env': {
    'zh-CN': '建议：检查网络连接和 API 凭据。\n可以尝试使用备用方案。',
    'en-US': 'Suggestion: check network connection and API credentials.\nTry alternative approaches.',
  },
  'recovery.advice.user_input': {
    'zh-CN': '建议：向用户请求澄清。',
    'en-US': 'Suggestion: ask user for clarification.',
  },
  'recovery.advice.conflict': {
    'zh-CN': '建议：检查是否有并发操作修改同一文件。',
    'en-US': 'Suggestion: check for concurrent operations on the same file.',
  },
  'escalation.need_help': {
    'zh-CN': '需要你的帮助',
    'en-US': 'Need your help',
  },
  'escalation.question_context': {
    'zh-CN': '任务「{{taskDescription}}」三次自动恢复失败（{{category}}/{{subtype}}）。{{message}}',
    'en-US': 'Task "{{taskDescription}}" failed 3 auto-recovery attempts ({{category}}/{{subtype}}). {{message}}',
  },
  'escalation.attempt_result': {
    'zh-CN': '失败',
    'en-US': 'failed',
  },

  // diagnostic-reporter.ts
  'diag.unknown_reason': {
    'zh-CN': '未知错误（{{category}}/{{subtype}}）',
    'en-US': 'Unknown error ({{category}}/{{subtype}})',
  },
  'diag.no_attempts': {
    'zh-CN': '（无尝试记录）',
    'en-US': '(no attempts recorded)',
  },
  'diag.please_ask': {
    'zh-CN': '请问：',
    'en-US': 'Please clarify:',
  },
  'diag.suspected_reason': {
    'zh-CN': '疑似原因',
    'en-US': 'Suspected reason',
  },
  'diag.warn_banner': {
    'zh-CN': 'WARN: 需要你的帮助',
    'en-US': 'WARN: Need your help',
  },
  'diag.tried': {
    'zh-CN': '已尝试：',
    'en-US': 'Attempted:',
  },
  'diag.task_label': {
    'zh-CN': '任务：',
    'en-US': 'Task:',
  },
};

// 诊断条目（中文硬编码解耦）
interface DiagnosisEntryL10n {
  inferReason: Record<Locale, string>;
  questions: [Record<Locale, string>, Record<Locale, string>];
}

export const DIAGNOSIS_L10N_TABLE: Record<string, Record<string, DiagnosisEntryL10n>> = {
  tool: {
    'selector-not-found': {
      inferReason: {
        'zh-CN': '页面 DOM 结构与预期不一致，可能是登录态失效或前端版本变更',
        'en-US': 'Page DOM structure differs from expectation; login state may have expired or the frontend version changed',
      },
      questions: [
        {
          'zh-CN': '该页面是否需要先登录？',
          'en-US': 'Does the page require login first?',
        },
        {
          'zh-CN': '能否提供登录后该元素的可见 selector？',
          'en-US': 'Can you provide a visible selector for the element after login?',
        },
      ],
    },
    timeout: {
      inferReason: {
        'zh-CN': '操作超时，目标资源可能响应缓慢或已下线',
        'en-US': 'Operation timed out; target resource may be slow or offline',
      },
      questions: [
        {
          'zh-CN': '是否有网络代理或访问限制？',
          'en-US': 'Is there a network proxy or access restriction?',
        },
        {
          'zh-CN': '可以提供该工具的备用端点或超时容限？',
          'en-US': 'Can you provide an alternative endpoint or timeout tolerance?',
        },
      ],
    },
    'resource-not-found': {
      inferReason: {
        'zh-CN': '目标文件或路径不存在，任务描述中的路径可能已变更',
        'en-US': 'Target file or path does not exist; the path in the task may have changed',
      },
      questions: [
        {
          'zh-CN': '目标文件是否已被移动或重命名？',
          'en-US': 'Has the target file been moved or renamed?',
        },
        {
          'zh-CN': '请确认正确的文件路径。',
          'en-US': 'Please confirm the correct file path.',
        },
      ],
    },
    unknown: {
      inferReason: {
        'zh-CN': '工具执行失败，原因尚不明确',
        'en-US': 'Tool execution failed; reason unclear',
      },
      questions: [
        {
          'zh-CN': '该工具是否有已知的版本兼容问题？',
          'en-US': 'Does this tool have known version compatibility issues?',
        },
        {
          'zh-CN': '是否可以提供更详细的操作步骤？',
          'en-US': 'Can you provide more detailed steps?',
        },
      ],
    },
  },
  model: {
    'json-parse': {
      inferReason: {
        'zh-CN': '模型输出格式异常，JSON 解析失败——可能是上下文过长导致截断',
        'en-US': 'Model output format anomaly; JSON parse failure — possibly truncated due to long context',
      },
      questions: [
        {
          'zh-CN': '是否可以将任务拆分为更小的子步骤？',
          'en-US': 'Can you split the task into smaller sub-steps?',
        },
        {
          'zh-CN': '是否需要切换到推理能力更强的模型？',
          'en-US': 'Do you need to switch to a model with stronger reasoning?',
        },
      ],
    },
  },
  environment: {
    'auth-expired': {
      inferReason: {
        'zh-CN': 'API Key 或凭据已过期，外部服务拒绝请求',
        'en-US': 'API key or credentials expired; external service rejected the request',
      },
      questions: [
        {
          'zh-CN': '请检查 API Key 是否仍有效',
          'en-US': 'Please check if the API key is still valid',
        },
        {
          'zh-CN': '是否需要切换到备用端点或模型？',
          'en-US': 'Do you need to switch to a fallback endpoint or model?',
        },
      ],
    },
    'network-unreachable': {
      inferReason: {
        'zh-CN': '网络不可达，目标服务可能暂时离线或被防火墙拦截',
        'en-US': 'Network unreachable; target service may be offline or blocked by firewall',
      },
      questions: [
        {
          'zh-CN': '当前网络环境是否有代理设置？',
          'en-US': 'Does the current network environment have a proxy setting?',
        },
        {
          'zh-CN': '是否可以稍后重试或使用离线替代方案？',
          'en-US': 'Can you retry later or use an offline alternative?',
        },
      ],
    },
  },
  user_input: {
    'ambiguous-task': {
      inferReason: {
        'zh-CN': '任务描述存在歧义，无法确定正确的执行意图',
        'en-US': 'Task description has ambiguity; cannot determine correct execution intent',
      },
      questions: [
        {
          'zh-CN': '请描述期望的最终输出是什么？',
          'en-US': 'Please describe the expected final output.',
        },
        {
          'zh-CN': '是否有参考示例或约束条件可以补充？',
          'en-US': 'Are there reference examples or constraints to add?',
        },
      ],
    },
  },
  state_conflict: {
    conflict: {
      inferReason: {
        'zh-CN': '检测到状态冲突，多个操作对同一资源产生了竞争',
        'en-US': 'State conflict detected; multiple operations competing for the same resource',
      },
      questions: [
        {
          'zh-CN': '是否有其他并发任务在修改同一文件？',
          'en-US': 'Are there other concurrent tasks modifying the same file?',
        },
        {
          'zh-CN': '是否可以暂停其他任务后重试？',
          'en-US': 'Can you pause other tasks and retry?',
        },
      ],
    },
  },
};

// ── 获取消息 ──────────────────────────────────────────

/**
 * 获取本地化消息。
 * @param key - 消息键名
 * @param params - 插值参数（可选）
 */
export function t(key: string, params?: Record<string, string>): string {
  const entry = messages[key];
  if (!entry) {
    return key; // fallback: 返回键名
  }
  let msg = entry[currentLocale] ?? entry['en-US'] ?? entry['zh-CN'] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      msg = msg.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
    }
  }
  return msg;
}
