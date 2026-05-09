import type { CandidateBreakerReport } from '../candidates/types.js';

export type DesignExtractorMode = 'auto' | 'native' | 'dembrandt';
export type DesignTrustStatus = 'unverified' | 're-observed' | 'user-confirmed' | 'contested';
export type DesignCandidateStatus = 'observed' | 'pending_user_confirmation' | 'promoted' | 'archived';
export type DesignSourceType =
  | 'playwright-design-study'
  | 'dembrandt-design-study'
  | 'playwright-visual-critic'
  | 'user-confirmed'
  | 're-observed';

export type DesignSampleRole =
  | 'button'
  | 'card'
  | 'input'
  | 'tag'
  | 'heading'
  | 'body'
  | 'background'
  | 'unknown';

export type DesignViewport = 'desktop' | 'mobile';

export interface DesignProvenance {
  source_type: DesignSourceType;
  task_id: string;
  session_ref: string;
  created_at: string;
  trust_status: DesignTrustStatus;
}

export interface DesignColorTokens {
  ink?: string;
  background: string[];
  text: string[];
  accent: string[];
}

export interface DesignBorderTokens {
  default?: string;
  strong?: string;
}

export interface DesignTokens {
  colors: DesignColorTokens;
  border: DesignBorderTokens;
  shadow: string[];
  radius: string[];
  fontWeight: {
    heading?: number;
    body?: number;
    button?: number;
  };
}

export interface DesignBoxSample {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComputedStyleSample {
  color?: string;
  backgroundColor?: string;
  border?: string;
  borderRadius?: string;
  boxShadow?: string;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  lineHeight?: string;
  padding?: string;
  margin?: string;
  gap?: string;
  display?: string;
}

export interface DesignStyleSample {
  role: DesignSampleRole;
  selector: string;
  viewport: DesignViewport;
  text?: string;
  box?: DesignBoxSample;
  styles: ComputedStyleSample;
}

export interface DesignScreenshotRef {
  viewport: DesignViewport;
  path?: string;
  dataUrl?: string;
  width: number;
  height: number;
}

export interface DesignCandidate {
  id: string;
  name: string;
  source_urls: string[];
  screenshots: DesignScreenshotRef[];
  samples: DesignStyleSample[];
  tokens: DesignTokens;
  component_patterns: Record<string, string>;
  anti_patterns: string[];
  observations: number;
  first_observed: string;
  last_observed: string;
  status: DesignCandidateStatus;
  breaker_report: CandidateBreakerReport | null;
  provenance: DesignProvenance[];
}

export interface StyleProfile {
  id: string;
  candidate_id: string;
  name: string;
  mood: string[];
  source_urls: string[];
  tokens: DesignTokens;
  component_patterns: Record<string, string>;
  anti_patterns: string[];
  created_at: string;
  updated_at: string;
  provenance: DesignProvenance;
}

export interface DesignScoreBreakdown {
  color_match: number;
  border_shadow_match: number;
  typography_match: number;
  component_consistency: number;
  layout_density: number;
  mobile_stability: number;
}

export interface DesignCritique {
  id: string;
  task_id: string;
  profile_id: string;
  url: string;
  score: number;
  scores: DesignScoreBreakdown;
  failures: string[];
  revision_required: boolean;
  screenshot_refs: DesignScreenshotRef[];
  created_at: string;
  provenance: DesignProvenance;
}

export interface DesignCandidatesFile {
  candidates: DesignCandidate[];
}

export interface DesignCritiquesFile {
  critiques: DesignCritique[];
}

export interface DesignActiveProfileFile {
  profile_id: string | null;
  local_url?: string;
  updated_at: string;
}

export interface DesignExtractionResult {
  name: string;
  sourceUrls: string[];
  screenshots: DesignScreenshotRef[];
  samples: DesignStyleSample[];
  tokens: DesignTokens;
  componentPatterns: Record<string, string>;
  antiPatterns: string[];
  provenanceSource: Extract<DesignSourceType, 'playwright-design-study' | 'dembrandt-design-study'>;
}

export const EMPTY_DESIGN_TOKENS: DesignTokens = {
  colors: {
    background: [],
    text: [],
    accent: [],
  },
  border: {},
  shadow: [],
  radius: [],
  fontWeight: {},
};
