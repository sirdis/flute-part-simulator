import * as THREE from 'three';

const MAT_TOOL_BODY  = new THREE.MeshStandardMaterial({ color: 0xcccccc });
const MAT_TOOL_TIP   = new THREE.MeshStandardMaterial({ color: 0xff6633 });
const MAT_A_RING     = new THREE.LineBasicMaterial({ color: 0xffcc00, opacity: 0.6, transparent: true });
const MAT_A_NEEDLE   = new THREE.LineBasicMaterial({ color: 0xffcc00 });

const _X_AXIS = new THREE.Vector3(1, 0, 0);

export class ToolObject {
  group: THREE.Group;
  // bodyGroup is positioned at worldPos and rotated with the A angle so the
  // tool shank always points radially outward from the workpiece axis.
  private bodyGroup: THREE.Group;
  private body: THREE.Mesh;
  private tip: THREE.Mesh;

  // A-axis indicator – children of the outer (unrotated) group so they are
  // always upright regardless of A.
  private aRing: THREE.Line;
  private aNeedle: THREE.Line;
  private aRadius = 20;

  constructor() {
    // Outer container – never moved or rotated; its local space == world space.
    this.group = new THREE.Group();

    // Sub-group that carries the tool body and follows worldPos + A orientation.
    this.bodyGroup = new THREE.Group();

    // Body (shank): CylinderGeometry default axis is Y.
    // Translate geometry so the base sits at local origin, then rotate.x = PI/2
    // so the cylinder points along the bodyGroup's +Z axis.
    const bodyGeo = new THREE.CylinderGeometry(1, 1, 20, 16);
    bodyGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 10, 0));
    this.body = new THREE.Mesh(bodyGeo, MAT_TOOL_BODY.clone());
    this.body.rotation.x = Math.PI / 2;

    // Tip: small cylinder at origin
    const tipGeo = new THREE.CylinderGeometry(1, 1, 1, 16);
    this.tip = new THREE.Mesh(tipGeo, MAT_TOOL_TIP.clone());
    this.tip.rotation.x = Math.PI / 2;

    this.bodyGroup.add(this.body, this.tip);
    this.group.add(this.bodyGroup);

    // A-ring: unit circle in the YZ plane, scaled to workpiece radius in setPosition.
    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * 2 * Math.PI;
      ringPts.push(new THREE.Vector3(0, Math.sin(a), Math.cos(a)));
    }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
    this.aRing = new THREE.Line(ringGeo, MAT_A_RING);

    // Needle: two points updated each frame (world coords = local coords here).
    const needleGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1),
    ]);
    this.aNeedle = new THREE.Line(needleGeo, MAT_A_NEEDLE);

    // Indicators live directly in the outer (world-aligned) group.
    this.group.add(this.aRing, this.aNeedle);
  }

  setToolDiam(d: number) {
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

  // Set tool position in world coordinates and update A indicator.
  setPosition(worldPos: THREE.Vector3, aDeg: number, workpieceX: number, radius: number) {
    const aRad = (aDeg * Math.PI) / 180;

    // Position the tool body at worldPos and orient it radially.
    // After rotation.x = PI/2 the body points along bodyGroup's local +Z.
    // Rotating bodyGroup by -aRad around X maps +Z → (0, sin A, cos A),
    // which is the radial outward direction at angle A. ✓
    this.bodyGroup.position.copy(worldPos);
    this.bodyGroup.quaternion.setFromAxisAngle(_X_AXIS, -aRad);

    // A-ring: centred on the workpiece axis at the current longitudinal position.
    // Outer group has no transform, so local coords == world coords here.
    this.aRadius = radius * 1.15;
    this.aRing.position.set(workpieceX, 0, 0);
    this.aRing.scale.set(1, this.aRadius, this.aRadius);

    // Needle: from workpiece axis centre to current A angle on the ring.
    const ny = Math.sin(aRad), nz = Math.cos(aRad);
    const pos = this.aNeedle.geometry.attributes['position'] as THREE.BufferAttribute;
    pos.setXYZ(0, workpieceX, 0, 0);
    pos.setXYZ(1, workpieceX, ny * this.aRadius, nz * this.aRadius);
    pos.needsUpdate = true;
  }
}
