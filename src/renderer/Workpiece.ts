import * as THREE from 'three';
import type { WorkpieceParams, FlutePartGeometry, FluteTenonGeometry } from '../types';

// Simple fallback cylinder shown when no YAML overlay is loaded (or overlay toggled off).
// Warm gray – intentionally different from the YAML overlay blue so the user can
// immediately tell which representation is active.
const MAT_WP = new THREE.MeshStandardMaterial({
  color: 0xd4cfc8,   // warm light gray
  transparent: true,
  opacity: 0.55,
  side: THREE.DoubleSide,
  depthWrite: false,
});

// YAML overlay body – light blue
const MAT_BODY = new THREE.MeshStandardMaterial({
  color: 0xc8dff5,   // very light blue
  transparent: true,
  opacity: 0.55,
  side: THREE.DoubleSide,
  depthWrite: false,
});

const MAT_TENON = new THREE.MeshStandardMaterial({
  color: 0xb0cfe8,   // slightly deeper light blue for tenons
  transparent: true,
  opacity: 0.55,
  side: THREE.DoubleSide,
  depthWrite: false,
});

const MAT_HOLE = new THREE.MeshStandardMaterial({
  color: 0x3a80c8,   // medium blue – matches the blue scheme
  transparent: true,
  opacity: 0.85,
  side: THREE.DoubleSide,
});

const MAT_SOCKET = new THREE.MeshStandardMaterial({
  color: 0xe87820,   // amber/orange – socket zone indicator
  transparent: true,
  opacity: 0.35,
  side: THREE.DoubleSide,
  depthWrite: false,
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
  private opacity = 0.35;

  constructor(params: WorkpieceParams) {
    this.params = params;
    this.group = new THREE.Group();
    this.rebuild();
  }

  setOpacity(v: number) {
    this.opacity = v;
    this.group.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        (obj.material as THREE.MeshStandardMaterial).opacity = v;
      }
    });
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
    const bodyMat = MAT_WP.clone(); bodyMat.opacity = this.opacity;
    const mesh = new THREE.Mesh(geo, bodyMat);
    mesh.position.x = xOrigin;
    this.group.add(mesh);

    // Wire frame outline for clarity
    const wireGeo = cylinder(rBot, rTop, length);
    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(wireGeo),
      new THREE.LineBasicMaterial({ color: 0xa09890, opacity: 0.4, transparent: true })
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
  private opacity = 0.35;
  private socketTenon?: FluteTenonGeometry;

  constructor(part: FlutePartGeometry, xOffset = 0, socketTenon?: FluteTenonGeometry) {
    this.part = part;
    this.xOffset = xOffset;
    this.socketTenon = socketTenon;
    this.group = new THREE.Group();
    this.rebuild();
  }

  setOpacity(v: number) {
    this.opacity = v;
    this.group.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        (obj.material as THREE.MeshStandardMaterial).opacity = v;
      }
    });
  }

  private rebuild() {
    this.group.clear();
    const { radiusAtZero, radiusAtEnd, boreLen, tenonAtZero, tenonAtLowerEnd, holes } = this.part;

    // boreLen = visibleLen + ownTenons − upperPartTenon
    //   tenonAtZero:     this part's upper tenon  → hidden inside upper socket
    //   tenonAtLowerEnd: this part's lower tenon  → hidden inside lower socket
    // Both are machined on this part but not visible in the assembled flute,
    // so both must be subtracted to get the true visible body length.
    const visibleLen = boreLen
      - (tenonAtZero?.length    ?? 0)
      - (tenonAtLowerEnd?.length ?? 0);
    const lowerEnd   = this.xOffset - visibleLen;

    // Radius at the new lower end — interpolate along the full taper
    const taper  = boreLen > 0 ? visibleLen / boreLen : 1;
    const rLower = radiusAtZero * (1 - taper) + radiusAtEnd * taper;

    const bodyMat = MAT_BODY.clone(); bodyMat.opacity = this.opacity;
    const bodyGeo = cylinder(rLower, radiusAtZero, visibleLen);
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.x = lowerEnd;
    this.group.add(bodyMesh);

    if (tenonAtZero) {
      // Protrudes above Y=0 (into the barrel / upper joint)
      const tenonMat = MAT_TENON.clone(); tenonMat.opacity = this.opacity;
      const g = cylinder(tenonAtZero.radius, tenonAtZero.radius, tenonAtZero.length);
      const m = new THREE.Mesh(g, tenonMat);
      m.position.x = this.xOffset;
      this.group.add(m);
    }

    if (tenonAtLowerEnd) {
      // Protrudes below the visible body (goes into the next part's socket)
      const tenonMat = MAT_TENON.clone(); tenonMat.opacity = this.opacity;
      const g = cylinder(tenonAtLowerEnd.radius, tenonAtLowerEnd.radius, tenonAtLowerEnd.length);
      const m = new THREE.Mesh(g, tenonMat);
      m.position.x = lowerEnd - tenonAtLowerEnd.length;
      this.group.add(m);
    }

    for (const hole of holes) {
      const hx = this.xOffset + hole.centerX;
      const aRad = (hole.alpha * Math.PI) / 180;
      const r = this.radiusAt(hx);
      const discGeo = new THREE.CircleGeometry(hole.diameter / 2, 32);
      const disc = new THREE.Mesh(discGeo, MAT_HOLE.clone());
      disc.position.set(hx, r * Math.sin(aRad), r * Math.cos(aRad));
      const outward = new THREE.Vector3(0, Math.sin(aRad), Math.cos(aRad));
      disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), outward);
      this.group.add(disc);
    }

    // ── Socket zone: shows where the upper part's tenon is inserted ──────────
    // The tenon from the adjacent upper part sits at the top of this bore (xOffset),
    // extending inward by tenonLength. Highlight it in amber so the user can see
    // if any holes fall inside the socket zone (which would weaken the joint).
    if (this.socketTenon) {
      const { length: tenonLen, radius: tenonRad } = this.socketTenon;
      // Socket starts at xOffset (bore zero = upper end) and extends toward lower end
      const socketStart = this.xOffset - tenonLen;
      // Use bore radius at that zone (at xOffset, i.e. radiusAtZero), padded a tiny bit
      // to avoid z-fighting with the bore surface. We render it as a plain cylinder
      // at the tenon's own radius (which is the tenon OD = socket ID).
      const socketMat = MAT_SOCKET.clone();
      socketMat.opacity = Math.min(0.7, this.opacity + 0.25); // always somewhat visible
      const socketGeo = cylinder(tenonRad, tenonRad, tenonLen);
      const socketMesh = new THREE.Mesh(socketGeo, socketMat);
      socketMesh.position.x = socketStart;
      this.group.add(socketMesh);
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
  const matMinor = new THREE.LineBasicMaterial({ color: 0xdde2e8 });
  const matMajor = new THREE.LineBasicMaterial({ color: 0xbbc4cc });

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
  group.add(new THREE.Line(axGeo, new THREE.LineBasicMaterial({ color: 0x8090a0 })));

  return group;
}
