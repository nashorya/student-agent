/**
 * ReflectAgent 模式提取规则（阶段二）。
 *
 * 9 条确定性规则，不调用 LLM。
 * 匹配粒度：以 diff hunk 为单位，同一 hunk 多次匹配计为 1 次。
 */

import type { PreferenceScope } from '../memory/preferences/types.js';
import type { FileDiff, DiffHunk } from './diff-parser.js';
import { parseDiff, hasFormatterConfigChange } from './diff-parser.js';

export interface ExtractedPattern {
  pattern: string;
  scope: PreferenceScope;
  triggerContext: string;
}

// ── 工具函数 ─────────────────────────────────────

function countMatchingHunks(
  files: FileDiff[],
  predicate: (hunk: DiffHunk, filePath: string) => boolean,
): number {
  let count = 0;
  for (const file of files) {
    for (const hunk of file.hunks) {
      if (predicate(hunk, file.filePath)) count++;
    }
  }
  return count;
}

function isTypeScriptFile(filePath: string): boolean {
  return /\.tsx?$/.test(filePath);
}

// ── A2：命令式循环 → 函数式 ─────────────────────

const LOOP_RE = /\bfor\s*\(|\.forEach\s*\(/;
const FUNCTIONAL_RE = /\.(map|filter|reduce|flatMap)\s*\(/;

function checkA2(hunk: DiffHunk): boolean {
  const hasRemovedLoop = hunk.removed.some((l) => LOOP_RE.test(l));
  const hasAddedFunctional = hunk.added.some((l) => FUNCTIONAL_RE.test(l));
  return hasRemovedLoop && hasAddedFunctional;
}

// ── A3：var → const/let ─────────────────────────

function checkA3(hunk: DiffHunk): boolean {
  const removedVars = hunk.removed.filter((l) => /\bvar\s+/.test(l)).length;
  const addedConstLet = hunk.added.filter((l) => /\b(const|let)\s+/.test(l)).length;
  return removedVars > 0 && addedConstLet > 0 && Math.abs(removedVars - addedConstLet) <= 2;
}

// ── A4：添加显式类型注解 ─────────────────────────

const TYPE_ANNOTATION_RE =
  /\b(const|let|var)\s+\w+\s*:\s*\w+|function\s*\w*\s*\([^)]*\)\s*:\s*\w+|\)\s*:\s*\w+\s*=>|:\s*(string|number|boolean|unknown|void|never|Record<|Array<|Promise<)/;

function checkA4(hunk: DiffHunk, filePath: string): boolean {
  if (!isTypeScriptFile(filePath)) return false;
  const addedAnnotations = hunk.added.filter((l) => TYPE_ANNOTATION_RE.test(l)).length;
  const removedAnnotations = hunk.removed.filter((l) => TYPE_ANNOTATION_RE.test(l)).length;
  // 新增的类型注解要比删除的多（排除重构移动）
  return addedAnnotations > removedAnnotations && (addedAnnotations - removedAnnotations) >= 1;
}

// ── A5：引号风格偏好 ─────────────────────────────

function checkA5(hunk: DiffHunk): 'single' | 'double' | null {
  const removedDouble = hunk.removed.some((l) => /"/.test(l));
  const addedSingle = hunk.added.some((l) => /'/.test(l));
  const removedSingle = hunk.removed.some((l) => /'/.test(l));
  const addedDouble = hunk.added.some((l) => /"/.test(l));

  if (removedDouble && addedSingle && !addedDouble) return 'single';
  if (removedSingle && addedDouble && !removedDouble) return 'double';
  return null;
}

// ── A6：分号偏好 ─────────────────────────────────

function checkA6(hunk: DiffHunk): 'add' | 'remove' | null {
  const removedSemiLines = hunk.removed.filter((l) => /;\s*$/.test(l)).length;
  const addedSemiLines = hunk.added.filter((l) => /;\s*$/.test(l)).length;
  const removedNoSemiLines = hunk.removed.filter((l) => /[^;\s]\s*$/.test(l) && l.trim().length > 0).length;
  const addedNoSemiLines = hunk.added.filter((l) => /[^;\s]\s*$/.test(l) && l.trim().length > 0).length;

  // 有分号 → 无分号
  if (removedSemiLines > 0 && addedNoSemiLines > 0 && addedSemiLines === 0) return 'remove';
  // 无分号 → 有分号
  if (removedNoSemiLines > 0 && addedSemiLines > 0 && removedSemiLines === 0) return 'add';
  return null;
}

// ── A7：删除调试输出 ─────────────────────────────

const DEBUG_RE = /\bconsole\.(log|debug|info|warn)\b|\bdebugger\b/;

function checkA7(hunk: DiffHunk): boolean {
  const removedDebug = hunk.removed.some((l) => DEBUG_RE.test(l));
  const addedDebug = hunk.added.some((l) => DEBUG_RE.test(l));
  return removedDebug && !addedDebug;
}

// ── A8：async/await 偏好 ────────────────────────

function checkA8(hunk: DiffHunk): 'await' | 'then' | null {
  const removedThen = hunk.removed.some((l) => /\.then\s*\(/.test(l));
  const addedAwait = hunk.added.some((l) => /\bawait\b/.test(l));
  const removedAwait = hunk.removed.some((l) => /\bawait\b/.test(l));
  const addedThen = hunk.added.some((l) => /\.then\s*\(/.test(l));

  if (removedThen && addedAwait) return 'await';
  if (removedAwait && addedThen) return 'then';
  return null;
}

// ── B1：early return 减少嵌套 ───────────────────

const EARLY_RETURN_RE = /\bif\s*\(.*\)\s*(return|throw|continue)\b/;
const ELSE_RE = /\belse\s*\{/;

function checkB1(hunk: DiffHunk): boolean {
  // 如果同 hunk 新增超过 10 行业务逻辑代码 → 不触发（大概率是新功能）
  if (hunk.added.length > 10) return false;
  const addedEarlyReturn = hunk.added.some((l) => EARLY_RETURN_RE.test(l));
  const removedElse = hunk.removed.some((l) => ELSE_RE.test(l));
  return addedEarlyReturn && removedElse;
}

// ── D1：语言偏好 ────────────────────────────────

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/g;

function detectLanguagePreference(taskDescription: string): 'chinese' | 'english' | null {
  if (!taskDescription.trim()) return null;
  const cjkMatches = taskDescription.match(CJK_RE);
  const cjkRatio = cjkMatches ? cjkMatches.length / taskDescription.length : 0;
  if (cjkRatio > 0.3) return 'chinese';

  const words = taskDescription.split(/\s+/).filter((w) => /^[a-zA-Z]/.test(w));
  const totalTokens = taskDescription.split(/\s+/).length;
  if (totalTokens > 0 && words.length / totalTokens > 0.7) return 'english';

  return null;
}

// ── 主入口 ──────────────────────────────────────

/**
 * 从 git diff 和任务描述中提取行为模式。
 *
 * @param diffText - git diff 全文
 * @param taskDescription - 用户任务描述
 * @param existingPatterns - 已有的候选 pattern（用于 D1 去重）
 */
export function extractPatterns(
  diffText: string,
  taskDescription: string,
  existingPatterns: string[] = [],
): ExtractedPattern[] {
  const files = parseDiff(diffText);
  const results: ExtractedPattern[] = [];
  const hasConfigChange = hasFormatterConfigChange(files);

  // A2：for → 函数式（≥2 hunks）
  if (countMatchingHunks(files, (h) => checkA2(h)) >= 2) {
    results.push({
      pattern: '用户偏好使用 map/filter/reduce 替代简单循环',
      scope: 'code-style',
      triggerContext: 'git diff 中多处将 for/forEach 替换为 map/filter/reduce',
    });
  }

  // A3：var → const/let（≥2 hunks）
  if (countMatchingHunks(files, (h) => checkA3(h)) >= 2) {
    results.push({
      pattern: '用户偏好 const/let 替代 var',
      scope: 'code-style',
      triggerContext: 'git diff 中多处将 var 替换为 const/let',
    });
  }

  // A4：显式类型注解（≥2 hunks，仅 TS）
  if (countMatchingHunks(files, (h, fp) => checkA4(h, fp)) >= 2) {
    results.push({
      pattern: '用户偏好更显式的 TypeScript 类型标注',
      scope: 'code-style',
      triggerContext: 'git diff 中多处新增 TypeScript 类型注解',
    });
  }

  // A5：引号风格（≥3 hunks，>15 跳过，排除 config 变更）
  if (!hasConfigChange) {
    const singleCount = countMatchingHunks(files, (h) => checkA5(h) === 'single');
    const doubleCount = countMatchingHunks(files, (h) => checkA5(h) === 'double');
    if (singleCount >= 3 && singleCount <= 15) {
      results.push({
        pattern: '用户偏好单引号',
        scope: 'code-style',
        triggerContext: `git diff 中 ${singleCount} 处将双引号改为单引号`,
      });
    } else if (doubleCount >= 3 && doubleCount <= 15) {
      results.push({
        pattern: '用户偏好双引号',
        scope: 'code-style',
        triggerContext: `git diff 中 ${doubleCount} 处将单引号改为双引号`,
      });
    }
  }

  // A6：分号风格（≥3 hunks，>15 跳过，排除 config 变更）
  if (!hasConfigChange) {
    const addSemiCount = countMatchingHunks(files, (h) => checkA6(h) === 'add');
    const removeSemiCount = countMatchingHunks(files, (h) => checkA6(h) === 'remove');
    if (removeSemiCount >= 3 && removeSemiCount <= 15) {
      results.push({
        pattern: '用户偏好无分号风格',
        scope: 'code-style',
        triggerContext: `git diff 中 ${removeSemiCount} 处移除了分号`,
      });
    } else if (addSemiCount >= 3 && addSemiCount <= 15) {
      results.push({
        pattern: '用户偏好有分号风格',
        scope: 'code-style',
        triggerContext: `git diff 中 ${addSemiCount} 处新增了分号`,
      });
    }
  }

  // A7：删除调试输出（≥2 hunks）
  if (countMatchingHunks(files, (h) => checkA7(h)) >= 2) {
    results.push({
      pattern: '用户偏好移除调试输出',
      scope: 'code-style',
      triggerContext: 'git diff 中多处删除了 console.log/debugger',
    });
  }

  // A8：async/await 偏好（≥2 hunks）
  const awaitCount = countMatchingHunks(files, (h) => checkA8(h) === 'await');
  const thenCount = countMatchingHunks(files, (h) => checkA8(h) === 'then');
  if (awaitCount >= 2) {
    results.push({
      pattern: '用户偏好 async/await 异步写法',
      scope: 'code-style',
      triggerContext: `git diff 中 ${awaitCount} 处将 .then() 替换为 await`,
    });
  } else if (thenCount >= 2) {
    results.push({
      pattern: '用户偏好 .then() 链式写法',
      scope: 'code-style',
      triggerContext: `git diff 中 ${thenCount} 处将 await 替换为 .then()`,
    });
  }

  // B1：early return（≥1 hunk）
  if (countMatchingHunks(files, (h) => checkB1(h)) >= 1) {
    results.push({
      pattern: '用户偏好 early return 减少嵌套',
      scope: 'control-flow',
      triggerContext: 'git diff 中将 if-else 重构为 early return',
    });
  }

  // D1：语言偏好（去重）
  const lang = detectLanguagePreference(taskDescription);
  if (lang === 'chinese' && !existingPatterns.includes('用户偏好中文沟通')) {
    results.push({
      pattern: '用户偏好中文沟通',
      scope: 'communication',
      triggerContext: '用户任务描述以中文为主',
    });
  } else if (lang === 'english' && !existingPatterns.includes('用户偏好英文沟通')) {
    results.push({
      pattern: '用户偏好英文沟通',
      scope: 'communication',
      triggerContext: '用户任务描述以英文为主',
    });
  }

  return results;
}
