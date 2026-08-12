import { describe, expect, it } from 'vitest';
import {
  WIDE_BREAKPOINT,
  describeLayoutRegions,
  isWide,
  rightRailBasis,
} from '../layout.js';

describe('layout helpers', () => {
  it('isWide uses WIDE_BREAKPOINT', () => {
    expect(WIDE_BREAKPOINT).toBe(120);
    expect(isWide(119)).toBe(false);
    expect(isWide(120)).toBe(true);
    expect(isWide(180)).toBe(true);
  });

  it('describeLayoutRegions omits plan/agents in compact', () => {
    expect(describeLayoutRegions(80)).toEqual(['transcript', 'composer', 'status']);
    expect(describeLayoutRegions(140)).toEqual([
      'transcript',
      'plan',
      'agents',
      'composer',
      'status',
    ]);
  });

  it('rightRailBasis stays in a sensible band', () => {
    expect(rightRailBasis(120)).toBeGreaterThanOrEqual(28);
    expect(rightRailBasis(120)).toBeLessThanOrEqual(42);
    expect(rightRailBasis(200)).toBeLessThanOrEqual(42);
  });
});
