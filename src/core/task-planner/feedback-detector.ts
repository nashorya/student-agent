export interface FeedbackSignal {
  isNegative: boolean;
  extractedText: string;
}

const NEGATIVE_PATTERNS = [
  /还是(不行|不对|这[个样]?样子|没变|错的|有问题)/,
  /没有?效果/,
  /没用/,
  /不对[，,。]?/,
  /改了但没?变/,
  /这不是我想要的/,
  /不是这个意思/,
  /看起来(还是|仍然)(不对|有问题)/,
  /还是(原来的|旧的|之前的)/,
];

export function detectNegativeFeedback(input: string): FeedbackSignal {
  const isNegative = NEGATIVE_PATTERNS.some((re) => re.test(input));
  return { isNegative, extractedText: input };
}
