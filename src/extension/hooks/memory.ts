/**
 * Memory Hook — 分层记忆注入。
 * 在创建 Pi Session 时注入到 system prompt。
 *
 * 优先级层叠：project-rules > preferences > questions
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PreferencesManager } from '../../memory/preferences/manager.js';
import { QuestionsManager } from '../../memory/questions/manager.js';

// ── 记忆注入 ──────────────────────────────────────────

/**
 * 创建记忆注入 hook。
 * 返回可直接传给 StudentAgentHooks.buildMemoryPrompt 的函数。
 *
 * 读取顺序：
 * 1. memory/project-rules.md（最高优先级，用户显式规则）
 * 2. memory/preferences.md（ReflectAgent 学习到的偏好）
 * 3. memory/questions.json 中的历史问答对（最低优先级）
 */
export function createMemoryHook(memoryDir: string) {
  return async (): Promise<string> => {
    const sections: string[] = [];

    // 1. project-rules（显式规则，最高优先级）
    const projectRules = await readFileSafe(join(memoryDir, 'project-rules.md'));
    if (projectRules) {
      sections.push(
        '## Project Rules（项目规则，必须遵守）\n\n' + projectRules,
      );
    }

    // 2. preferences（学习到的偏好）
    const prefsManager = PreferencesManager.getInstance(memoryDir);
    const prefs = await prefsManager.getAll();
    if (prefs.length > 0) {
      const prefsText = prefs
        .map((p) => {
          const caution = p.apply_caution ? ' WARN: APPLY_WITH_CAUTION' : '';
          return `- ${p.rule}（来源：${p.provenance.source_type}，scope：${p.scope}${caution}）`;
        })
        .join('\n');
      sections.push(
        '## User Preferences（用户偏好，尽量遵守）\n\n' + prefsText,
      );
    }

    // 3. questions（历史问答，最低优先级参考）
    const questionsManager = QuestionsManager.getInstance(memoryDir);
    const questions = await questionsManager.getAll();
    const resolved = questions.filter((q) => q.status === 'resolved' && q.resolution);
    if (resolved.length > 0) {
      const qaText = resolved
        .slice(-10) // 只取最近 10 条
        .map((q) => `Q: [${q.error_type}/${q.error_subtype}] ${q.context}\nA: ${q.resolution}`)
        .join('\n\n');
      sections.push(
        '## Past Q&A（过去的问答参考）\n\n' + qaText,
      );
    }

    sections.push(`
## 文件探索规则（必须遵守）

**永远不要在不知道目标文件的情况下批量 read 文件。** 正确流程：

1. 先用 grep/glob 定位：grep 关键词、类名、函数名，找到具体文件路径
2. 再 read 那几个文件（每次任务最多读 15 个文件）
3. 不确定项目结构时，只读 CLAUDE.md——它已描述完整结构

❌ 错误做法：read src/a.ts → read src/b.ts → read src/c.ts（逐个扫描）
✅ 正确做法：grep "关键词" → 看结果 → 只 read 命中的文件
`);

    sections.push(`
## 任务管理输出格式（必须遵守）

当你理解用户意图并准备开始一个新任务时，在第一条回复的开头输出：
[TASK_START name="任务简称（15字以内）"]
Phase 1: 第一步描述
Phase 2: 第二步描述
...（2-5个Phase）
[/TASK_START]

当你认为当前 Phase 的工作已完成时，在回复末尾输出：
[PHASE_DONE phase=N]
已完成：一句话描述完成的内容。
下一步：下一个 Phase 的简要说明。
[/PHASE_DONE]

N 是当前 Phase 的编号（从 1 开始）。不要在未完成时输出这些标记。
`);

    if (sections.length === 0) {
      return '';
    }

    return (
      '# Student Agent 记忆上下文\n\n' +
      '以下是从过去交互中学习到的信息，按优先级从高到低排列：\n\n' +
      sections.join('\n\n---\n\n')
    );
  };
}

// ── 辅助函数 ──────────────────────────────────────────

async function readFileSafe(path: string): Promise<string | null> {
  try {
    const content = await readFile(path, 'utf-8');
    return content.trim() || null;
  } catch {
    return null;
  }
}
