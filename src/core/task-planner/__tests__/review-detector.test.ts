import { describe, expect, it } from 'vitest';
import { detectNaturalReviewResponse } from '../review-detector.js';

describe('detectNaturalReviewResponse', () => {
  it.each([
    '可以',
    '可以了',
    '没问题',
    '就这样',
    '通过',
    '满意',
    'ok',
    'LGTM',
  ])('detects acceptance: %s', (input) => {
    expect(detectNaturalReviewResponse(input)).toMatchObject({
      type: 'accepted',
      text: input,
    });
  });

  it.each([
    '不行，按钮太挤了',
    '颜色不对',
    '我不喜欢这个布局',
    '再改一下间距',
    '希望按钮更明显',
    '文案换一下',
  ])('detects revision feedback: %s', (input) => {
    expect(detectNaturalReviewResponse(input)).toMatchObject({
      type: 'revision_requested',
      text: input,
    });
  });

  it.each([
    '我看看',
    '等一下',
    '为什么这里这么设计？',
    '',
  ])('leaves ambiguous review replies alone: %s', (input) => {
    expect(detectNaturalReviewResponse(input)).toMatchObject({
      type: 'ambiguous',
      text: input.trim(),
    });
  });
});
