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
