import { describe, expect, it } from 'vitest';
import {
  WRITE_LESSON_AEVO_GUIDELINE,
  WRITE_LESSON_HARVEST_PROMPT,
  WRITE_LESSON_INSTRUCTION,
  buildWriteLessonPromptSuffix,
  formatWriteLessonArcReminder,
  formatWriteLessonHarvestPrompt,
  shouldHarvestWriteLessons,
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

  it('harvests only when the run had an error and never called write_lesson', () => {
    expect(shouldHarvestWriteLessons([
      { name: 'bash', isError: true },
      { name: 'edit', isError: false },
    ])).toBe(true);
    expect(shouldHarvestWriteLessons([
      { name: 'edit', isError: false },
    ])).toBe(false);
    expect(shouldHarvestWriteLessons([
      { name: 'bash', isError: true },
      { name: 'write_lesson', isError: false },
    ])).toBe(false);
    expect(shouldHarvestWriteLessons([
      { name: 'bash', isError: true },
      { name: 'write_lesson', isError: false },
    ], ['arc-2'])).toBe(true);
  });

  it('uses R8 arc/harvest copy (live constants; v0.5 freeze archived)', () => {
    expect(formatWriteLessonArcReminder('arc-3')).toBe(
      '你刚完成一次先错后改对（arc-3）。立即调用 write_lesson 记录，evidence 填 { "arcId": "arc-3" }。',
    );
    expect(formatWriteLessonHarvestPrompt([])).toBe(WRITE_LESSON_HARVEST_PROMPT);
    expect(formatWriteLessonHarvestPrompt(['arc-1', 'arc-3'])).toBe(
      '回顾本次任务中先做错、后改对的地方（含走弯路），逐条调用 write_lesson 记录后再结束。未认领弧线：arc-1, arc-3。evidence 填 { "arcId": "<id>" }。',
    );
    expect(formatWriteLessonArcReminder('arc-3')).not.toContain('harness');
    expect(formatWriteLessonHarvestPrompt(['arc-1'])).not.toContain('pytest');
    expect(formatWriteLessonHarvestPrompt(['arc-1'])).not.toContain('harness');
  });
});
