import { detectNegativeFeedback } from './feedback-detector.js';

export type NaturalReviewResponse =
  | { type: 'accepted'; text: string }
  | { type: 'revision_requested'; text: string }
  | { type: 'ambiguous'; text: string };

const ACCEPT_RE = /^(可以了?|没问题|就这样|通过|满意|挺好|很好|好[的了]?|确认|接受|同意|ok|okay|yes|y|approved?|accepted?|looks good|lgtm)$/iu;
const WAIT_RE = /^(等下|等一下|我看看|先等等|稍等|wait|hold on)$/iu;
const QUESTION_RE = /[?？]\s*$/u;
const REVISION_RE = /(再|重新|继续|改|修改|调整|换|不要|别|不喜欢|不满意|不太|有点|太|颜色|布局|按钮|间距|文案|尺寸|位置|对齐|风格|感觉|希望|想要|需要|还是)/u;

export function detectNaturalReviewResponse(input: string): NaturalReviewResponse {
  const text = input.trim();
  if (!text) return { type: 'ambiguous', text };

  if (ACCEPT_RE.test(text)) {
    return { type: 'accepted', text };
  }

  if (WAIT_RE.test(text) || QUESTION_RE.test(text)) {
    return { type: 'ambiguous', text };
  }

  const negative = detectNegativeFeedback(text);
  if (negative.isNegative || REVISION_RE.test(text)) {
    return { type: 'revision_requested', text };
  }

  return { type: 'ambiguous', text };
}
