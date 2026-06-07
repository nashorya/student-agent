import { completeSimple, type Model, type Api } from '@mariozechner/pi-ai';

export type IntentType = 'new_task' | 'task_advance' | 'continue';
export type WorkflowLevel = 0 | 1 | 2 | 3 | 4;

export interface IntentResult {
  type: IntentType;
  taskName?: string;
  level: WorkflowLevel;
  reason: string;
  requiresPlan: boolean;
  requiresUserAcceptance: boolean;
  requiresVisualReview: boolean;
}

const SYSTEM_PROMPT = `你是一个意图分类器。判断用户输入属于哪种意图，并评估任务复杂度。

意图类型：
- "new_task"：用户在描述一个新任务
- "task_advance"：用户在推进当前任务（确认计划、说继续/下一步、同意执行等）
- "continue"：追问、提问、与当前任务无关的操作（包括取消/退出/查询状态等）

任务等级（仅 new_task 需要）：
- level 1：单点小改动，一两个文件内可完成（如：加一个函数、改个 bug、更新配置）
- level 2：中等任务，涉及多处改动但目标明确（如：加一个 API 端点、实现某个工具函数）
- level 3：复杂任务，需要多阶段规划（如：实现一个完整系统/模块、多文件重构、端到端功能、含测试的完整特性）

输出严格 JSON，不加任何解释。格式：
新任务：{"type":"new_task","level":1,"task_name":"简短任务名（15字以内）"}
推进任务：{"type":"task_advance"}
其他：{"type":"continue"}

判断 task_advance 的关键：输入很短、表达同意或推进（好/可以/继续/下一步/开始/确认/那就这样/没问题）。
判断 continue 的关键：包含问号/疑问词、或包含取消/退出/查询/解释类词语。
level 3 的判断标准：涉及 3 个以上文件、或需要设计决策、或用户说了"系统/完整/全套/从零"等词。`;

export async function classifyIntent(
  input: string,
  currentTaskName: string | null,
  model: Model<Api>,
): Promise<IntentResult> {
  const deterministic = classifyWorkflowIntent(input, currentTaskName);
  if (deterministic) {
    return deterministic;
  }

  const context = currentTaskName
    ? `当前任务：${currentTaskName}\n用户输入：${input}`
    : `当前任务：无\n用户输入：${input}`;

  try {
    const result = await completeSimple(model, {
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: context }], timestamp: Date.now() }],
    });

    const text = result.content.find((c) => c.type === 'text')?.text ?? '';
    const jsonMatch = /\{[\s\S]*\}/.exec(text);
    if (!jsonMatch) return continueResult('llm-output-without-json');

    const parsed = JSON.parse(jsonMatch[0]) as { type: string; task_name?: string; level?: number };
    if (parsed.type === 'new_task') {
      const llmLevel = parsed.level === 1 ? 1 : parsed.level === 3 ? 3 : 2;
      return newTaskResult({
        input,
        taskName: parsed.task_name,
        level: llmLevel as WorkflowLevel,
        reason: 'llm-classified-new-task',
        requiresPlan: llmLevel >= 3,
        requiresUserAcceptance: llmLevel >= 2,
      });
    }
    if (parsed.type === 'task_advance') {
      return taskAdvanceResult('llm-classified-task-advance');
    }
    return continueResult('llm-classified-continue');
  } catch {
    return continueResult('llm-error');
  }
}

export function classifyWorkflowIntent(input: string, currentTaskName: string | null): IntentResult | null {
  const text = input.trim();
  if (!text) return continueResult('empty-input');

  if (isMetaQuestion(text) || isInformationalFollowUp(text)) {
    return continueResult('question-or-analysis-only');
  }

  if (currentTaskName && TASK_ADVANCE_RE.test(text)) {
    return taskAdvanceResult('active-task-continuation');
  }

  if (/(跨\s*session|跨会话|长期任务|后台任务|subagent|子代理|long[- ]?running)/iu.test(text)) {
    return newTaskResult({
      input: text,
      level: 4,
      reason: 'long-running-or-subagent-request',
      requiresPlan: true,
      requiresUserAcceptance: true,
    });
  }

  if (EXPLICIT_PLAN_REQUEST_RE.test(text)) {
    return newTaskResult({
      input: text,
      level: 3,
      reason: 'explicit-plan-or-task-request',
      requiresPlan: true,
      requiresUserAcceptance: true,
      requiresVisualReview: isVisualTask(text),
    });
  }

  if (isVisualTask(text) && isActionRequest(text)) {
    return newTaskResult({
      input: text,
      level: 3,
      reason: 'frontend-or-visual-task',
      requiresPlan: true,
      requiresUserAcceptance: true,
      requiresVisualReview: true,
    });
  }

  if (/(多文件|重构|迁移|架构|模块|端到端|完整实现|接入|改造|新增.*功能|实现.*功能|修复.*测试|baseline|eval|状态机|runtime)/iu.test(text)) {
    return newTaskResult({
      input: text,
      level: 3,
      reason: 'multi-step-engineering-task',
      requiresPlan: true,
      requiresUserAcceptance: true,
    });
  }

  if (/(不确定|模糊|帮我想|一起|澄清|需求|验收|偏好)/u.test(text) && isActionRequest(text)) {
    return newTaskResult({
      input: text,
      level: 2,
      reason: 'needs-clarification-or-working-memory',
      requiresPlan: false,
      requiresUserAcceptance: true,
    });
  }

  // 不再兜底判 level 1 — 让 LLM 决定复杂度，避免"做一个完整系统"被错判成简单任务
  return null;
}

const ANALYSIS_ONLY_RE = /(只分析|只解释|只回答|先别改|不要改|不修改|不要执行|只是问|想了解)/u;
const INFORMATION_QUESTION_RE = /[?？]|吗|呢|是不是|是否|哪些|哪(?:一)?部分|多少|主要是|是什么|为什么|为啥|怎么回事|介绍|说明|解释|统计|总结/iu;
const INFORMATION_TOPIC_RE = /(测试|eval|baseline|task|plan|runtime|状态机|代码量|commit|提交|代码|文件|改动|工具|命令|流程|用法|能力|结果|报告|输出|诊断|trace)/iu;
const EXPLICIT_PLAN_REQUEST_RE = /(制定计划|分阶段|开任务|进入\s*task|task\s*模式|计划一下|先规划|plan\b|规划模式|给自己.*task|给你自己.*task|为自己.*task|制定.*task|自己定.*task|自己.*制定.*task)/iu;

export function isInformationalFollowUp(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  if (ANALYSIS_ONLY_RE.test(text)) return true;
  if (isActionRequest(text) || (EXPLICIT_PLAN_REQUEST_RE.test(text) && !INFORMATION_QUESTION_RE.test(text))) {
    return false;
  }
  return INFORMATION_QUESTION_RE.test(text) && INFORMATION_TOPIC_RE.test(text);
}

export function isMetaQuestion(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  // 「让 agent 自己决定做什么」类请求 — 没有具体目标，不应触发规划
  if (/(给自己|为自己|给你自己|你自己).*?(task|任务|目标|计划)/iu.test(text)) return true;
  const asksHow = /(怎么|如何|怎样|该怎么|要怎么|怎么办|怎么做|如何做|怎么用|如何使用|怎么触发|怎么操作|what|how)/i.test(text);
  const asksCapability = /(能不能|可以吗|是否可以|是不是|是什么|介绍|说明|流程|用法|命令|技能|能力|学习|网站|网页)/i.test(text);
  const questionMark = /[?？]$/.test(text);
  return (asksHow && asksCapability) || (questionMark && asksCapability);
}

function newTaskResult(options: {
  input: string;
  taskName?: string;
  level: WorkflowLevel;
  reason: string;
  requiresPlan: boolean;
  requiresUserAcceptance?: boolean;
  requiresVisualReview?: boolean;
}): IntentResult {
  return {
    type: 'new_task',
    taskName: options.taskName ?? summarizeTaskName(options.input),
    level: options.level,
    reason: options.reason,
    requiresPlan: options.requiresPlan,
    requiresUserAcceptance: options.requiresUserAcceptance ?? false,
    requiresVisualReview: options.requiresVisualReview ?? false,
  };
}

function continueResult(reason: string): IntentResult {
  return {
    type: 'continue',
    level: 0,
    reason,
    requiresPlan: false,
    requiresUserAcceptance: false,
    requiresVisualReview: false,
  };
}

function taskAdvanceResult(reason: string): IntentResult {
  return {
    type: 'task_advance',
    level: 0,
    reason,
    requiresPlan: false,
    requiresUserAcceptance: false,
    requiresVisualReview: false,
  };
}

// 推进当前任务的确认短语：短、表达同意/继续
const TASK_ADVANCE_RE = /^(好的?|可以|确认|嗯+|OK|好吧|行|明白|收到|没问题|那就这样|就这样|同意)[\s,，。！!]*$|^(继续|继续当前任务|继续这个任务|继续执行|下一步|执行下一步|执行当前\s*phase|执行当前阶段|开始当前任务|go|yes|y|(好的?|可以|行|嗯+|OK)[，,\s]*(继续|开始|执行|下一步))[\s。！!]*$/iu;

function isVisualTask(input: string): boolean {
  return /(前端|页面|界面|UI|视觉|样式|颜色|布局|响应式|截图|设计|组件|按钮|卡片|CSS|TSX|React)/iu.test(input);
}

function isActionRequest(input: string): boolean {
  return /(帮我|请|实现|修复|修改|新增|添加|改|做|创建|生成|调整|优化|接入|完善|更新|补上|落地|执行|跑|implement|fix|add|update|create|run)/iu.test(input);
}

function summarizeTaskName(input: string): string {
  return input
    .replace(/^(请|帮我|麻烦|可以)?/u, '')
    .replace(/[。！？?!].*$/u, '')
    .trim()
    .slice(0, 15) || '新任务';
}
