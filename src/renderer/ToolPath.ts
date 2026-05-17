import * as THREE from 'three';
import type { MotionSegment } from '../types';

const ARC_STEPS = 36; // subdivisions per full arc

// Convert machine coordinates to world 3D, using the workpiece-frame transform.
// Machine axes: Y = longitudinal (along flute), X = cross/radial, Z = depth, A = rotation around Y
// World axes:   X = longitudinal (= machine Y), Y/Z = radial plane
// worldX = machY   (longitudinal)
// worldY = (radius(machY) + machZ) * sin(A) + machX * cos(A)
// worldZ = (radius(machY) + machZ) * cos(A) - machX * sin(A)
export function machineToWorld(
  mx: number, my: number, mz: number, aDeg: number,
  radiusFn: (y: number) => number
): THREE.Vector3 {
  const aRad = (aDeg * Math.PI) / 180;
  const r = radiusFn(my);              // radius at longitudinal position my
  const depth = r + mz;                // distance from cylinder centre (mz ≤ 0 when cutting)
  return new THREE.Vector3(
    my,                                // machine Y → world X (longitudinal)
    depth * Math.sin(aRad) + mx * Math.cos(aRad),
    depth * Math.cos(aRad) - mx * Math.sin(aRad)
  );
}

// Tessellate a G02/G03 arc into world points.
// The arc is in the XY machine plane (at constant A), starting from (fromX, fromY),
// center offset (i, j), ending at (toX, toY). Z interpolates linearly.
function tessellateArc(
  fx: number, fy: number, fz: number,
  tx: number, ty: number, tz: number,
  i: number, j: number, cw: boolean,
  a: number,
  radiusFn: (x: number) => number
): THREE.Vector3[] {
  const cx = fx + i;
  const cy = fy + j;
  const startAngle = Math.atan2(fy - cy, fx - cx);
  const endAngle   = Math.atan2(ty - cy, tx - cx);

  let delta = endAngle - startAngle;
  if (cw  && delta > 0) delta -= 2 * Math.PI;
  if (!cw && delta < 0) delta += 2 * Math.PI;
  if (delta === 0) delta = cw ? -2 * Math.PI : 2 * Math.PI;

  const steps = Math.max(8, Math.ceil(Math.abs(delta) / (Math.PI / ARC_STEPS)));
  const pts: THREE.Vector3[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const angle = startAngle + delta * t;
    const r = Math.sqrt(i * i + j * j);
    const px = cx + r * Math.cos(angle);
    const py = cy + r * Math.sin(angle);
    const pz = fz + (tz - fz) * t;
    pts.push(machineToWorld(px, py, pz, a, radiusFn));
  }
  return pts;
}

export interface ToolPathBuffers {
  rapidPositions: Float32Array;
  rapidCount: number;
  feedPositions: Float32Array;
  feedCount: number;
  // Mapping from segment index → position index in feed buffer (for seek)
  segmentToFeedPos: number[];
}

export function buildToolPathBuffers(
  segments: MotionSegment[],
  radiusFn: (x: number) => number
): ToolPathBuffers {
  const maxRapid = segments.filter(s => s.isRapid).length * 2 * 3;
  const maxFeed  = segments.filter(s => !s.isRapid).length * (ARC_STEPS + 2) * 2 * 3;

  const rapidPos = new Float32Array(Math.max(6, maxRapid));
  const feedPos  = new Float32Array(Math.max(6, maxFeed));
  let ri = 0, fi = 0;
  const segmentToFeedPos: number[] = [];

  const tw = (mx: number, my: number, mz: number, a: number) =>
    machineToWorld(mx, my, mz, a, radiusFn);

  for (const seg of segments) {
    const { fromMachine: fm, toMachine: tm, isRapid, arc } = seg;

    if (isRapid) {
      const from = tw(fm.x, fm.y, fm.z, fm.a);
      const to   = tw(tm.x, tm.y, tm.z, tm.a);
      if (ri + 6 <= rapidPos.length) {
        rapidPos[ri++] = from.x; rapidPos[ri++] = from.y; rapidPos[ri++] = from.z;
        rapidPos[ri++] = to.x;   rapidPos[ri++] = to.y;   rapidPos[ri++] = to.z;
      }
      segmentToFeedPos.push(-1);
    } else {
      segmentToFeedPos.push(fi);
      let pts: THREE.Vector3[];

      if (arc) {
        // Always use workpiece-frame arc tessellation (A-rotation applied correctly)
        pts = tessellateArc(
          fm.x, fm.y, fm.z, tm.x, tm.y, tm.z,
          arc.i, arc.j, arc.cw, fm.a,
          radiusFn
        );
      } else {
        const from = tw(fm.x, fm.y, fm.z, fm.a);
        const to   = tw(tm.x, tm.y, tm.z, tm.a);
        pts = [from, to];
      }

      for (let k = 0; k < pts.length - 1; k++) {
        if (fi + 6 > feedPos.length) break;
        feedPos[fi++] = pts[k].x;   feedPos[fi++] = pts[k].y;   feedPos[fi++] = pts[k].z;
        feedPos[fi++] = pts[k+1].x; feedPos[fi++] = pts[k+1].y; feedPos[fi++] = pts[k+1].z;
      }
    }
  }

  return {
    rapidPositions: rapidPos.slice(0, ri),
    rapidCount: ri / 3,
    feedPositions: feedPos.slice(0, fi),
    feedCount: fi / 3,
    segmentToFeedPos,
  };
}


const MAT_RAPID     = new THREE.LineBasicMaterial({ color: 0xb0bec8, opacity: 0.7, transparent: true });
const MAT_FEED      = new THREE.LineBasicMaterial({ color: 0x2255a0 });   // dark blue – upcoming path
const MAT_FEED_PAST = new THREE.LineBasicMaterial({ color: 0x0a2d6e });   // deeper blue – already cut

export class ToolPathObject {
  group: THREE.Group;
  private rapidLine: THREE.LineSegments;
  private feedLine: THREE.LineSegments;
  private feedDoneLine: THREE.LineSegments;

  // The full feed position buffer and its length
  private feedPositions: Float32Array = new Float32Array(0);
  private feedCount = 0;

  constructor() {
    this.group = new THREE.Group();
    this.rapidLine    = new THREE.LineSegments(new THREE.BufferGeometry(), MAT_RAPID);
    this.feedLine     = new THREE.LineSegments(new THREE.BufferGeometry(), MAT_FEED);
    this.feedDoneLine = new THREE.LineSegments(new THREE.BufferGeometry(), MAT_FEED_PAST);
    this.group.add(this.rapidLine, this.feedDoneLine, this.feedLine);
  }

  load(buffers: ToolPathBuffers) {
    this.feedPositions = buffers.feedPositions;
    this.feedCount = buffers.feedCount;

    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(buffers.rapidPositions, 3));
    this.rapidLine.geometry.dispose();
    this.rapidLine.geometry = rg;

    this.setProgress(0);
  }

  // Split feed path at given vertex index (0 = all future, feedCount = all done)
  setProgress(vertexIdx: number) {
    const done = Math.max(0, Math.min(this.feedCount, vertexIdx));
    const rest = this.feedCount - done;

    const doneArr = this.feedPositions.slice(0, done * 3);
    const restArr = this.feedPositions.slice(done * 3);

    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(doneArr, 3));
    this.feedDoneLine.geometry.dispose();
    this.feedDoneLine.geometry = dg;

    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(restArr, 3));
    this.feedLine.geometry.dispose();
    this.feedLine.geometry = fg;

    void done; void rest;
  }
}
