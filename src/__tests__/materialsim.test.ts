import { describe, it, expect } from 'vitest';
import { buildStock, buildHeadpieceStock, carve, gridToGeometry } from '../renderer/MaterialSim';
import type { BlowholeStock, HeadpieceStock, MachineState, MotionSegment } from '../types';

const stock: BlowholeStock = { name: 't', outerR: 7, innerR: 4, xDim: 4, yDim: 4 };
const res = 0.25;

// Material = signed-distance field below zero.
function countSolid(g: { field: Float32Array }) {
  let n = 0;
  for (const v of g.field) if (v < 0) n++;
  return n;
}
const solidAtIdx = (g: { field: Float32Array }, i: number) => g.field[i] < 0 ? 1 : 0;

const ms = (z: number): MachineState => ({ x: 0, y: 0, z, a: 0, f: 600, isAbsolute: true });

describe('MaterialSim', () => {
  it('builds a tube wall: only innerR..outerR is solid', () => {
    const g = buildStock(stock, -5, 5, res);
    // A voxel on the axis (r=0) is inside the bore → empty.
    const cx = Math.round((0 - g.ox) / res);
    const cyz = Math.round((0 - g.oy) / res);
    expect(solidAtIdx(g, cx + g.nx * (cyz + g.ny * cyz))).toBe(0);
    // Some wall material exists.
    expect(countSolid(g)).toBeGreaterThan(0);
  });

  it('carves material and breaks through the wall to the bore', () => {
    const g = buildStock(stock, -5, 5, res);
    const before = countSolid(g);

    // A radial plunge at A=0 from the surface (z=0) through the wall (z=-3).
    const seg: MotionSegment = {
      fromMachine: ms(0), toMachine: ms(-3), isRapid: false, lineIndex: 0,
    };
    carve(g, [seg], 1.0, () => stock.outerR, stock.outerR);

    const after = countSolid(g);
    expect(after).toBeLessThan(before);            // material removed

    // Along the +Z radial ray at axial x=0, the whole wall is gone → open hole.
    const ix = Math.round((0 - g.ox) / res);
    const iy = Math.round((0 - g.oy) / res);
    let anySolid = false;
    for (let r = stock.innerR + 0.3; r <= stock.outerR - 0.3; r += res) {
      const iz = Math.round((r - g.oz) / res);
      if (solidAtIdx(g, ix + g.nx * (iy + g.ny * iz))) { anySolid = true; break; }
    }
    expect(anySolid).toBe(false);
  });

  it('rapids do not remove material', () => {
    const g = buildStock(stock, -5, 5, res);
    const before = countSolid(g);
    const seg: MotionSegment = {
      fromMachine: ms(0), toMachine: ms(-3), isRapid: true, lineIndex: 0,
    };
    carve(g, [seg], 1.0, () => stock.outerR, stock.outerR);
    expect(countSolid(g)).toBe(before);
  });

  it('meshes the carved grid into a non-empty geometry', () => {
    const g = buildStock(stock, -5, 5, res);
    carve(g, [{ fromMachine: ms(0), toMachine: ms(-3), isRapid: false, lineIndex: 0 }],
      1.0, () => stock.outerR, stock.outerR);
    const geo = gridToGeometry(g);
    expect(geo.getAttribute('position').count).toBeGreaterThan(0);
    expect(geo.index!.count).toBeGreaterThan(0);
  });

  // The end mill has a FLAT bottom: turning down to a tip radius must leave the
  // surface AT that radius, not a tool-radius deeper (the bug that over-turned
  // the headpiece cone). Full A-rotation at X=0, Z=-2 → surface should be at
  // blankR-2, i.e. radius 5 for a blankR-7 stock.
  it('flat end mill turns to the tip radius, not toolR deeper', () => {
    const g = buildStock(stock, -3, 3, res);   // outerR 7, innerR 4
    const turn: MotionSegment[] = [{
      fromMachine: { x: 0, y: 0, z: -2, a: 0, f: 600, isAbsolute: true },
      toMachine:   { x: 0, y: 0, z: -2, a: 360, f: 600, isAbsolute: true },
      isRapid: false, lineIndex: 0,
    }];
    carve(g, turn, 1.0, () => stock.outerR, stock.outerR);
    const solidR = (ang: number) => {
      for (let r = 7; r > 1; r -= res) {
        const iy = Math.round((r * Math.sin(ang) - g.oy) / res);
        const iz = Math.round((r * Math.cos(ang) - g.oz) / res);
        const ix = Math.round((0 - g.ox) / res);
        if (g.field[ix + g.nx * (iy + g.ny * iz)] < 0) return r;
      }
      return 0;
    };
    // Turned surface at radius ~5 (=7−2), NOT ~4 (=5−toolR).
    expect(solidR(0)).toBeGreaterThan(4.6);
    expect(solidR(0)).toBeLessThan(5.4);
    expect(solidR(Math.PI / 2)).toBeGreaterThan(4.6);
  });
});

describe('buildHeadpieceStock', () => {
  const hp: HeadpieceStock = {
    name: 'h', blankR: 10, boreR: 4, crownR: 6, lowerR: 7,
    headLength: 100, crownRingWidth: 5, lowerRingWidth: 8,
  };
  const r = 0.5;
  const outerAt = (g: { field: Float32Array; nx: number; ny: number; nz: number; ox: number; oy: number; oz: number; res: number }, wx: number) => {
    const ix = Math.round((wx - g.ox) / g.res);
    const iyc = Math.round((0 - g.oy) / g.res);
    for (let rr = 11; rr > 1; rr -= g.res) {
      const iz = Math.round((rr - g.oz) / g.res);
      if (g.field[ix + g.nx * (iyc + g.ny * iz)] < 0) return rr;
    }
    return 0;
  };

  it('builds the stepped profile: crown ring | blank | lower ring', () => {
    const g = buildHeadpieceStock(hp, -104, 0, r);
    // Scanning down in res steps lands within one voxel below the true radius.
    const near = (got: number, want: number) => { expect(got).toBeGreaterThan(want - 0.6); expect(got).toBeLessThan(want + 0.2); };
    near(outerAt(g, -2), 6);      // t=2  → crown ring
    near(outerAt(g, -50), 10);    // t=50 → blank
    near(outerAt(g, -98), 7);     // t=98 → lower ring
  });

  it('leaves the central bore hollow', () => {
    const g = buildHeadpieceStock(hp, -104, 0, r);
    const ix = Math.round((-50 - g.ox) / r);
    const iyc = Math.round((0 - g.oy) / r);
    const izc = Math.round((0 - g.oz) / r);
    expect(g.field[ix + g.nx * (iyc + g.ny * izc)]).toBeGreaterThan(0); // axis = air
  });
});
