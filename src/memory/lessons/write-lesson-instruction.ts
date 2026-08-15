/** Freeze-candidate instruction. Snapshot with toBe; do not paraphrase. */
export const WRITE_LESSON_INSTRUCTION =
  '每当你发现自己先做错了、之后又改对了（包括没有报错但走了弯路的情况），立即调用 write_lesson 记录：哪步错了、真正的成因、后来用什么方法改对、错误路径和正确路径的差异。查过文档就带上文档索引。不限次数。';

/**
 * AEvo evaluator-isolation line — not part of the freeze paragraph.
 * per AEvo-2605.13821
 */
export const WRITE_LESSON_AEVO_GUIDELINE =
  'Do not mention harness test names, grader logs, or reward scores in any write_lesson field.';

/**
 * R8 live reminder. v0.5 freeze is archived; interpolate with formatWriteLessonArcReminder.
 */
export function formatWriteLessonArcReminder(arcId: string): string {
  return `你刚完成一次先错后改对（${arcId}）。立即调用 write_lesson 记录，evidence 填 { "arcId": "${arcId}" }。`;
}

/** One extra eval turn when the run had errors and never called write_lesson. */
export const WRITE_LESSON_HARVEST_PROMPT =
  '回顾本次任务中先做错、后改对的地方（含走弯路），逐条调用 write_lesson 记录后再结束。';

/** R8 harvest lists unclaimed arc handles. Empty list keeps the base sentence. */
export function formatWriteLessonHarvestPrompt(unclaimedArcIds: readonly string[]): string {
  if (unclaimedArcIds.length === 0) return WRITE_LESSON_HARVEST_PROMPT;
  return `${WRITE_LESSON_HARVEST_PROMPT}未认领弧线：${unclaimedArcIds.join(', ')}。evidence 填 { "arcId": "<id>" }。`;
}

/** Appended to the factory system prompt even when buildMemoryPrompt is empty. */
export function buildWriteLessonPromptSuffix(): string {
  return WRITE_LESSON_INSTRUCTION;
}

export function shouldHarvestWriteLessons(
  toolCalls: Array<{ name?: string; isError?: boolean }>,
  unclaimedArcIds: readonly string[] = [],
): boolean {
  if (unclaimedArcIds.length > 0) return true;
  const hadError = toolCalls.some((call) => call.isError === true);
  const wrote = toolCalls.some((call) => normalizeToolName(call.name) === 'write_lesson');
  return hadError && !wrote;
}

function normalizeToolName(name: string | undefined): string {
  return (name ?? '').toLowerCase().replace(/^student_/, '');
}
