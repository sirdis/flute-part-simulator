import * as THREE from 'three';
import type { WorkpieceParams, FlutePartGeometry } from '../types';

const MAT_BODY = new THREE.MeshStandardMaterial({
  color: 0x8B6914,
  transparent: true,
  opacity: 0.35,
  side: THREE.DoubleSide,
  depthWrite: false,
});

const MAT_TENON = new THREE.MeshStandardMaterial({
  color: 0xa07820,
  transparent: true,
  opacity: 0.35,
  side: THREE.DoubleSide,
  depthWrite: false,
});

const MAT_HOLE = new THREE.MeshStandardMaterial({
  color: 0x4ec9b0,
  transparent: true,
  opacity: 0.7,
  side: THREE.DoubleSide,
});

// Three.js CylinderGeometry is along Y axis → rotate to align with X
function cylinder(rTop: number, rBot: number, len: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, 48, 1, true);
  g.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
  g.applyMatrix4(new THREE.Matrix4().makeTranslation(len / 2, 0, 0));
  return g;
}

export class WorkpieceObject {
  group: THREE.Group;
  private params: WorkpieceParams;

  constructor(params: WorkpieceParams) {
    this.params = params;
    this.group = new THREE.Group();
    this.rebuild();
  }

  private rebuild() {
    this.group.clear();
    const { diamTop, diamBottom, length, xOrigin } = this.params;
    const rTop = diamTop / 2;
    const rBot = diamBottom / 2;
    // world X = machine Y (longitudinal axis)
    // xOrigin = world X of lower end (small radius, machine Y min)
    // xOrigin+length = world X of upper end (large radius, machine Y max)
    // cylinder(firstArg, secondArg): firstArg is at world X=0, secondArg at world X=length
    const geo = cylinder(rBot, rTop, length);
    const mesh = new THREE.Mesh(geo, MAT_BODY.clone());
    mesh.position.x = xOrigin;
    this.group.add(mesh);

    // Wire frame outline for clarity
    const wireGeo = cylinder(rBot, rTop, length);
    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(wireGeo),
      new THREE.LineBasicMaterial({ color: 0x8B6914, opacity: 0.3, transparent: true })
    );
    wire.position.x = xOrigin;
    this.group.add(wire);
  }

  setParams(params: Partial<WorkpieceParams>) {
    this.params = { ...this.params, ...params };
    this.rebuild();
  }

  get centerX() { return this.params.xOrigin + this.params.length / 2; }

  // Takes world X coordinate (= machine Y, longitudinal position).
  // Returns the workpiece outer radius at that position.
  radiusAt(worldX: number): number {
    const { xOrigin, length, diamTop, diamBottom } = this.params;
    const t = Math.max(0, Math.min(1, (worldX - xOrigin) / length));
    // t=0 at xOrigin (lower end, small radius), t=1 at upper end (large radius)
    return (diamBottom / 2) * (1 - t) + (diamTop / 2) * t;
  }
}

export class FluteOverlay {
  group: THREE.Group;
  private part: FlutePartGeometry;
  xOffset: number;

  constructor(part: FlutePartGeometry, xOffset = 0) {
    this.part = part;
    this.xOffset = xOffset;
    this.group = new THREE.Group();
    this.rebuild();
  }

  private rebuild() {
    this.group.clear();
    const { radiusAtZero, radiusAtEnd, boreLen, tenonAtZero, tenonAtLowerEnd, holes } = this.part;
    // xOffset = GCode X of the UPPER end of the flute (= xMax from loaded GCode).
    // The body extends in the -X direction (toward machine home at lower X values).
    const lowerEnd = this.xOffset - boreLen;

    // Main body: lower end at X=lowerEnd (small radius), upper end at X=xOffset (large radius)
    const bodyGeo = cylinder(radiusAtEnd, radiusAtZero, boreLen);
    const bodyMesh = new THREE.Mesh(bodyGeo, MAT_BODY.clone());
    bodyMesh.position.x = lowerEnd;
    this.group.add(bodyMesh);

    // Upper tenon: at xOffset, extends in +X direction (beyond upper end)
    if (tenonAtZero) {
      const g = cylinder(tenonAtZero.radius, tenonAtZero.radius, tenonAtZero.length);
      const m = new THREE.Mesh(g, MAT_TENON.clone());
      m.position.x = this.xOffset;
      this.group.add(m);
    }

    // Lower tenon: at lowerEnd, extends in -X direction (below lower end of bore)
    if (tenonAtLowerEnd) {
      const g = cylinder(tenonAtLowerEnd.radius, tenonAtLowerEnd.radius, tenonAtLowerEnd.length);
      const m = new THREE.Mesh(g, MAT_TENON.clone());
      m.position.x = lowerEnd - tenonAtLowerEnd.length;
      this.group.add(m);
    }

    // Holes: centerX is negative = distance below upper end
    // → hx = xOffset + centerX  (e.g. centerX=-49.85 → hx = xOffset-49.85)
    for (const hole of holes) {
      const hx = this.xOffset + hole.centerX;   // centerX is negative
      const aRad = (hole.alpha * Math.PI) / 180;
      const r = this.radiusAt(hx);
      const discGeo = new THREE.CircleGeometry(hole.diameter / 2, 32);
      const disc = new THREE.Mesh(discGeo, MAT_HOLE.clone());
      disc.position.set(hx, r * Math.sin(aRad), r * Math.cos(aRad));
      // Orient disc normal to point radially outward from cylinder axis
      const outward = new THREE.Vector3(0, Math.sin(aRad), Math.cos(aRad));
      disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), outward);
      this.group.add(disc);
    }
  }

  private radiusAt(x: number): number {
    // x=xOffset → upper end (radiusAtZero, large)
    // x=xOffset-boreLen → lower end (radiusAtEnd, small)
    const t = Math.max(0, Math.min(1, (this.xOffset - x) / this.part.boreLen));
    return this.part.radiusAtZero * (1 - t) + this.part.radiusAtEnd * t;
  }

  setXOffset(offset: number) {
    this.xOffset = offset;
    this.rebuild();
  }
}

export function buildGrid(xMin: number, xMax: number): THREE.Object3D {
  const group = new THREE.Group();

  // Z-up world: X = longitudinal, Y = cross, Z = height above workpiece surface
  // Grid in XY plane (Z = -R_avg, the "floor" below workpiece) and
  // vertical lines in XZ plane (Y = 0, the side profile plane)
  const step = 10;
  const ext = 50;   // extent in Y and Z direction
  const matMinor = new THREE.LineBasicMaterial({ color: 0x2a2a2a });
  const matMajor = new THREE.LineBasicMaterial({ color: 0x3a3a3a });

  const minor: THREE.Vector3[] = [];
  const major: THREE.Vector3[] = [];

  // Vertical lines at each X: one in XZ plane (Y=0) showing side profile
  for (let x = Math.floor(xMin / step) * step; x <= xMax + step; x += step) {
    const isMajor = Math.round(x) % 50 === 0;
    const arr = isMajor ? major : minor;
    // XZ plane (side profile view — Y=0)
    arr.push(new THREE.Vector3(x, 0, -ext), new THREE.Vector3(x, 0, ext));
    // XY plane (top view — Z=0, the workpiece center axis plane)
    arr.push(new THREE.Vector3(x, -ext, 0), new THREE.Vector3(x, ext, 0));
  }

  // Cross lines (constant X, varying Y or Z)
  for (let v = -ext; v <= ext; v += step) {
    const isMajor = v % 50 === 0;
    const arr = isMajor ? major : minor;
    arr.push(new THREE.Vector3(xMin, v, 0), new THREE.Vector3(xMax, v, 0));
    arr.push(new THREE.Vector3(xMin, 0, v), new THREE.Vector3(xMax, 0, v));
  }

  if (minor.length) {
    const g = new THREE.BufferGeometry().setFromPoints(minor);
    group.add(new THREE.LineSegments(g, matMinor));
  }
  if (major.length) {
    const g = new THREE.BufferGeometry().setFromPoints(major);
    group.add(new THREE.LineSegments(g, matMajor));
  }

  // Workpiece axis line (X axis at Y=0, Z=0)
  const axGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(xMin, 0, 0), new THREE.Vector3(xMax, 0, 0),
  ]);
  group.add(new THREE.Line(axGeo, new THREE.LineBasicMaterial({ color: 0x505050 })));

  return group;
}
