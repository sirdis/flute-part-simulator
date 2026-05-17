import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class Scene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  private animId: number | null = null;
  private onRender?: () => void;

  constructor(canvas: HTMLCanvasElement) {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0xffffff);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xffffff, 0.002);

    // Camera — Z is "up" in our world (Z=0 is workpiece center axis,
    // Z>0 is above the surface). OrbitControls respects camera.up.
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(100, -180, 60);

    // Lights
    const amb = new THREE.AmbientLight(0xffffff, 0.4);
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(50, -150, 200);
    this.scene.add(amb, sun);

    // Orbit controls — must call lookAt BEFORE first update so OrbitControls
    // picks up the correct initial spherical coordinates for Z-up.
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.target.set(0, 0, 0);
    this.camera.lookAt(0, 0, 0);   // ← must happen before controls.update()
    this.controls.update();

    // Axis helper
    const axisHelper = new THREE.AxesHelper(20);
    this.scene.add(axisHelper);

    // Resize
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
    this.resize();
  }

  private resize() {
    const el = this.renderer.domElement.parentElement!;
    const w = el.clientWidth, h = el.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start(onRender?: () => void) {
    this.onRender = onRender;
    const loop = () => {
      this.animId = requestAnimationFrame(loop);
      this.controls.update();
      if (this.onRender) this.onRender();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  stop() {
    if (this.animId !== null) cancelAnimationFrame(this.animId);
  }

  setView(preset: 'iso' | 'top' | 'side' | 'front', target?: THREE.Vector3) {
    const t = target ?? this.controls.target.clone();
    const d = 200;
    // Z-up world: workpiece along X, Z is height above workpiece surface, Y is cross axis
    // top  = looking straight down (from +Z)
    // side = looking along Y axis (from -Y, seeing XZ plane — side profile of flute)
    // front= looking along X axis (from +X, seeing YZ plane — cross section)
    // iso  = from above-front-right
    const pos: Record<string, [number, number, number]> = {
      iso:   [t.x + d * 0.4, t.y - d * 0.8, t.z + d * 0.5],
      top:   [t.x,            t.y,            t.z + d],
      side:  [t.x,            t.y - d,        t.z + 10],
      front: [t.x + d,        t.y,            t.z + 10],
    };
    this.camera.position.set(...pos[preset]);
    this.camera.lookAt(t.x, t.y, t.z);
    this.controls.target.copy(t);
    this.controls.update();
  }

  focusOn(center: THREE.Vector3, radius: number) {
    const dir = this.camera.position.clone().sub(center).normalize();
    const dist = radius * 2.5;
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.lookAt(center.x, center.y, center.z);
    this.controls.target.copy(center);
    this.controls.update();
  }

  // Rotate the camera around the longitudinal axis (world X) by angleDeg degrees.
  // This lets the user inspect the flute from different rotational angles,
  // matching the A-axis of the machine.
  rotateAroundLongAxis(angleDeg: number) {
    // Pivot = point on the workpiece axis (world X at Y=0, Z=0) with the
    // same longitudinal position as the current orbit target.
    // We rotate both the camera position AND the orbit target around this pivot,
    // so the view centre rolls in place without any visual jump.
    const q = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      (angleDeg * Math.PI) / 180
    );
    const pivot = new THREE.Vector3(this.controls.target.x, 0, 0);

    // Roll camera around workpiece axis
    this.camera.position.sub(pivot).applyQuaternion(q).add(pivot);
    this.camera.up.applyQuaternion(q);

    // Roll the orbit target the same way (its X is unchanged; Y/Z rotate in place)
    this.controls.target.sub(pivot).applyQuaternion(q).add(pivot);

    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }
}
