/**
 * preference-candidates.json 类型定义
 * 偏好候选池：存储 Reflect Agent 观察到的行为模式，经过信任状态流转后可升级为正式偏好。
 */

import type { PreferenceScope } from '../preferences/types.js';

export type CandidateStatus =
  | 'observed'
  | 'pending_user_confirmation'
  | 'promoted'
  | 'archived';

export type CandidateTrustStatus =
  | 'unverified'
  | 're-observed'
  | 'user-confirmed'
  | 'contested';

export interface CandidateProvenance {
  source_type: 'reflect-agent' | 'user-confirmed' | 're-observed';
  task_id: string;
  session_ref: string;
  trust_status: CandidateTrustStatus;
}

export interface PreferenceCandidate {
  id: string;
  /** 观察到的行为模式描述 */
  pattern: string;
  scope: PreferenceScope;
  /** 独立观察次数 */
  observations: number;
  first_observed: string;
  last_observed: string;
  /** 矛盾观察次数 */
  contradictions: number;
  status: CandidateStatus;
  /** 触发上下文描述 */
  trigger_context: string;
  /** Bounded Breaker 报告（阶段三填充） */
  breaker_report: CandidateBreakerReport | null;
  provenance: CandidateProvenance[];
}

export type BreakerConfidenceLevel = 'high' | 'moderate' | 'low';

export interface CandidateBreakerReport {
  id: string;
  confidence_level: BreakerConfidenceLevel;
  breakers_applied: string[];
  known_failure_context: string[];
  unknown_risk_zones: string[];
  recommendation: 'promote' | 'promote_with_caution' | 'reject';
  created_at: string;
}

export interface CandidatePromotionDecision {
  action: 'promote' | 'promote_with_caution' | 'pending_user_confirmation' | 'reject';
  reason: string;
  applyCaution: boolean;
}

export interface CandidatesFile {
  candidates: PreferenceCandidate[];
}

// ── 升级阈值配置 ──────────────────────────────────

/** 各 scope 的升级阈值（观察次数 ≥ 阈值才可升级） */
export const UPGRADE_THRESHOLDS: Record<PreferenceScope, number> = {
  'code-style': 2,
  'control-flow': 2,
  'tool-preference': 2,
  'communication': 2,
  'architecture': 3,
  'security': 3,
};

/** 冷启动保护：任务总数低于此值时统一提升阈值 */
export const COLD_START_TASK_THRESHOLD = 20;

/** 冷启动期间的统一最低观察阈值 */
export const COLD_START_OVERRIDE_MIN_OBS = 4;

// ── 清理策略常量 ──────────────────────────────────

/** contradictions ≥ observations 时直接丢弃 */
export const DISCARD_WHEN_CONTRADICTIONS_GTE_OBS = true;

/** 超过此天数无新观察且未升级 → archived */
export const ARCHIVE_AFTER_DAYS = 60;

/** archived 超过此天数 → 删除 */
export const DELETE_ARCHIVED_AFTER_DAYS = 30;

export { type PreferenceScope } from '../preferences/types.js';
