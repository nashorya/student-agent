import { describe, expect, it } from 'vitest';
import {
  LAYOUT_ACCEPTANCE_WIDTHS,
  cycleCompactOverlay,
  describeLayoutRegions,
  isWide,
  rightRailBasis,
  WIDE_BREAKPOINT,
} from '../layout.js';

describe('layout helpers', () => {
  it('isWide uses WIDE_BREAKPOINT', () => {
    expect(WIDE_BREAKPOINT).toBe(120);
    expect(isWide(119)).toBe(false);
    expect(isWide(120)).toBe(true);
  });

  it('describeLayoutRegions includes header and separates sidebar in wide mode', () => {
    expect(describeLayoutRegions(80)).toEqual([
      'header',
      'transcript',
      'composer',
      'status',
    ]);
    expect(describeLayoutRegions(100, 'plan')).toEqual([
      'header',
      'transcript',
      'overlay',
      'composer',
      'status',
    ]);
    expect(describeLayoutRegions(140)).toEqual([
      'header',
      'transcript',
      'plan',
      'agents',
      'composer',
      'status',
    ]);
  });

  it('acceptance widths keep workspace chrome regions', () => {
    for (const width of LAYOUT_ACCEPTANCE_WIDTHS) {
      const regions = describeLayoutRegions(width, width < WIDE_BREAKPOINT ? 'memory' : 'none');
      expect(regions).toContain('header');
      expect(regions).toContain('transcript');
      expect(regions).toContain('composer');
      expect(regions).toContain('status');
      if (width >= WIDE_BREAKPOINT) {
        expect(regions).toContain('plan');
        expect(regions).toContain('agents');
      } else {
        expect(regions).toContain('overlay');
      }
    }
  });

  it('rightRailBasis stays in a sensible band', () => {
    expect(rightRailBasis(120)).toBeGreaterThanOrEqual(28);
    expect(rightRailBasis(120)).toBeLessThanOrEqual(42);
  });

  it('cycles compact overlay plan → agents → memory → none', () => {
    expect(cycleCompactOverlay('none')).toBe('plan');
    expect(cycleCompactOverlay('plan')).toBe('agents');
    expect(cycleCompactOverlay('agents')).toBe('memory');
    expect(cycleCompactOverlay('memory')).toBe('none');
  });
});
