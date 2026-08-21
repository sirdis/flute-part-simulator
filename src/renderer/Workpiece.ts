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
  color: 0xe87820,   // amber/orange – socket zone (tenon itself)
  transparent: true,
  opacity: 0.35,
  side: THREE.DoubleSide,
  depthWrite: false,
});

const MAT_PADDING = new THREE.MeshStandardMaterial({
  color: 0xc01808,   // clear red – minimum-clearance padding zone
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

// Wire-frame geometry: longitudinal lines + horizontal rings, no diagonal triangulation.
// Geometry runs from X=0 (rTop) to X=len (rBot), same layout as cylinder().
function wireframeCylinder(rTop: number, rBot: number, len: number, segs = 24, rings = 6): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  // Longitudinal lines
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    pts.push(new THREE.Vector3(0,   rTop * Math.cos(a), rTop * Math.sin(a)));
    pts.push(new THREE.Vector3(len, rBot * Math.cos(a), rBot * Math.sin(a)));
  }
  // Circular rings
  for (let ri = 0; ri <= rings; ri++) {
    const t = ri / rings;
    const r = rTop * (1 - t) + rBot * t;
    const x = t * len;
    for (let i = 0; i < segs; i++) {
      const a0 = (i       / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      pts.push(new THREE.Vector3(x, r * Math.cos(a0), r * Math.sin(a0)));
      pts.push(new THREE.Vector3(x, r * Math.cos(a1), r * Math.sin(a1)));
    }
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

// Material for wireframe overlay lines
const MAT_WIRE = new THREE.LineBasicMaterial({
  color: 0x2a7fc4,   // medium blue – clear on white, matches the blue scheme
  transparent: true,
  opacity: 0.7,
});

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

// Axial layout of a flute part in world coordinates (world X = machine Y).
// xOffset = world X of the bore-zero end (upper, large-radius end, machine Y=0).
export interface FluteAxialLayout {
  bodyLowerX: number;   // world X of the lower body end (= xOffset − boreLen)
  bodyUpperX: number;   // world X of the upper body end (= xOffset, bore zero)
  rLower: number;       // outer radius at the lower body end
  rUpper: number;       // outer radius at the upper body end (bore zero)
  upperTenon?: { lowerX: number; upperX: number; radius: number };
  lowerTenon?: { lowerX: number; upperX: number; radius: number };
}

// Pure geometry: where the body and the two tenons sit along the axis.
//
// Holes come from the G-code in bore coordinates: a hole at centerY=y sits at
// world X = xOffset + y (y ≤ 0), anywhere over the full bore [xOffset−boreLen,
// xOffset]. The visible body must therefore span the WHOLE boreLen.
//
// The tenons are turned sections that extend BEYOND the bore ends — the upper
// tenon above bore zero (world X > xOffset), the lower tenon below the bore end
// (world X < xOffset−boreLen). They are NOT sub-ranges of the bore, so they are
// never subtracted from the body length. (Subtracting them was the old bug that
// pushed a low-sitting hole — e.g. rh-part's "e" at −102.13 with boreLen 113.35
// and a 16.81 mm lower tenon — off the body and onto the tenon.)
export function computeFluteLayout(part: FlutePartGeometry, xOffset: number): FluteAxialLayout {
  const { boreLen, radiusAtZero, radiusAtEnd, tenonAtZero, tenonAtLowerEnd } = part;
  const bodyUpperX = xOffset;
  const bodyLowerX = xOffset - boreLen;
  const layout: FluteAxialLayout = {
    bodyLowerX, bodyUpperX,
    rLower: radiusAtEnd,
    rUpper: radiusAtZero,
  };
  if (tenonAtZero) {
    layout.upperTenon = {
      lowerX: bodyUpperX,
      upperX: bodyUpperX + tenonAtZero.length,
      radius: tenonAtZero.radius,
    };
  }
  if (tenonAtLowerEnd) {
    layout.lowerTenon = {
      lowerX: bodyLowerX - tenonAtLowerEnd.length,
      upperX: bodyLowerX,
      radius: tenonAtLowerEnd.radius,
    };
  }
  return layout;
}

export class FluteOverlay {
  group: THREE.Group;
  private part: FlutePartGeometry;
  xOffset: number;
  private opacity = 0.35;
  private socketTenon?: FluteTenonGeometry;
  private wireframe = false;
  private socketPadding = 3;   // mm – minimum clearance beyond socket zone

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
      if (!(obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments)) return;
      if (!obj.material) return;
      // Each object stores how its opacity should be derived from the slider value:
      //   opacityBoost  → always brighter than the body (socket / padding zones)
      //   minOpacity    → never goes below this value (wireframe lines)
      //   (neither)     → use slider value directly (body, tenons)
      let op = v;
      const boost = obj.userData['opacityBoost'] as number | undefined;
      const minOp = obj.userData['minOpacity']   as number | undefined;
      if (boost  !== undefined) op = Math.min(0.85, v + boost);
      if (minOp  !== undefined) op = Math.max(minOp, v);
      (obj.material as THREE.MeshStandardMaterial | THREE.LineBasicMaterial).opacity = op;
    });
  }

  setWireframe(on: boolean) {
    if (this.wireframe === on) return;
    this.wireframe = on;
    this.rebuild();
  }

  setSocketPadding(mm: number) {
    if (this.socketPadding === mm) return;
    this.socketPadding = mm;
    this.rebuild();
  }

  private rebuild() {
    this.group.clear();
    const { radiusAtZero, holes } = this.part;

    // Body spans the full bore; tenons sit beyond the bore ends (see computeFluteLayout).
    const layout = computeFluteLayout(this.part, this.xOffset);
    const visibleLen = layout.bodyUpperX - layout.bodyLowerX;   // = boreLen
    const lowerEnd = layout.bodyLowerX;
    const rLower = layout.rLower;

    // Helper: add a mesh with an opacity boost that survives setOpacity() calls
    const addMesh = (geo: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial,
                     posX: number, opacityBoost = 0) => {
      mat.opacity = Math.min(0.85, this.opacity + opacityBoost);
      const m = new THREE.Mesh(geo, mat);
      m.position.x = posX;
      if (opacityBoost) m.userData['opacityBoost'] = opacityBoost;
      this.group.add(m);
      return m;
    };

    if (this.wireframe) {
      // ── Wireframe mode: body and tenons as line meshes ─────────────────────
      // Lines always stay at least minOpacity regardless of the slider.
      const WIRE_MIN = 0.7;
      const addWire = (geo: THREE.BufferGeometry, posX: number) => {
        const m = MAT_WIRE.clone();
        m.opacity = Math.max(WIRE_MIN, this.opacity);
        const ls = new THREE.LineSegments(geo, m);
        ls.position.x = posX;
        ls.userData['minOpacity'] = WIRE_MIN;
        this.group.add(ls);
      };

      addWire(wireframeCylinder(rLower, radiusAtZero, visibleLen), lowerEnd);

      const ut = layout.upperTenon, lt = layout.lowerTenon;
      if (ut) {
        addWire(wireframeCylinder(ut.radius, ut.radius, ut.upperX - ut.lowerX, 24, 2), ut.lowerX);
      }
      if (lt) {
        addWire(wireframeCylinder(lt.radius, lt.radius, lt.upperX - lt.lowerX, 24, 2), lt.lowerX);
      }
    } else {
      // ── Solid mode ─────────────────────────────────────────────────────────
      addMesh(cylinder(rLower, radiusAtZero, visibleLen), MAT_BODY.clone(), lowerEnd);

      const ut = layout.upperTenon, lt = layout.lowerTenon;
      if (ut) {
        addMesh(cylinder(ut.radius, ut.radius, ut.upperX - ut.lowerX), MAT_TENON.clone(), ut.lowerX);
      }
      if (lt) {
        addMesh(cylinder(lt.radius, lt.radius, lt.upperX - lt.lowerX), MAT_TENON.clone(), lt.lowerX);
      }
    }

    // ── Holes (always rendered as solid discs in both modes) ─────────────────
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

    // ── Socket zone (amber) + padding zone (red) ──────────────────────────────
    if (this.socketTenon) {
      const { length: tenonLen, radius: tenonRad } = this.socketTenon;
      const socketStart = this.xOffset - tenonLen;

      // Amber: where the tenon physically sits — no holes allowed here (+0.3 boost)
      addMesh(cylinder(tenonRad, tenonRad, tenonLen),
              MAT_SOCKET.clone(), socketStart, 0.3);

      // Red: minimum-clearance zone just beyond the socket (+0.45 boost → clearly visible)
      if (this.socketPadding > 0) {
        addMesh(cylinder(tenonRad, tenonRad, this.socketPadding),
                MAT_PADDING.clone(), socketStart - this.socketPadding, 0.45);
      }
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

// Sprite label using a canvas texture – always faces the camera.
function makeLabel(text: string): THREE.Sprite {
  const W = 52, H = 20;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(130, 148, 163, 0.92)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  // World-space size: ~5 mm tall, canvas aspect ratio preserved
  sprite.scale.set(W / H * 5, 5, 1);
  return sprite;
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

  // ── Labels ──────────────────────────────────────────────────────────────────
  const lblOff = 5;   // gap between line end and label centre (mm)

  // Longitudinal (X) labels every 50 mm – placed above the XZ grid (z = +ext)
  // and above the XY grid (y = +ext), covering side and top views.
  for (let x = Math.floor(xMin / 50) * 50; x <= xMax + 1; x += 50) {
    if (x < xMin - 1) continue;
    const s = String(Math.round(x));
    const lXZ = makeLabel(s);
    lXZ.position.set(x, 0, ext + lblOff);
    group.add(lXZ);
    const lXY = makeLabel(s);
    lXY.position.set(x, ext + lblOff, 0);
    group.add(lXY);
  }

  // Cross labels every 10 mm – placed to the left (xMin side) of both planes.
  for (let v = -ext; v <= ext; v += step) {
    const s = String(v);
    // XY plane (top view): Y-axis values at z=0
    const lY = makeLabel(s);
    lY.position.set(xMin - lblOff, v, 0);
    group.add(lY);
    // XZ plane (side view): Z-axis values at y=0
    const lZ = makeLabel(s);
    lZ.position.set(xMin - lblOff, 0, v);
    group.add(lZ);
  }

  return group;
}
