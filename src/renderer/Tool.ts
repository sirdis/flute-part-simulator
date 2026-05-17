import * as THREE from 'three';

const MAT_TOOL_BODY  = new THREE.MeshStandardMaterial({ color: 0xcccccc });
const MAT_TOOL_TIP   = new THREE.MeshStandardMaterial({ color: 0xff6633 });
const MAT_A_RING     = new THREE.LineBasicMaterial({ color: 0xffcc00, opacity: 0.6, transparent: true });
const MAT_A_NEEDLE   = new THREE.LineBasicMaterial({ color: 0xffcc00 });

export class ToolObject {
  group: THREE.Group;
  private body: THREE.Mesh;
  private tip: THREE.Mesh;
  private toolDiam = 3.175;

  // A-axis indicator
  private aRing: THREE.Line;
  private aNeedle: THREE.Line;
  private aPos = new THREE.Vector3();
  private aRadius = 20;

  constructor() {
    this.group = new THREE.Group();

    // Body (shank)
    const bodyGeo = new THREE.CylinderGeometry(1, 1, 20, 16);
    bodyGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 10, 0));
    this.body = new THREE.Mesh(bodyGeo, MAT_TOOL_BODY.clone());

    // Tip
    const tipGeo = new THREE.CylinderGeometry(1, 1, 1, 16);
    tipGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, 0));
    this.tip = new THREE.Mesh(tipGeo, MAT_TOOL_TIP.clone());

    // Rotate so cylinder points in -Z (tool comes from above in Z)
    this.body.rotation.x = Math.PI / 2;
    this.tip.rotation.x  = Math.PI / 2;

    this.group.add(this.body, this.tip);

    // A-ring (circle around workpiece axis showing current rotation angle)
    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * 2 * Math.PI;
      ringPts.push(new THREE.Vector3(0, Math.sin(a), Math.cos(a)));
    }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
    this.aRing = new THREE.Line(ringGeo, MAT_A_RING);

    // Needle from center to current A position
    const needleGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1)
    ]);
    this.aNeedle = new THREE.Line(needleGeo, MAT_A_NEEDLE);

    this.group.add(this.aRing, this.aNeedle);
  }

  setToolDiam(d: number) {
    this.toolDiam = d;
    const r = d / 2;
    (this.body.geometry as THREE.CylinderGeometry).dispose();
    (this.tip.geometry as THREE.CylinderGeometry).dispose();

    const bodyGeo = new THREE.CylinderGeometry(r, r, 20, 16);
    bodyGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 10, 0));
    this.body.geometry = bodyGeo;
    this.body.rotation.x = Math.PI / 2;

    const tipGeo = new THREE.CylinderGeometry(r, r, 1, 16);
    this.tip.geometry = tipGeo;
    this.tip.rotation.x = Math.PI / 2;
  }

  // Set tool position in world coordinates and update A indicator
  setPosition(worldPos: THREE.Vector3, aDeg: number, workpieceX: number, radius: number) {
    this.group.position.copy(worldPos);

    // A-ring: centered on the workpiece axis at current X position
    this.aPos.set(workpieceX, 0, 0);
    this.aRadius = radius * 1.15;

    this.aRing.position.set(workpieceX, 0, 0);
    this.aRing.scale.set(1, this.aRadius, this.aRadius);

    // Needle points from center to current A angle
    const aRad = (aDeg * Math.PI) / 180;
    const ny = Math.sin(aRad), nz = Math.cos(aRad);
    const positions = (this.aNeedle.geometry.attributes['position'] as THREE.BufferAttribute);
    positions.setXYZ(0, workpieceX, 0, 0);
    positions.setXYZ(1, workpieceX, ny * this.aRadius, nz * this.aRadius);
    positions.needsUpdate = true;
  }
}
