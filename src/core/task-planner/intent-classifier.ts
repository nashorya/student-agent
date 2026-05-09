import { completeSimple, type Model, type Api } from '@mariozechner/pi-ai';

export type IntentType = 'new_task' | 'continue';

export interface IntentResult {
  type: IntentType;
  taskName?: string;
}

const SYSTEM_PROMPT = `你是一个意图分类器。判断用户输入属于哪种意图：
- "new_task"：用户在描述一个新任务（改某个功能、做某件事）
- "continue"：用户在继续当前任务、提问、或做其他操作

输出严格 JSON，不加任何解释。格式：
新任务：{"type":"new_task","task_name":"简短任务名（15字以内）"}
其他：{"type":"continue"}`;

export async function classifyIntent(
  input: string,
  currentTaskName: string | null,
  model: Model<Api>,
): Promise<IntentResult> {
  if (isMetaQuestion(input)) {
    return { type: 'continue' };
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
    if (!jsonMatch) return { type: 'continue' };

    const parsed = JSON.parse(jsonMatch[0]) as { type: string; task_name?: string };
    if (parsed.type === 'new_task') {
      return { type: 'new_task', taskName: parsed.task_name };
    }
    return { type: 'continue' };
  } catch {
    return { type: 'continue' };
  }
}

export function isMetaQuestion(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  const asksHow = /(怎么|如何|怎样|该怎么|要怎么|怎么办|怎么做|如何做|怎么用|如何使用|怎么触发|怎么操作|what|how)/i.test(text);
  const asksCapability = /(能不能|可以吗|是否可以|是不是|是什么|介绍|说明|流程|用法|命令|技能|能力|design|设计|学习|网站|网页)/i.test(text);
  const questionMark = /[?？]$/.test(text);
  return (asksHow && asksCapability) || (questionMark && asksCapability);
}
