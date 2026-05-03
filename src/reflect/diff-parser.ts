/**
 * Git diff 解析器。
 * 将 git diff 文本拆分为结构化的 FileDiff → DiffHunk，供模式规则匹配使用。
 */

export interface DiffHunk {
  /** 删除的行（不含前缀 -） */
  removed: string[];
  /** 新增的行（不含前缀 +） */
  added: string[];
}

export interface FileDiff {
  filePath: string;
  hunks: DiffHunk[];
}

// 跳过的文件模式
const SKIP_PATTERNS = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.min\.(js|css)$/,
  /\.snap$/,
  /\/(dist|build|\.next|node_modules)\//,
  /\.generated\./,
];

// 配置文件（A5/A6 需要检测是否修改了这些文件）
const FORMATTER_CONFIG_PATTERNS = [
  /\.prettierrc/,
  /prettier\.config/,
  /\.eslintrc/,
  /eslint\.config/,
  /tslint\.json/,
];

/** 检查文件路径是否应跳过 */
function shouldSkipFile(filePath: string): boolean {
  return SKIP_PATTERNS.some((re) => re.test(filePath));
}

/** 检查本次 diff 是否包含格式化配置文件的修改 */
export function hasFormatterConfigChange(files: FileDiff[]): boolean {
  return files.some((f) =>
    FORMATTER_CONFIG_PATTERNS.some((re) => re.test(f.filePath)),
  );
}

/** 从 diff --git 行中提取文件路径 */
function extractFilePath(diffHeader: string): string {
  // diff --git a/path/to/file b/path/to/file
  const match = /^diff --git a\/(.+?) b\//.exec(diffHeader);
  return match ? match[1] : '';
}

/** 将单个文件的 diff 文本拆分为 hunks */
function parseFileHunks(fileSection: string): DiffHunk[] {
  const hunkSections = fileSection.split(/^@@[^@]*@@.*$/m);
  // 第一段是文件头信息（index、---、+++），跳过
  const hunks: DiffHunk[] = [];

  for (let i = 1; i < hunkSections.length; i++) {
    const lines = hunkSections[i].split('\n');
    const removed: string[] = [];
    const added: string[] = [];

    for (const line of lines) {
      if (line.startsWith('-')) {
        removed.push(line.slice(1));
      } else if (line.startsWith('+')) {
        added.push(line.slice(1));
      }
    }

    if (removed.length > 0 || added.length > 0) {
      hunks.push({ removed, added });
    }
  }

  return hunks;
}

/**
 * 将完整的 git diff 文本解析为 FileDiff 数组。
 * 自动过滤 lock、generated、minified 等文件。
 */
export function parseDiff(diffText: string): FileDiff[] {
  if (!diffText.trim()) return [];

  const fileSections = diffText.split(/^(?=diff --git )/m);
  const result: FileDiff[] = [];

  for (const section of fileSections) {
    if (!section.startsWith('diff --git ')) continue;

    const firstLine = section.split('\n')[0];
    const filePath = extractFilePath(firstLine);
    if (!filePath || shouldSkipFile(filePath)) continue;

    const hunks = parseFileHunks(section);
    if (hunks.length > 0) {
      result.push({ filePath, hunks });
    }
  }

  return result;
}
