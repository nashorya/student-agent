import { describe, it, expect } from 'vitest';
import { detectNegativeFeedback } from '../feedback-detector.js';

describe('detectNegativeFeedback', () => {
  it.each([
    ['还是不行', true],
    ['没有效果', true],
    ['还是这个样子', true],
    ['不对，颜色还是错的', true],
    ['没用', true],
    ['这不是我想要的', true],
    ['改了但没变化', true],
    ['好的，继续下一步', false],
    ['帮我修改首页', false],
    ['这样可以了', false],
  ])('"%s" → isNegative: %s', (input, expected) => {
    expect(detectNegativeFeedback(input).isNegative).toBe(expected);
  });

  it('returns the input as extractedText', () => {
    const result = detectNegativeFeedback('还是不行，颜色没变');
    expect(result.extractedText).toBe('还是不行，颜色没变');
  });
});
