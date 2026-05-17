import { describe, it, expect } from 'vitest';
import { WorkpieceObject } from '../renderer/Workpiece';

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
