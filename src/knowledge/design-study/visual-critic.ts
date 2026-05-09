import { randomUUID } from 'node:crypto';
import type {
  DesignCritique,
  DesignExtractionResult,
  DesignSampleRole,
  DesignScoreBreakdown,
  DesignTokens,
  StyleProfile,
} from '../../memory/design/types.js';
import type { DesignExtractionOptions, DesignExtractor, VisualCriticLike, VisualCriticRequest } from './types.js';

export interface VisualCriticOptions {
  extractor: DesignExtractor;
  threshold?: number;
}

const DEFAULT_THRESHOLD = 0.8;
const SUPPORTED_PATTERN_ROLES = new Set<DesignSampleRole>([
  'button',
  'card',
  'input',
  'tag',
  'heading',
  'body',
  'background',
  'unknown',
]);

export class VisualCritic implements VisualCriticLike {
  private readonly extractor: DesignExtractor;
  private readonly threshold: number;

  constructor(options: VisualCriticOptions) {
    this.extractor = options.extractor;
    this.threshold = options.threshold ?? DEFAULT_THRESHOLD;
  }

  async critique(request: VisualCriticRequest, options: DesignExtractionOptions = {}): Promise<DesignCritique> {
    const extraction = await this.extractor.extract({
      url: request.url,
      name: request.profile.name,
    }, options);
    const scores = scoreProfileMatch(request.profile, extraction);
    const score = average(Object.values(scores));
    const failures = collectFailures(scores, this.threshold);
    const now = new Date().toISOString();
    return {
      id: `design_critique_${randomUUID()}`,
      task_id: request.taskId,
      profile_id: request.profile.id,
      url: request.url,
      score,
      scores,
      failures,
      revision_required: score < this.threshold,
      screenshot_refs: extraction.screenshots,
      created_at: now,
      provenance: {
        source_type: 'playwright-visual-critic',
        task_id: request.taskId,
        session_ref: request.sessionRef,
        created_at: now,
        trust_status: 'unverified',
      },
    };
  }
}

export function scoreProfileMatch(
  profile: StyleProfile,
  extraction: DesignExtractionResult,
): DesignScoreBreakdown {
  return {
    color_match: tokenOverlap(profile.tokens.colors.accent.concat(profile.tokens.colors.text), extraction.tokens.colors.accent.concat(extraction.tokens.colors.text)),
    border_shadow_match: average([
      tokenOverlap(borderTokens(profile.tokens), borderTokens(extraction.tokens)),
      tokenOverlap(profile.tokens.shadow, extraction.tokens.shadow),
      tokenOverlap(profile.tokens.radius, extraction.tokens.radius),
    ]),
    typography_match: typographyScore(profile.tokens, extraction.tokens),
    component_consistency: componentScore(profile, extraction),
    layout_density: densityScore(profile, extraction),
    mobile_stability: mobileStabilityScore(extraction),
  };
}

function collectFailures(scores: DesignScoreBreakdown, threshold: number): string[] {
  const labels: Record<keyof DesignScoreBreakdown, string> = {
    color_match: 'color tokens diverge from active StyleProfile',
    border_shadow_match: 'borders, radius, or shadows do not match active StyleProfile',
    typography_match: 'font weights do not match active StyleProfile',
    component_consistency: 'expected component patterns are missing or inconsistent',
    layout_density: 'layout density differs from reference profile',
    mobile_stability: 'mobile viewport samples are missing or unstable',
  };
  return Object.entries(scores)
    .filter(([, value]) => value < threshold)
    .map(([key]) => labels[key as keyof DesignScoreBreakdown]);
}

function typographyScore(profile: DesignTokens, extraction: DesignTokens): number {
  const expected = Object.entries(profile.fontWeight);
  if (expected.length === 0) return 1;
  const matches = expected.filter(([key, value]) =>
    extraction.fontWeight[key as keyof DesignTokens['fontWeight']] === value,
  ).length;
  return matches / expected.length;
}

function componentScore(profile: StyleProfile, extraction: DesignExtractionResult): number {
  const expected = observablePatternRoles(profile);
  if (expected.length === 0) return 1;
  const observedRoles = new Set(extraction.samples.map((sample) => sample.role));
  const matches = expected.filter((role) => observedRoles.has(role));
  return matches.length / expected.length;
}

function densityScore(profile: StyleProfile, extraction: DesignExtractionResult): number {
  const expected = observablePatternRoles(profile).length;
  if (expected === 0) return 1;
  const observed = new Set(extraction.samples.map((sample) => sample.role)).size;
  return Math.min(observed / Math.max(expected, 1), 1);
}

function observablePatternRoles(profile: StyleProfile): DesignSampleRole[] {
  return Object.keys(profile.component_patterns)
    .filter((role): role is DesignSampleRole => SUPPORTED_PATTERN_ROLES.has(role as DesignSampleRole));
}

function mobileStabilityScore(extraction: DesignExtractionResult): number {
  const mobileSamples = extraction.samples.filter((sample) => sample.viewport === 'mobile');
  if (mobileSamples.length === 0) return 0;
  const stable = mobileSamples.filter((sample) =>
    !sample.box || (sample.box.width > 0 && sample.box.height > 0 && sample.box.x > -20),
  ).length;
  return stable / mobileSamples.length;
}

function borderTokens(tokens: DesignTokens): string[] {
  return [tokens.border.default, tokens.border.strong].filter((value): value is string => Boolean(value));
}

function tokenOverlap(expected: string[], observed: string[]): number {
  const left = new Set(expected.map(normalizeToken).filter(Boolean));
  if (left.size === 0) return 1;
  const right = new Set(observed.map(normalizeToken).filter(Boolean));
  const matches = [...left].filter((value) => right.has(value)).length;
  return matches / left.size;
}

function normalizeToken(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (!normalized) return '';
  return normalized
    .replace(/#[0-9a-f]{3,8}|rgba?\([^)]+\)/gi, (color) => normalizeColor(color))
    .replace(/\s+/g, ' ');
}

function average(values: number[]): number {
  if (values.length === 0) return 1;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeColor(color: string): string {
  const trimmed = color.trim().toLowerCase();
  const hex = hexToRgb(trimmed);
  if (hex) return `rgb(${hex.r}, ${hex.g}, ${hex.b})`;

  const rgb = trimmed.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (!rgb) return trimmed;
  const alpha = rgb[4] === undefined ? undefined : Number.parseFloat(rgb[4]);
  if (alpha !== undefined && alpha <= 0) return 'transparent';
  return `rgb(${Math.round(Number(rgb[1]))}, ${Math.round(Number(rgb[2]))}, ${Math.round(Number(rgb[3]))})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!hex.startsWith('#')) return null;
  const raw = hex.slice(1);
  if (raw.length === 3 || raw.length === 4) {
    return {
      r: Number.parseInt(raw[0] + raw[0], 16),
      g: Number.parseInt(raw[1] + raw[1], 16),
      b: Number.parseInt(raw[2] + raw[2], 16),
    };
  }
  if (raw.length === 6 || raw.length === 8) {
    return {
      r: Number.parseInt(raw.slice(0, 2), 16),
      g: Number.parseInt(raw.slice(2, 4), 16),
      b: Number.parseInt(raw.slice(4, 6), 16),
    };
  }
  return null;
}
