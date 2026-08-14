/** Freeze-candidate instruction. Snapshot with toBe; do not paraphrase. */
export const WRITE_LESSON_INSTRUCTION =
  '每当你发现自己先做错了、之后又改对了（包括没有报错但走了弯路的情况），立即调用 write_lesson 记录：哪步错了、真正的成因、后来用什么方法改对、错误路径和正确路径的差异。查过文档就带上文档索引。不限次数。';

/**
 * AEvo evaluator-isolation line — not part of the freeze paragraph.
 * per AEvo-2605.13821
 */
export const WRITE_LESSON_AEVO_GUIDELINE =
  'Do not mention harness test names, grader logs, or reward scores in any write_lesson field.';

/** Appended to the factory system prompt even when buildMemoryPrompt is empty. */
export function buildWriteLessonPromptSuffix(): string {
  return WRITE_LESSON_INSTRUCTION;
}
