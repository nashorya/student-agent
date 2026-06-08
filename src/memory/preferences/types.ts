/**
 * preferences.md 类型定义
 * 存储用户偏好规则，支持显式（用户指令）和隐式（Reflect Agent 升级）两个写入通道。
 */

import type { RecallMetadata } from '../recall/types.js';

export type PreferenceScope =
  | 'code-style'
  | 'control-flow'
  | 'architecture'
  | 'security'
  | 'tool-preference'
  | 'communication';

export type PreferenceSourceType =
  | 'user-explicit'      // 用户直接指令
  | 'reflect-agent'      // Reflect Agent 隐式提取后升级
  | 'bounded-breaker';   // 预留：Breaker 审计来源标记

export interface PreferenceProvenance {
  source_type: PreferenceSourceType;
  task_id: string;
  session_ref: string;
  created_at: string;
  /** 仅 bounded-breaker 来源时存在 */
  breaker_report_id?: string;
}

export interface PreferenceEntry {
  id: string;
  rule: string;
  scope: PreferenceScope;
  recall: RecallMetadata;
  provenance: PreferenceProvenance;
  /** APPLY_WITH_CAUTION 标记（Breaker confidence: moderate 时设置） */
  apply_caution?: boolean;
}

export interface PreferencesFileHeader {
  version: number;
  last_updated: string;
  change: string;
}

export interface PreferencesFile {
  header: PreferencesFileHeader;
  preferences: PreferenceEntry[];
}
