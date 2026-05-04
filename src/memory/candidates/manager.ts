import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { WriteQueue } from '../../core/write-queue.js';
import type {
  CandidateBreakerReport,
  CandidatePromotionDecision,
  CandidatesFile,
  CandidateTrustStatus,
  PreferenceCandidate,
  PreferenceScope,
} from './types.js';
import {
  UPGRADE_THRESHOLDS,
  COLD_START_TASK_THRESHOLD,
  COLD_START_OVERRIDE_MIN_OBS,
  ARCHIVE_AFTER_DAYS,
  DELETE_ARCHIVED_AFTER_DAYS,
} from './types.js';

/**
 * PreferenceCandidatesManager — preference-candidates.json 的唯一读写入口。
 *
 * 管理偏好候选池：
 *   observe()            — 新增/更新观察
 *   recordContradiction() — 记录矛盾
 *   checkUpgradeEligibility() — 判断是否可升级（含冷启动保护）
 *   cleanup()            — 清理过期条目
 *
 * 所有写入通过 WriteQueue 串行化（读-改-写原子）。
 */
export class PreferenceCandidatesManager {
  private static instance: PreferenceCandidatesManager | null = null;
  private readonly filePath: string;

  private constructor(memoryDir: string) {
    this.filePath = join(memoryDir, 'preference-candidates.json');
  }

  static getInstance(memoryDir?: string): PreferenceCandidatesManager {
    const dir = memoryDir ?? `${process.cwd()}/memory`;
    if (!PreferenceCandidatesManager.instance) {
      PreferenceCandidatesManager.instance = new PreferenceCandidatesManager(dir);
    }
    return PreferenceCandidatesManager.instance;
  }

  /** 仅测试用 */
  static resetInstance(): void {
    PreferenceCandidatesManager.instance = null;
  }

  // ── 读取 ──────────────────────────────────────────

  async getAll(): Promise<PreferenceCandidate[]> {
    const file = await this.readFile();
    return file ? file.candidates : [];
  }

  /** 根据 pattern 文本精确查找 */
  async findByPattern(pattern: string): Promise<PreferenceCandidate | null> {
    const all = await this.getAll();
    return all.find((c) => c.pattern === pattern) ?? null;
  }

  /** 根据 id 查找 */
  async findById(id: string): Promise<PreferenceCandidate | null> {
    const all = await this.getAll();
    return all.find((c) => c.id === id) ?? null;
  }

  // ── 新增/更新观察 ────────────────────────────────

  /**
   * 记录一次行为模式观察。
   * 如果已有相同 pattern 的候选，更新观察计数和信任状态。
   * 如果没有，新建候选。
   */
  async observe(params: {
    pattern: string;
    scope: PreferenceScope;
    taskId: string;
    sessionRef: string;
    triggerContext: string;
  }): Promise<void> {
    await WriteQueue.getInstance().enqueue(async () => {
      const file = await this.readFile();
      const candidates = file ? [...file.candidates] : [];
      const now = new Date().toISOString();

      const existingIdx = candidates.findIndex((c) => c.pattern === params.pattern);

      if (existingIdx >= 0) {
        const existing = candidates[existingIdx];
        const updatedObs = existing.observations + 1;
        candidates[existingIdx] = {
          ...existing,
          observations: updatedObs,
          last_observed: now,
          provenance: [
            ...existing.provenance,
            {
              source_type: 'reflect-agent',
              task_id: params.taskId,
              session_ref: params.sessionRef,
              trust_status: this.advanceTrust(existing, updatedObs),
            },
          ],
        };
      } else {
        candidates.push({
          id: `pref_cand_${randomUUID()}`,
          pattern: params.pattern,
          scope: params.scope,
          observations: 1,
          first_observed: now,
          last_observed: now,
          contradictions: 0,
          status: 'observed',
          trigger_context: params.triggerContext,
          breaker_report: null,
          provenance: [
            {
              source_type: 'reflect-agent',
              task_id: params.taskId,
              session_ref: params.sessionRef,
              trust_status: 'unverified',
            },
          ],
        });
      }

      await this.writeRaw(candidates);
    });
  }

  // ── 矛盾记录 ──────────────────────────────────────

  /** 记录一次矛盾观察 */
  async recordContradiction(candidateId: string): Promise<void> {
    await WriteQueue.getInstance().enqueue(async () => {
      const file = await this.readFile();
      if (!file) return;

      const candidates = [...file.candidates];
      const idx = candidates.findIndex((c) => c.id === candidateId);
      if (idx < 0) return;

      candidates[idx] = {
        ...candidates[idx],
        contradictions: candidates[idx].contradictions + 1,
      };

      await this.writeRaw(candidates);
    });
  }

  /** 标记候选已经升级为正式 preference，避免后续重复升级。 */
  async markPromoted(candidateId: string): Promise<void> {
    await WriteQueue.getInstance().enqueue(async () => {
      const file = await this.readFile();
      if (!file) return;

      const candidates = [...file.candidates];
      const idx = candidates.findIndex((c) => c.id === candidateId);
      if (idx < 0) return;

      candidates[idx] = {
        ...candidates[idx],
        status: 'promoted',
      };

      await this.writeRaw(candidates);
    });
  }

  /** 标记候选需要用户确认，避免 architecture 等高影响规则自动写入 preferences。 */
  async markPendingUserConfirmation(candidateId: string): Promise<void> {
    await WriteQueue.getInstance().enqueue(async () => {
      const file = await this.readFile();
      if (!file) return;

      const candidates = [...file.candidates];
      const idx = candidates.findIndex((c) => c.id === candidateId);
      if (idx < 0) return;

      candidates[idx] = {
        ...candidates[idx],
        status: 'pending_user_confirmation',
      };

      await this.writeRaw(candidates);
    });
  }

  /** 记录 Bounded Breaker 报告，供后续审计。 */
  async recordBreakerReport(candidateId: string, report: CandidateBreakerReport): Promise<void> {
    await WriteQueue.getInstance().enqueue(async () => {
      const file = await this.readFile();
      if (!file) return;

      const candidates = [...file.candidates];
      const idx = candidates.findIndex((c) => c.id === candidateId);
      if (idx < 0) return;

      candidates[idx] = {
        ...candidates[idx],
        breaker_report: report,
      };

      await this.writeRaw(candidates);
    });
  }

  // ── 信任状态流转 ──────────────────────────────────

  /**
   * 计算新的信任状态。
   *
   * unverified  →  re-observed（同一模式独立观察 ≥2 次）
   * 任意状态    →  contested（出现矛盾观察时由 recordContradiction 外部处理）
   */
  private advanceTrust(
    candidate: PreferenceCandidate,
    newObsCount: number,
  ): CandidateTrustStatus {
    const currentTrust = candidate.provenance.length > 0
      ? candidate.provenance[candidate.provenance.length - 1].trust_status
      : 'unverified';

    // 已经是 user-confirmed，不降级
    if (currentTrust === 'user-confirmed') return 'user-confirmed';

    // contested 状态保持
    if (currentTrust === 'contested') return 'contested';

    // unverified → re-observed（观察 ≥2 次）
    if (currentTrust === 'unverified' && newObsCount >= 2) return 're-observed';

    return currentTrust;
  }

  // ── 升级判定 ──────────────────────────────────────

  /**
   * 检查候选是否满足升级到 preferences.md 的条件。
   * 考虑冷启动保护和 scope 特殊规则。
   */
  checkUpgradeEligibility(
    candidate: PreferenceCandidate,
    totalTaskCount: number,
  ): { eligible: boolean; reason: string } {
    if (candidate.status !== 'observed') {
      return { eligible: false, reason: `候选状态为 ${candidate.status}，不可升级` };
    }

    // contested 不可升级
    const latestTrust = candidate.provenance.length > 0
      ? candidate.provenance[candidate.provenance.length - 1].trust_status
      : 'unverified';

    if (latestTrust === 'contested') {
      return { eligible: false, reason: '存在矛盾观察，不可升级' };
    }

    // 冷启动保护：任务数 < 20 时统一提升阈值
    const threshold = totalTaskCount < COLD_START_TASK_THRESHOLD
      ? Math.max(UPGRADE_THRESHOLDS[candidate.scope], COLD_START_OVERRIDE_MIN_OBS)
      : UPGRADE_THRESHOLDS[candidate.scope];

    if (candidate.observations < threshold) {
      return {
        eligible: false,
        reason: `观察次数 ${candidate.observations} 未达阈值 ${threshold}（冷启动保护：${totalTaskCount < COLD_START_TASK_THRESHOLD ? '是' : '否'}）`,
      };
    }

    // architecture/security scope 特殊规则：必须 re-observed 以上
    if (candidate.scope === 'architecture' || candidate.scope === 'security') {
      if (latestTrust !== 're-observed' && latestTrust !== 'user-confirmed') {
        return {
          eligible: false,
          reason: `${candidate.scope} scope 需要 trust ≥ re-observed 才可升级`,
        };
      }
    }

    return { eligible: true, reason: '满足升级条件' };
  }

  /**
   * 信任状态机的最终 promotion decision。
   * Breaker report 只能影响审计和 caution 标记，不能绕过候选资格和高影响 scope 拦截。
   */
  decidePromotion(
    candidate: PreferenceCandidate,
    totalTaskCount: number,
    breakerReport: CandidateBreakerReport | null,
  ): CandidatePromotionDecision {
    const eligibility = this.checkUpgradeEligibility(candidate, totalTaskCount);
    if (!eligibility.eligible) {
      return {
        action: 'reject',
        reason: eligibility.reason,
        applyCaution: false,
      };
    }

    if (requiresUserConfirmation(candidate.scope)) {
      return {
        action: 'pending_user_confirmation',
        reason: `${candidate.scope} scope 需要用户确认`,
        applyCaution: false,
      };
    }

    if (breakerReport?.confidence_level === 'moderate') {
      return {
        action: 'promote_with_caution',
        reason: '满足信任状态机升级条件，Breaker 标记为 moderate',
        applyCaution: true,
      };
    }

    return {
      action: 'promote',
      reason: '满足信任状态机升级条件',
      applyCaution: false,
    };
  }

  // ── 清理 ──────────────────────────────────────────

  /**
   * 清理过期条目。
   * 规则：
   *   contradictions ≥ observations → 丢弃
   *   60 天无新观察且未升级 → archived
   *   archived 超过 30 天 → 删除
   */
  async cleanup(): Promise<{ discarded: number; archived: number; deleted: number }> {
    const stats = { discarded: 0, archived: 0, deleted: 0 };

    await WriteQueue.getInstance().enqueue(async () => {
      const file = await this.readFile();
      if (!file || file.candidates.length === 0) return;

      const now = Date.now();
      const surviving: PreferenceCandidate[] = [];

      for (const c of file.candidates) {
        // 规则 1：contradictions ≥ observations → 丢弃
        if (c.contradictions >= c.observations) {
          stats.discarded++;
          continue;
        }

        const lastObsMs = new Date(c.last_observed).getTime();
        const daysSinceLastObs = (now - lastObsMs) / (1000 * 60 * 60 * 24);

        // 规则 3：archived 超过 30 天 → 删除
        if (c.status === 'archived' && daysSinceLastObs > ARCHIVE_AFTER_DAYS + DELETE_ARCHIVED_AFTER_DAYS) {
          stats.deleted++;
          continue;
        }

        // 规则 2：60 天无新观察且未升级 → archived
        if (c.status === 'observed' && daysSinceLastObs > ARCHIVE_AFTER_DAYS) {
          surviving.push({ ...c, status: 'archived' });
          stats.archived++;
          continue;
        }

        surviving.push(c);
      }

      await this.writeRaw(surviving);
    });

    return stats;
  }

  // ── 内部方法 ──────────────────────────────────────

  private async readFile(): Promise<CandidatesFile | null> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as CandidatesFile;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') return null;
      console.error(
        '[CandidatesManager] readFile failed:',
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  }

  private async writeRaw(candidates: PreferenceCandidate[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const file: CandidatesFile = { candidates };
    await writeFile(this.filePath, JSON.stringify(file, null, 2), 'utf-8');
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

function requiresUserConfirmation(scope: PreferenceScope): boolean {
  return scope === 'architecture' || scope === 'security';
}
