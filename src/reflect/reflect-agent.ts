/**
 * ReflectAgent — 会话结束后异步运行的反思代理。
 *
 * 职责：
 *   1. 扫描 git diff + 任务描述，提取行为模式
 *   2. 写入/更新 preference-candidates.json
 *   3. 判断候选是否满足升级条件 → 升级到 preferences.md
 *   4. 清理过期候选条目
 *
 * 阶段二不含 Bounded Breaker（阶段三补充）。
 */

import { PreferenceCandidatesManager } from '../memory/candidates/manager.js';
import { PreferencesManager } from '../memory/preferences/manager.js';
import { extractPatterns } from './pattern-rules.js';
import type { ExtractedPattern } from './pattern-rules.js';

export interface ReflectInput {
  taskId: string;
  sessionRef: string;
  taskDescription: string;
  /** 本次任务产生的 git diff */
  gitDiff: string;
  /** 累计任务计数，用于冷启动保护判断 */
  totalTaskCount: number;
}

export interface ReflectResult {
  patternsExtracted: number;
  candidatesUpdated: number;
  promoted: string[];
  cleanupStats: { discarded: number; archived: number; deleted: number };
}

export class ReflectAgent {
  constructor(
    private readonly candidatesManager: PreferenceCandidatesManager,
    private readonly preferencesManager: PreferencesManager,
  ) {}

  /** 主入口：会话结束后调用 */
  async run(input: ReflectInput): Promise<ReflectResult> {
    const result: ReflectResult = {
      patternsExtracted: 0,
      candidatesUpdated: 0,
      promoted: [],
      cleanupStats: { discarded: 0, archived: 0, deleted: 0 },
    };

    try {
      // 1. 提取行为模式
      const existingCandidates = await this.candidatesManager.getAll();
      const existingPatterns = existingCandidates.map((c) => c.pattern);
      const patterns = extractPatterns(input.gitDiff, input.taskDescription, existingPatterns);
      result.patternsExtracted = patterns.length;

      // 2. 写入/更新候选池
      await this.observePatterns(patterns, input);
      result.candidatesUpdated = patterns.length;

      // 3. 升级判定
      const promoted = await this.tryPromoteEligible(input.totalTaskCount, input);
      result.promoted = promoted;

      // 4. 清理
      result.cleanupStats = await this.candidatesManager.cleanup();
    } catch (err) {
      console.error(
        '[ReflectAgent] run failed:',
        err instanceof Error ? err.message : String(err),
      );
    }

    return result;
  }

  /** 将提取的模式写入候选池 */
  private async observePatterns(
    patterns: ExtractedPattern[],
    input: ReflectInput,
  ): Promise<void> {
    for (const p of patterns) {
      await this.candidatesManager.observe({
        pattern: p.pattern,
        scope: p.scope,
        taskId: input.taskId,
        sessionRef: input.sessionRef,
        triggerContext: p.triggerContext,
      });
    }
  }

  /** 检查所有候选，升级满足条件的 */
  private async tryPromoteEligible(
    totalTaskCount: number,
    input: ReflectInput,
  ): Promise<string[]> {
    const promoted: string[] = [];
    const candidates = await this.candidatesManager.getAll();

    for (const candidate of candidates) {
      const { eligible } = this.candidatesManager.checkUpgradeEligibility(
        candidate,
        totalTaskCount,
      );

      if (!eligible) continue;

      const latestProv = candidate.provenance[candidate.provenance.length - 1];

      await this.preferencesManager.promoteFromCandidate({
        rule: candidate.pattern,
        scope: candidate.scope,
        provenance: {
          source_type: 'reflect-agent',
          task_id: input.taskId,
          session_ref: input.sessionRef,
          created_at: new Date().toISOString(),
        },
        // 阶段二无 Breaker，不设置 applyCaution
      });

      promoted.push(candidate.id);
    }

    return promoted;
  }
}
