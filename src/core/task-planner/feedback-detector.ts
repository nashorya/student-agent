export interface FeedbackSignal {
  isNegative: boolean;
  extractedText: string;
}

import { getLocale } from '../i18n/messages.js';
import { NEGATIVE_PATTERNS_BY_LOCALE } from '../i18n/patterns.js';

export function detectNegativeFeedback(input: string): FeedbackSignal {
  const patterns = NEGATIVE_PATTERNS_BY_LOCALE[getLocale()] ?? NEGATIVE_PATTERNS_BY_LOCALE['zh-CN'];
  const isNegative = patterns.some((re) => re.test(input));
  return { isNegative, extractedText: input };
}
