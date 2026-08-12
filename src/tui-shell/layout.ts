/** Columns at/above this use the wide two-column workbench layout. */
export const WIDE_BREAKPOINT = 120;

export function isWide(columns: number): boolean {
  return columns >= WIDE_BREAKPOINT;
}

export type LayoutRegion = 'transcript' | 'plan' | 'agents' | 'composer' | 'status';

/** Pure description of which regions are mounted for a given width. */
export function describeLayoutRegions(columns: number): LayoutRegion[] {
  if (isWide(columns)) {
    return ['transcript', 'plan', 'agents', 'composer', 'status'];
  }
  return ['transcript', 'composer', 'status'];
}

/** Suggested right-rail basis (columns) for Plan/Agents in wide mode. */
export function rightRailBasis(columns: number): number {
  const pct = Math.floor(columns * 0.3);
  return Math.min(42, Math.max(28, pct));
}
