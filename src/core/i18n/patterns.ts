/**
 * i18n 反馈模式 — 负面反馈检测的正则表达式。
 *
 * 按语言分组，宿主根据当前语言环境选择合适的模式列表。
 */

export const NEGATIVE_PATTERNS_BY_LOCALE: Record<string, RegExp[]> = {
  'zh-CN': [
    /还是(不行|不对|这[个样]?样子|没变|错的|有问题)/,
    /没有?效果/,
    /没用/,
    /不对[，,。]?/,
    /改了但没?变/,
    /这不是我想要的/,
    /不是这个意思/,
    /看起来(还是|仍然)(不对|有问题)/,
    /还是(原来的|旧的|之前的)/,
    /(报错|错误|异常|失败|崩了|打不开)/,
    /Failed to load/i,
    /net::ERR_[A-Z_]+/,
  ],
  'en-US': [
    /(still|not yet|not quite)( not| wrong| correct| what| fixed)?/i,
    /(doesn't|does not|isn't|is not|won't|will not) (work|correct|right)/i,
    /not (fix|change|what I want|what I expected)/i,
    /(error|fail|crash|broken|bug)/i,
    /Failed to load/i,
    /net::ERR_[A-Z_]+/,
    /(nothing changed|still the same|still broken|still failing)/i,
    /that('s| is) not what I meant/i,
  ],
};
