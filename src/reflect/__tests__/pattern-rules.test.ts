import { describe, it, expect } from 'vitest';
import { extractPatterns } from '../pattern-rules.js';

/** 生成包含指定 hunk 数量的 diff 文本 */
function makeDiff(filePath: string, hunks: string[]): string {
  const header = `diff --git a/${filePath} b/${filePath}\nindex abc..def 100644\n--- a/${filePath}\n+++ b/${filePath}\n`;
  return header + hunks.map((h) => `@@ -1,10 +1,10 @@\n${h}`).join('\n');
}

/** 多文件 diff */
function makeMultiFileDiff(files: Array<{ path: string; hunks: string[] }>): string {
  return files.map((f) => makeDiff(f.path, f.hunks)).join('\n');
}

describe('extractPatterns', () => {
  // ── A2：for → 函数式 ──────────────────────────

  describe('A2: 命令式循环 → 函数式', () => {
    it('≥2 hunks 触发', () => {
      const diff = makeDiff('app.ts', [
        '-  for (let i = 0; i < arr.length; i++) {\n+  arr.map((item) => item * 2)',
        '-  items.forEach((x) => process(x))\n+  items.filter((x) => x.valid).map((x) => x.name)',
      ]);
      const patterns = extractPatterns(diff, '重构代码');
      expect(patterns.some((p) => p.pattern.includes('map/filter/reduce'))).toBe(true);
    });

    it('仅 1 hunk 不触发', () => {
      const diff = makeDiff('app.ts', [
        '-  for (const x of items) {\n+  items.map((x) => x)',
      ]);
      const patterns = extractPatterns(diff, '');
      expect(patterns.some((p) => p.pattern.includes('map/filter/reduce'))).toBe(false);
    });
  });

  // ── A3：var → const/let ───────────────────────

  describe('A3: var → const/let', () => {
    it('≥2 hunks 触发', () => {
      const diff = makeDiff('old.js', [
        '-  var name = "a"\n+  const name = "a"',
        '-  var count = 0\n+  let count = 0',
      ]);
      const patterns = extractPatterns(diff, '');
      expect(patterns.some((p) => p.pattern.includes('const/let'))).toBe(true);
    });
  });

  // ── A4：显式类型注解 ──────────────────────────

  describe('A4: 显式类型注解', () => {
    it('TS 文件 ≥2 hunks 触发', () => {
      const diff = makeDiff('utils.ts', [
        '-  const name = "test"\n+  const name: string = "test"',
        '-  function calc(x) {\n+  function calc(x: number): number {',
      ]);
      const patterns = extractPatterns(diff, '');
      expect(patterns.some((p) => p.pattern.includes('TypeScript 类型标注'))).toBe(true);
    });

    it('非 TS 文件不触发', () => {
      const diff = makeDiff('utils.js', [
        '-  const name = "test"\n+  const name: string = "test"',
        '-  function calc(x) {\n+  function calc(x: number): number {',
      ]);
      const patterns = extractPatterns(diff, '');
      expect(patterns.some((p) => p.pattern.includes('TypeScript'))).toBe(false);
    });
  });

  // ── A5：引号风格 ──────────────────────────────

  describe('A5: 引号风格', () => {
    it('≥3 hunks 双引号→单引号触发', () => {
      const diff = makeDiff('app.ts', [
        '-  const a = "hello"\n+  const a = \'hello\'',
        '-  const b = "world"\n+  const b = \'world\'',
        '-  const c = "foo"\n+  const c = \'foo\'',
      ]);
      const patterns = extractPatterns(diff, '');
      expect(patterns.some((p) => p.pattern === '用户偏好单引号')).toBe(true);
    });

    it('仅 2 hunks 不触发', () => {
      const diff = makeDiff('app.ts', [
        '-  const a = "hello"\n+  const a = \'hello\'',
        '-  const b = "world"\n+  const b = \'world\'',
      ]);
      const patterns = extractPatterns(diff, '');
      expect(patterns.some((p) => p.pattern.includes('引号'))).toBe(false);
    });

    it('>15 hunks 跳过（linter 自动格式化）', () => {
      const hunks = Array.from({ length: 20 }, (_, i) =>
        `-  const x${i} = "v"\n+  const x${i} = 'v'`,
      );
      const diff = makeDiff('big.ts', hunks);
      const patterns = extractPatterns(diff, '');
      expect(patterns.some((p) => p.pattern.includes('引号'))).toBe(false);
    });

    it('有 .prettierrc 变更时跳过', () => {
      const diff = makeMultiFileDiff([
        {
          path: '.prettierrc',
          hunks: ['-  "singleQuote": false\n+  "singleQuote": true'],
        },
        {
          path: 'app.ts',
          hunks: [
            '-  const a = "hello"\n+  const a = \'hello\'',
            '-  const b = "world"\n+  const b = \'world\'',
            '-  const c = "foo"\n+  const c = \'foo\'',
          ],
        },
      ]);
      const patterns = extractPatterns(diff, '');
      expect(patterns.some((p) => p.pattern.includes('引号'))).toBe(false);
    });
  });

  // ── A6：分号偏好 ──────────────────────────────

  describe('A6: 分号偏好', () => {
    it('≥3 hunks 移除分号触发', () => {
      const diff = makeDiff('app.ts', [
        '-  const a = 1;\n+  const a = 1',
        '-  const b = 2;\n+  const b = 2',
        '-  return result;\n+  return result',
      ]);
      const patterns = extractPatterns(diff, '');
      expect(patterns.some((p) => p.pattern === '用户偏好无分号风格')).toBe(true);
    });
  });

  // ── A7：删除调试输出 ──────────────────────────

  describe('A7: 删除调试输出', () => {
    it('≥2 hunks 触发', () => {
      const diff = makeDiff('app.ts', [
        '-  console.log("debug info")',
        '-  debugger',
      ]);
      const patterns = extractPatterns(diff, '');
      expect(patterns.some((p) => p.pattern.includes('调试输出'))).toBe(true);
    });

    it('替换（删除+新增）不触发', () => {
      const diff = makeDiff('app.ts', [
        '-  console.log("old")\n+  console.log("new")',
        '-  console.debug("old2")\n+  console.debug("new2")',
      ]);
      const patterns = extractPatterns(diff, '');
      expect(patterns.some((p) => p.pattern.includes('调试输出'))).toBe(false);
    });
  });

  // ── A8：async/await 偏好 ──────────────────────

  describe('A8: async/await 偏好', () => {
    it('≥2 hunks .then→await 触发', () => {
      const diff = makeDiff('api.ts', [
        '-  fetch(url).then(r => r.json())\n+  const r = await fetch(url)',
        '-  db.query().then(rows => process(rows))\n+  const rows = await db.query()',
      ]);
      const patterns = extractPatterns(diff, '');
      expect(patterns.some((p) => p.pattern.includes('async/await'))).toBe(true);
    });
  });

  // ── B1：early return ──────────────────────────

  describe('B1: early return', () => {
    it('有 early return + 移除 else 触发', () => {
      const diff = makeDiff('handler.ts', [
        '+  if (!user) return null\n-  } else {\n-    doSomething()',
      ]);
      const patterns = extractPatterns(diff, '');
      expect(patterns.some((p) => p.pattern.includes('early return'))).toBe(true);
    });

    it('超过 10 行新增不触发（判定为新功能）', () => {
      const addedLines = Array.from({ length: 12 }, (_, i) => `+  line${i}()`).join('\n');
      const diff = makeDiff('handler.ts', [
        `+  if (!x) return\n-  } else {\n${addedLines}`,
      ]);
      const patterns = extractPatterns(diff, '');
      expect(patterns.some((p) => p.pattern.includes('early return'))).toBe(false);
    });
  });

  // ── D1：语言偏好 ──────────────────────────────

  describe('D1: 语言偏好', () => {
    it('中文任务描述触发', () => {
      const patterns = extractPatterns('', '请帮我重构这个模块，把错误处理统一下');
      expect(patterns.some((p) => p.pattern === '用户偏好中文沟通')).toBe(true);
    });

    it('英文任务描述触发', () => {
      const patterns = extractPatterns('', 'Please refactor the auth module and fix the tests');
      expect(patterns.some((p) => p.pattern === '用户偏好英文沟通')).toBe(true);
    });

    it('已有候选时不重复生成', () => {
      const patterns = extractPatterns('', '请帮我修复这个 bug', ['用户偏好中文沟通']);
      expect(patterns.some((p) => p.pattern === '用户偏好中文沟通')).toBe(false);
    });
  });

  // ── 文件过滤 ──────────────────────────────────

  describe('文件过滤', () => {
    it('跳过 package-lock.json', () => {
      const diff = makeDiff('package-lock.json', [
        '-  var old = 1\n+  const old = 1',
        '-  var new2 = 2\n+  const new2 = 2',
      ]);
      const patterns = extractPatterns(diff, '');
      expect(patterns).toHaveLength(0);
    });

    it('跳过 .min.js', () => {
      const diff = makeDiff('vendor/lib.min.js', [
        '-  var a = 1\n+  const a = 1',
        '-  var b = 2\n+  const b = 2',
      ]);
      const patterns = extractPatterns(diff, '');
      expect(patterns.some((p) => p.pattern.includes('const/let'))).toBe(false);
    });
  });

  // ── 空输入 ────────────────────────────────────

  it('空 diff 和空描述返回空数组', () => {
    expect(extractPatterns('', '')).toEqual([]);
  });
});
