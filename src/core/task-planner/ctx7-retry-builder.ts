import { completeSimple, type Model, type Api } from '../pi-compat/index.js';
import type { Context7Client, Context7DocsResult } from '../../knowledge/context7-client.js';

/**
 * Builds a Context7 documentation context for retry attempts.
 *
 * Uses an LLM to extract relevant technical keywords from the task name and
 * failure feedbacks, then queries Context7 for matching documentation.
 *
 * @param taskName - The name/description of the current task
 * @param feedbacks - Array of failure feedback messages from previous attempts
 * @param ctx7Client - Context7 client instance (or compatible mock)
 * @param model - LLM model to use for keyword extraction
 * @returns Documentation content string, or empty string if unavailable
 */
export async function buildCtx7RetryContext(
  taskName: string,
  feedbacks: string[],
  ctx7Client: Pick<Context7Client, 'query'>,
  model: Model<Api>,
): Promise<string> {
  let keywords = '';

  try {
    const result = await completeSimple(model, {
      systemPrompt:
        '根据任务描述和失败反馈，提取 2-5 个最关键的技术搜索关键词（空格分隔，不加标点）。只输出关键词，不加任何解释。',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `任务：${taskName}\n失败反馈：\n${feedbacks.join('\n')}`,
            },
          ],
          timestamp: Date.now(),
        },
      ],
    });
    keywords = result.content.find((c) => c.type === 'text')?.text?.trim() ?? '';
  } catch {
    keywords = taskName;
  }

  if (!keywords) return '';

  try {
    const docs: Context7DocsResult | null = await ctx7Client.query({
      libraryName: keywords,
      topic: taskName,
    });
    if (!docs?.content) return '';
    return docs.content;
  } catch {
    return '';
  }
}
