/**
 * ReflectAgent — 会话结束后异步运行的反思代理。
 *
 * 职责：
 *   1. 扫描 git diff + 任务描述，提取行为模式
 *   2. 写入/更新 preference-candidates.json
 *   3. 判断候选是否满足升级条件 → 升级到 preferences.md
 *   4. 清理过期候选条目
 */

import { PreferenceCandidatesManager } from '../memory/candidates/manager.js';
import { PreferencesManager } from '../memory/preferences/manager.js';
import { extractPatterns } from './pattern-rules.js';
import type { ExtractedPattern } from './pattern-rules.js';
import { BoundedBreaker } from './bounded-breaker.js';
import { logger } from '../tui/logger.js';
import { BreakerLogManager } from './breaker-log-manager.js';
import { LessonsManager } from '../memory/lessons/index.js';
import { KnacksManager } from '../memory/knacks/index.js';
import type { LessonCandidate } from '../memory/lessons/index.js';
import type {
  LessonOperationEvidence,
  LessonVerificationEvidence,
} from '../memory/lessons/manager.js';
import type { SignalKind } from '../memory/signals/index.js';

export interface ReflectInput {
  taskId: string;
  sessionRef: string;
  taskDescription: string;
  /** 本次任务产生的 git diff */
  gitDiff: string;
  /** 累计任务计数，用于冷启动保护判断 */
  totalTaskCount: number;
  lessonVerificationEvidence?: LessonVerificationEvidence[];
  lessonOperationEvidence?: LessonOperationEvidence[];
}

export interface ReflectResult {
  patternsExtracted: number;
  lessonsExtracted: number;
  knacksPromoted: number;
  candidatesUpdated: number;
  promoted: string[];
  cleanupStats: { discarded: number; archived: number; deleted: number };
}

export class ReflectAgent {
  constructor(
    private readonly candidatesManager: PreferenceCandidatesManager,
    private readonly preferencesManager: PreferencesManager,
    private readonly boundedBreaker: BoundedBreaker | null = new BoundedBreaker(),
    private readonly breakerLogManager?: BreakerLogManager,
    private readonly lessonsManager?: LessonsManager,
    private readonly knacksManager?: KnacksManager,
  ) {}

  /** 主入口：会话结束后调用 */
  async run(input: ReflectInput): Promise<ReflectResult> {
    const result: ReflectResult = {
      patternsExtracted: 0,
      lessonsExtracted: 0,
      knacksPromoted: 0,
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

      // 3. 从 signal 流观察 lesson candidates
      if (this.lessonsManager) {
        const lessons = await this.lessonsManager.observeRecentSignals({
          taskId: input.taskId,
          sessionRef: input.sessionRef,
          limit: 20,
          verificationEvidence: input.lessonVerificationEvidence,
          operationEvidence: input.lessonOperationEvidence,
        });
        result.lessonsExtracted = lessons.length;
      }

      // 4. 将重复出现的 lesson candidate 升格为 knack
      if (this.lessonsManager && this.knacksManager) {
        result.knacksPromoted = await this.tryPromoteLessonsToKnacks(input);
      }

      // 5. 升级判定
      this.boundedBreaker?.resetBudget();
      const promoted = await this.tryPromoteEligible(input.totalTaskCount, input);
      result.promoted = promoted;

      // 6. 清理
      result.cleanupStats = await this.candidatesManager.cleanup();
    } catch (err) {
      console.error(
        '[ReflectAgent] run failed:',
        err instanceof Error ? err.message : String(err),
      );
    }

    return result;
  }

  private async tryPromoteLessonsToKnacks(input: ReflectInput): Promise<number> {
    if (!this.lessonsManager || !this.knacksManager) return 0;

    this.boundedBreaker?.resetBudget();
    const signalKindCounts = new Map<SignalKind, number>();
    const lessons = await this.lessonsManager.getAll();
    for (const lesson of lessons) {
      for (const kind of lesson.trigger.signalKinds) {
        signalKindCounts.set(kind, (signalKindCounts.get(kind) ?? 0) + 1);
      }
    }

    let promotedCount = 0;
    for (const lesson of lessons) {
      if (!this.isLessonEligibleForKnackPromotion(lesson, signalKindCounts)) continue;

      await this.knacksManager.promoteLessonCandidate(lesson, {
        breaker: this.boundedBreaker ?? undefined,
        totalTaskCount: input.totalTaskCount,
      });
      await this.lessonsManager.updateStatus(lesson.id, 'promoted');
      promotedCount++;
    }

    return promotedCount;
  }

  private isLessonEligibleForKnackPromotion(
    lesson: LessonCandidate,
    signalKindCounts: Map<SignalKind, number>,
  ): boolean {
    if (lesson.status !== 'observed' || lesson.quality !== 'high') return false;
    if ((lesson.counterexamples ?? []).some((counterexample) => counterexample.severity === 'high')) {
      return false;
    }
    return lesson.trigger.signalKinds.some((kind) => (signalKindCounts.get(kind) ?? 0) >= 2);
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

      const breakerDecision = this.boundedBreaker
        ? await this.boundedBreaker.evaluate({
          candidate,
          totalTaskCount,
        })
        : null;

      if (breakerDecision?.report) {
        await this.candidatesManager.recordBreakerReport(candidate.id, breakerDecision.report);
        if (this.breakerLogManager) {
          try {
            await this.breakerLogManager.append({
              task_id: input.taskId,
              candidate_id: candidate.id,
              report: breakerDecision.report,
            });
          } catch (err) {
            logger.warn(
              '[ReflectAgent] breaker log append failed:',
              err instanceof Error ? err.message : String(err),
            );
          }
        }
      }

      const promotionDecision = this.candidatesManager.decidePromotion(
        candidate,
        totalTaskCount,
        breakerDecision?.report ?? null,
      );

      if (promotionDecision.action === 'reject') {
        continue;
      }

      if (promotionDecision.action === 'pending_user_confirmation') {
        await this.candidatesManager.markPendingUserConfirmation(candidate.id);
        continue;
      }

      await this.preferencesManager.promoteFromCandidate({
        rule: candidate.pattern,
        scope: candidate.scope,
        provenance: {
          source_type: 'reflect-agent',
          task_id: input.taskId,
          session_ref: input.sessionRef,
          created_at: new Date().toISOString(),
          breaker_report_id: breakerDecision?.report?.id,
        },
        applyCaution: promotionDecision.applyCaution,
      });

      await this.candidatesManager.markPromoted(candidate.id);
      promoted.push(candidate.id);
    }

    return promoted;
  }
}
