import { describe, expect, it } from 'vitest';
import {
  WRITE_LESSON_AEVO_GUIDELINE,
  WRITE_LESSON_INSTRUCTION,
  buildWriteLessonPromptSuffix,
} from '../write-lesson-instruction.js';

describe('WRITE_LESSON_INSTRUCTION', () => {
  it('is the freeze-candidate paragraph (exact string)', () => {
    expect(WRITE_LESSON_INSTRUCTION).toBe(
      '每当你发现自己先做错了、之后又改对了（包括没有报错但走了弯路的情况），立即调用 write_lesson 记录：哪步错了、真正的成因、后来用什么方法改对、错误路径和正确路径的差异。查过文档就带上文档索引。不限次数。',
    );
  });

  it('keeps the AEvo guideline out of the freeze paragraph', () => {
    expect(WRITE_LESSON_INSTRUCTION).not.toContain('harness');
    expect(WRITE_LESSON_INSTRUCTION).not.toContain('grader');
    expect(WRITE_LESSON_INSTRUCTION).not.toContain('reward');
    expect(WRITE_LESSON_AEVO_GUIDELINE).toBe(
      'Do not mention harness test names, grader logs, or reward scores in any write_lesson field.',
    );
  });

  it('exposes the factory prompt suffix as the freeze paragraph', () => {
    expect(buildWriteLessonPromptSuffix()).toBe(WRITE_LESSON_INSTRUCTION);
  });
});
