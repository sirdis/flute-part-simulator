import { describe, it, expect } from 'vitest';
import { WorkpieceObject, computeFluteLayout } from '../renderer/Workpiece';
import type { FlutePartGeometry } from '../types';

// WorkpieceObject.radiusAt() is a pure interpolation — no WebGL needed.

const makeWP = () => new WorkpieceObject({
  diamTop: 30,      // radius 15 at upper end  (xOrigin + length)
  diamBottom: 20,   // radius 10 at lower end  (xOrigin)
  length: 100,
  xOrigin: 50,      // lower end at world X = 50
});

describe('WorkpieceObject.radiusAt', () => {
  it('returns diamBottom/2 at xOrigin (lower end)', () => {
    expect(makeWP().radiusAt(50)).toBeCloseTo(10);
  });

  it('returns diamTop/2 at xOrigin+length (upper end)', () => {
    expect(makeWP().radiusAt(150)).toBeCloseTo(15);
  });

  it('interpolates linearly at midpoint', () => {
    expect(makeWP().radiusAt(100)).toBeCloseTo(12.5);
  });

  it('clamps to lower-end radius below xOrigin', () => {
    expect(makeWP().radiusAt(0)).toBeCloseTo(10);
    expect(makeWP().radiusAt(-999)).toBeCloseTo(10);
  });

  it('clamps to upper-end radius above xOrigin+length', () => {
    expect(makeWP().radiusAt(200)).toBeCloseTo(15);
    expect(makeWP().radiusAt(9999)).toBeCloseTo(15);
  });

  it('updates after setParams', () => {
    const wp = makeWP();
    wp.setParams({ diamTop: 40 }); // upper radius now 20
    expect(wp.radiusAt(150)).toBeCloseTo(20);
    expect(wp.radiusAt(50)).toBeCloseTo(10); // lower unchanged
  });
});

describe('computeFluteLayout', () => {
  // rh-part from 0018-flute-holes.yaml — the part where the "e" hole was wrongly
  // shown sitting on the lower tenon. xOffset = bore zero = G-code Y max = 0.
  const rhPart: FlutePartGeometry = {
    name: 'rh-part',
    boreLen: 113.35,
    radiusAtZero: 26.54 / 2,
    radiusAtEnd: 25.06 / 2,
    tenonAtLowerEnd: { length: 16.81, radius: 18.72 / 2 },
    holes: [],
  };

  it('spans the full bore length — tenon is NOT subtracted from the body', () => {
    const l = computeFluteLayout(rhPart, 0);
    expect(l.bodyUpperX).toBeCloseTo(0);
    expect(l.bodyLowerX).toBeCloseTo(-113.35);   // full boreLen, not 113.35 − 16.81
    expect(l.rLower).toBeCloseTo(25.06 / 2);
    expect(l.rUpper).toBeCloseTo(26.54 / 2);
  });

  it('places the lower tenon BEYOND the bore end, below the body', () => {
    const l = computeFluteLayout(rhPart, 0);
    expect(l.lowerTenon).toBeDefined();
    expect(l.lowerTenon!.upperX).toBeCloseTo(-113.35);
    expect(l.lowerTenon!.lowerX).toBeCloseTo(-113.35 - 16.81);
  });

  it('keeps the "e" hole (centerY −102.13) on the body, off the tenon', () => {
    const l = computeFluteLayout(rhPart, 0);
    const eHoleX = 0 + -102.13;   // xOffset + centerY
    // On the body …
    expect(eHoleX).toBeLessThanOrEqual(l.bodyUpperX);
    expect(eHoleX).toBeGreaterThanOrEqual(l.bodyLowerX);
    // … and NOT inside the lower-tenon span.
    expect(eHoleX).toBeGreaterThan(l.lowerTenon!.upperX);
  });

  it('places the upper tenon above bore zero when present', () => {
    const l = computeFluteLayout({ ...rhPart, tenonAtZero: { length: 26.21, radius: 23.48 / 2 } }, 0);
    expect(l.upperTenon!.lowerX).toBeCloseTo(0);
    expect(l.upperTenon!.upperX).toBeCloseTo(26.21);
  });
});
