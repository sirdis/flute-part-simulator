import * as THREE from 'three';
import type { MotionSegment, BlowholeStock } from '../types';
import { machineToWorld } from './ToolPath';

// ─────────────────────────────────────────────────────────────────────────────
// Material-removal end view for a blowhole stub.
//
// Pipeline (one-shot, triggered by a button — no live playback):
//   1. Build a voxel STOCK: a short tube wall (innerR..outerR) over the axial
//      range of the G-code, plus margin. The bore (r < innerR) is pre-existing
//      and never milled; outside the tube (r > outerR) is air.
//   2. CARVE: walk every feed segment of the G-code, and at densely sampled tool
//      positions subtract a ball of radius toolR from the voxel grid. The dense
//      Z/flank stepping of the (Rundachse) G-code makes the ball union fill the
//      full swept volume, including the A-axis undercut and the bore breakthrough.
//   3. MESH: extract the isosurface with Surface Nets → a THREE.BufferGeometry.
//
// Everything runs in the WORKPIECE-FIXED world frame that ToolPath uses
// (world X = machine Y = tube axis; Y/Z = radial plane), so the carved tool
// positions line up exactly with the displayed tool path.
// ─────────────────────────────────────────────────────────────────────────────

export interface VoxelGrid {
  nx: number; ny: number; nz: number;
  ox: number; oy: number; oz: number;   // world coord of voxel-centre (0,0,0)
  res: number;
  field: Float32Array;                   // signed distance: < 0 = inside material
}

function gridIndex(g: VoxelGrid, ix: number, iy: number, iz: number): number {
  return ix + g.nx * (iy + g.ny * iz);
}

// Build the tube-wall stock covering [xLo, xHi] along the axis, as a SIGNED
// DISTANCE field (negative inside the wall). A distance field — rather than a
// binary 0/1 occupancy — lets Surface Nets place vertices sub-voxel, so the
// smooth outer/inner cylinders come out smooth instead of terraced ("cookie").
export function buildStock(
  stock: BlowholeStock, xLo: number, xHi: number, res: number
): VoxelGrid {
  const rOuter = stock.outerR, rInner = stock.innerR;
  const margin = res * 2;
  const lo = -rOuter - margin, hi = rOuter + margin;

  const nx = Math.max(2, Math.ceil((xHi - xLo) / res) + 1);
  const ny = Math.max(2, Math.ceil((hi - lo) / res) + 1);
  const nz = ny;

  const g: VoxelGrid = {
    nx, ny, nz,
    ox: xLo, oy: lo, oz: lo,
    res,
    field: new Float32Array(nx * ny * nz),
  };

  const xHiRel = (nx - 1) * res;   // axial cap position relative to ox
  for (let iz = 0; iz < nz; iz++) {
    const wz = g.oz + iz * res;
    for (let iy = 0; iy < ny; iy++) {
      const wy = g.oy + iy * res;
      const r = Math.hypot(wy, wz);
      // Wall shell SDF: negative between rInner and rOuter.
      const sdfR = Math.max(r - rOuter, rInner - r);
      const base = gridIndex(g, 0, iy, iz);
      for (let ix = 0; ix < nx; ix++) {
        const wxRel = ix * res;
        // Axial caps: negative inside [0, xHiRel].
        const sdfX = Math.max(-wxRel, wxRel - xHiRel);
        g.field[base + ix] = Math.max(sdfR, sdfX);
      }
    }
  }
  return g;
}

// A sampled tool position: world tip point plus the A angle (radians) at that point.
interface ToolSample { x: number; y: number; z: number; aRad: number; }

// The Rundachse blowhole G-code (GCode::Blowhole) uses the rotary convention
//   workpiece_angle = machine_angle − A
// (the tilted wall sits at machine X = R·sin(baseAngle + alpha) for A = +alpha).
// ToolPath.machineToWorld implements the OPPOSITE sign (+A), which is correct for
// the flute-hole G-code but doubles the undercut angle here (base + 2·alpha),
// turning a clean ±baseAngle oval into a wide asymmetric "peanut". So the blowhole
// carve negates A. This is intentionally local — flute holes and the tool-path
// display keep their (matching) +A convention untouched.
const A_SIGN = -1;

// Interpolate machine state along a segment and return world tool-tip samples.
function sampleSegment(
  seg: MotionSegment, radiusFn: (y: number) => number, stepMM: number
): ToolSample[] {
  const fm = seg.fromMachine, tm = seg.toMachine;
  const from = machineToWorld(fm.x, fm.y, fm.z, A_SIGN * fm.a, radiusFn);
  const to = machineToWorld(tm.x, tm.y, tm.z, A_SIGN * tm.a, radiusFn);
  const DEG = Math.PI / 180;
  const out: ToolSample[] = [];
  const push = (mx: number, my: number, mz: number, aDeg: number) => {
    const p = machineToWorld(mx, my, mz, A_SIGN * aDeg, radiusFn);
    out.push({ x: p.x, y: p.y, z: p.z, aRad: A_SIGN * aDeg * DEG });
  };

  if (seg.arc) {
    // Arc in the machine XY plane at constant A; Z interpolates linearly.
    const cx = fm.x + seg.arc.i, cy = fm.y + seg.arc.j;
    const r = Math.hypot(seg.arc.i, seg.arc.j);
    const a0 = Math.atan2(fm.y - cy, fm.x - cx);
    const a1 = Math.atan2(tm.y - cy, tm.x - cx);
    let d = a1 - a0;
    if (seg.arc.cw && d > 0) d -= 2 * Math.PI;
    if (!seg.arc.cw && d < 0) d += 2 * Math.PI;
    if (d === 0) d = seg.arc.cw ? -2 * Math.PI : 2 * Math.PI;
    const steps = Math.max(2, Math.ceil((Math.abs(d) * r) / stepMM));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const ang = a0 + d * t;
      push(cx + r * Math.cos(ang), cy + r * Math.sin(ang), fm.z + (tm.z - fm.z) * t, fm.a);
    }
    return out;
  }

  // Linear move (with or without A change): interpolate all axes.
  const worldDist = from.distanceTo(to);
  const dA = Math.abs(tm.a - fm.a);
  const steps = Math.max(1, Math.ceil(Math.max(worldDist, (dA / 180) * Math.PI * radiusFn(fm.y)) / stepMM));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    push(
      fm.x + (tm.x - fm.x) * t,
      fm.y + (tm.y - fm.y) * t,
      fm.z + (tm.z - fm.z) * t,
      fm.a + (tm.a - fm.a) * t);
  }
  return out;
}

// Remove the tool SOLID at one sample. The end mill is a cylinder (radius toolR)
// whose axis is radial at angle A: it occupies everything from the tip OUTWARD
// (increasing radius) up to past the outer surface. Stamping only the tip ball
// misses this shank sweep — and with the tool tilted for an undercut the
// un-removed shank leaves a false ridge. We subtract the whole CAPSULE (a
// swept sphere along the shank axis) as a smooth SDF, so no ball-stepping
// scallops or terracing remain on the walls.
//
// The capsule runs from the tip s along d = (0, sinA, cosA) up to where the axis
// leaves the stock (r = outerR + toolR); beyond that it is in open air and
// removes nothing, so the exact end does not matter.
function stampTool(g: VoxelGrid, s: ToolSample, toolR: number, outerR: number) {
  const res = g.res;
  const dy = Math.sin(s.aRad), dz = Math.cos(s.aRad);   // axis dir (x-comp = 0)

  // Length L so the capsule axis reaches r = outerR + toolR:
  //   |P + L d|² = R'²   ⇒   L = −(P·d) + √((P·d)² − (|P|² − R'²))
  const Rp = outerR + toolR;
  const Pd = s.y * dy + s.z * dz;                // P·d (x-component of d is 0)
  const disc = Pd * Pd - (s.y * s.y + s.z * s.z - Rp * Rp);
  const L = disc > 0 ? Math.max(0, -Pd + Math.sqrt(disc)) : 0;

  const qy = s.y + L * dy, qz = s.z + L * dz;    // capsule far end Q
  // AABB of the segment P→Q expanded by toolR.
  const ix0 = Math.max(0, Math.floor((s.x - toolR - g.ox) / res));
  const ix1 = Math.min(g.nx - 1, Math.ceil((s.x + toolR - g.ox) / res));
  const iy0 = Math.max(0, Math.floor((Math.min(s.y, qy) - toolR - g.oy) / res));
  const iy1 = Math.min(g.ny - 1, Math.ceil((Math.max(s.y, qy) + toolR - g.oy) / res));
  const iz0 = Math.max(0, Math.floor((Math.min(s.z, qz) - toolR - g.oz) / res));
  const iz1 = Math.min(g.nz - 1, Math.ceil((Math.max(s.z, qz) + toolR - g.oz) / res));

  for (let iz = iz0; iz <= iz1; iz++) {
    const wz = g.oz + iz * res;
    for (let iy = iy0; iy <= iy1; iy++) {
      const wy = g.oy + iy * res;
      const base = gridIndex(g, 0, iy, iz);
      for (let ix = ix0; ix <= ix1; ix++) {
        const wx = g.ox + ix * res;
        // Distance from voxel to the capsule axis segment P + t d, t∈[0,L].
        const vx = wx - s.x, vy = wy - s.y, vz = wz - s.z;
        let t = vy * dy + vz * dz;             // projection (d.x = 0)
        t = t < 0 ? 0 : (t > L ? L : t);
        const dyy = vy - t * dy, dzz = vz - t * dz;   // (d.x = 0 ⇒ x offset = vx)
        const rem = toolR - Math.sqrt(vx * vx + dyy * dyy + dzz * dzz);
        if (rem > g.field[base + ix]) g.field[base + ix] = rem;
      }
    }
  }
}

// Carve every feed (non-rapid) segment into the grid.
export function carve(
  g: VoxelGrid, segments: MotionSegment[], toolR: number, radiusFn: (y: number) => number,
  outerR: number
) {
  const step = Math.max(g.res, toolR * 0.6);
  for (const seg of segments) {
    if (seg.isRapid) continue;
    const samples = sampleSegment(seg, radiusFn, step);
    for (const s of samples) stampTool(g, s, toolR, outerR);
  }
}

// ── Surface Nets (naive dual contouring) ─────────────────────────────────────
// Canonical implementation after Mikola Lysenko (MIT). Extracts the isosurface
// at level 0 from a scalar field where <0 is inside (solid).
const CUBE_EDGES = new Int32Array(24);
const EDGE_TABLE = new Int32Array(256);
(function initTables() {
  let k = 0;
  for (let i = 0; i < 8; ++i) {
    for (let j = 1; j <= 4; j <<= 1) {
      const p = i ^ j;
      if (i <= p) { CUBE_EDGES[k++] = i; CUBE_EDGES[k++] = p; }
    }
  }
  for (let i = 0; i < 256; ++i) {
    let em = 0;
    for (let j = 0; j < 24; j += 2) {
      const a = !!(i & (1 << CUBE_EDGES[j]));
      const b = !!(i & (1 << CUBE_EDGES[j + 1]));
      em |= a !== b ? (1 << (j >> 1)) : 0;
    }
    EDGE_TABLE[i] = em;
  }
})();

export function gridToGeometry(g: VoxelGrid): THREE.BufferGeometry {
  const dims: [number, number, number] = [g.nx, g.ny, g.nz];
  // The grid already holds a signed-distance field (negative inside material).
  const data = g.field;

  const vertices: number[] = [];
  const indices: number[] = [];
  const R = [1, dims[0] + 1, (dims[0] + 1) * (dims[1] + 1)];
  const grid = new Float32Array(8);
  let buf_no = 1;
  let buffer = new Int32Array(R[2] * 2);
  let n = 0;
  const x = [0, 0, 0];

  for (x[2] = 0; x[2] < dims[2] - 1; ++x[2], n += dims[0], buf_no ^= 1, R[2] = -R[2]) {
    let m = 1 + (dims[0] + 1) * (1 + buf_no * (dims[1] + 1));
    for (x[1] = 0; x[1] < dims[1] - 1; ++x[1], ++n, m += 2) {
      for (x[0] = 0; x[0] < dims[0] - 1; ++x[0], ++n, ++m) {
        let mask = 0, gi = 0, idx = n;
        for (let k = 0; k < 2; ++k, idx += dims[0] * (dims[1] - 2)) {
          for (let j = 0; j < 2; ++j, idx += dims[0] - 2) {
            for (let i = 0; i < 2; ++i, ++gi, ++idx) {
              const p = data[idx];
              grid[gi] = p;
              mask |= (p < 0) ? (1 << gi) : 0;
            }
          }
        }
        if (mask === 0 || mask === 0xff) continue;

        const edge_mask = EDGE_TABLE[mask];
        const vv = [0, 0, 0];
        let e_count = 0;
        for (let i = 0; i < 12; ++i) {
          if (!(edge_mask & (1 << i))) continue;
          ++e_count;
          const e0 = CUBE_EDGES[i << 1], e1 = CUBE_EDGES[(i << 1) + 1];
          const g0 = grid[e0], g1 = grid[e1];
          let t = g0 - g1;
          if (Math.abs(t) > 1e-6) t = g0 / t; else continue;
          for (let j = 0, kk = 1; j < 3; ++j, kk <<= 1) {
            const a = e0 & kk, b = e1 & kk;
            if (a !== b) vv[j] += a ? 1 - t : t;
            else vv[j] += a ? 1 : 0;
          }
        }
        const s = 1 / e_count;
        for (let i = 0; i < 3; ++i) vv[i] = x[i] + s * vv[i];

        buffer[m] = vertices.length / 3;
        vertices.push(
          g.ox + vv[0] * g.res,
          g.oy + vv[1] * g.res,
          g.oz + vv[2] * g.res);

        for (let i = 0; i < 3; ++i) {
          if (!(edge_mask & (1 << i))) continue;
          const iu = (i + 1) % 3, iv = (i + 2) % 3;
          if (x[iu] === 0 || x[iv] === 0) continue;
          const du = R[iu], dv = R[iv];
          const a = buffer[m], b = buffer[m - du], c = buffer[m - du - dv], d = buffer[m - dv];
          if (mask & 1) {
            indices.push(a, b, c, a, c, d);
          } else {
            indices.push(a, d, c, a, c, b);
          }
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ── High-level convenience: build the finished-part mesh for a blowhole ──────
const MAT_PART = new THREE.MeshStandardMaterial({
  color: 0xcfd6dd,           // light metallic gray – "material that remains"
  metalness: 0.15,
  roughness: 0.75,
  side: THREE.DoubleSide,
  flatShading: false,
});

export interface BlowholeEndViewResult {
  mesh: THREE.Mesh;
  voxels: number;      // total grid cells (for status readout)
  triangles: number;
}

export function buildBlowholeEndView(
  stock: BlowholeStock,
  segments: MotionSegment[],
  toolDiam: number,
  yRange: [number, number],
  res = 0.15,
): BlowholeEndViewResult {
  const [yMin, yMax] = yRange;
  const axialMargin = Math.max(6, stock.xDim * 0.75);
  const xLo = yMin - axialMargin;
  const xHi = yMax + axialMargin;

  const g = buildStock(stock, xLo, xHi, res);
  const radiusFn = () => stock.outerR;      // constant radius over the stub
  carve(g, segments, toolDiam / 2, radiusFn, stock.outerR);

  const geo = gridToGeometry(g);
  const mesh = new THREE.Mesh(geo, MAT_PART);
  const tri = geo.index ? geo.index.count / 3 : 0;
  return { mesh, voxels: g.nx * g.ny * g.nz, triangles: tri };
}
