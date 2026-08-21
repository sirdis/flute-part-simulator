import { describe, it, expect } from 'vitest';
import { buildStock, carve, gridToGeometry } from '../renderer/MaterialSim';
import type { BlowholeStock, MachineState, MotionSegment } from '../types';

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
});
