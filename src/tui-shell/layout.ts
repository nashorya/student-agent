/** Columns at/above this use the wide two-column workbench layout. */
export const WIDE_BREAKPOINT = 120;

export function isWide(columns: number): boolean {
  return columns >= WIDE_BREAKPOINT;
}

export type LayoutRegion =
  | 'transcript'
  | 'plan'
  | 'agents'
  | 'overlay'
  | 'composer'
  | 'status';

export type CompactOverlayKind = 'none' | 'plan' | 'agents' | 'memory';

/**
 * Pure description of which regions are mounted for a given width / overlay.
 * Compact overlay sits between transcript and composer (not a second input).
 */
export function describeLayoutRegions(
  columns: number,
  overlay: CompactOverlayKind = 'none',
): LayoutRegion[] {
  if (isWide(columns)) {
    return ['transcript', 'plan', 'agents', 'composer', 'status'];
  }
  if (overlay !== 'none') {
    return ['transcript', 'overlay', 'composer', 'status'];
  }
  return ['transcript', 'composer', 'status'];
}

/** Suggested right-rail basis (columns) for Plan/Agents in wide mode. */
export function rightRailBasis(columns: number): number {
  const pct = Math.floor(columns * 0.3);
  return Math.min(42, Math.max(28, pct));
}

/** Deterministic layout fixtures for ADR acceptance sizes. */
export const LAYOUT_ACCEPTANCE_WIDTHS = [80, 100, 140, 180] as const;

export function cycleCompactOverlay(current: CompactOverlayKind): CompactOverlayKind {
  if (current === 'none') return 'plan';
  if (current === 'plan') return 'agents';
  if (current === 'agents') return 'memory';
  return 'none';
}
