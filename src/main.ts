import * as THREE from 'three';
import { parseGCode, buildMotion } from './parser/GCodeParser';
import { parseYaml } from './parser/YamlParser';
import { Scene } from './renderer/Scene';
import { WorkpieceObject, FluteOverlay, buildGrid } from './renderer/Workpiece';
import { ToolPathObject, buildToolPathBuffers } from './renderer/ToolPath';
import { ToolObject } from './renderer/Tool';
import { Simulator } from './simulation/Simulator';
import { GCodePanel } from './ui/GCodePanel';
import { formatNoteName, matchPart } from './utils';
import type { WorkpieceParams, FlutePartGeometry, SimulatorState, MachineState, MotionSegment } from './types';

// ── DOM refs ────────────────────────────────────────────────────────────────
const canvas       = document.createElement('canvas');
document.getElementById('viewport')!.prepend(canvas);
const btnLoadNc    = document.getElementById('btn-load-nc')!;
const btnLoadYaml  = document.getElementById('btn-load-yaml')!;
const fileNc       = document.getElementById('file-nc') as HTMLInputElement;
const fileYaml     = document.getElementById('file-yaml') as HTMLInputElement;
const btnPlay      = document.getElementById('btn-play')!;
const btnStop      = document.getElementById('btn-stop')!;
const btnStep      = document.getElementById('btn-step')!;
const scrubber     = document.getElementById('scrubber') as HTMLInputElement;
const speedSelect  = document.getElementById('speed-select') as HTMLSelectElement;
const progressInfo = document.getElementById('progress-info')!;
const toolDiamEl   = document.getElementById('tool-diam') as HTMLInputElement;
const wpDiamTop    = document.getElementById('wp-diam-top') as HTMLInputElement;
const wpDiamBot    = document.getElementById('wp-diam-bot') as HTMLInputElement;
const wpLength     = document.getElementById('wp-length') as HTMLInputElement;
const btnToggleYaml  = document.getElementById('btn-toggle-yaml')!;
const btnWireframe   = document.getElementById('btn-wireframe')!;
const socketPaddingEl= document.getElementById('socket-padding') as HTMLInputElement;
const socketPaddingWrap = document.getElementById('socket-padding-wrap')!;
const btnToggleGrid  = document.getElementById('btn-toggle-grid')!;
const btnRotCcw    = document.getElementById('btn-rot-ccw')!;
const btnRotCw     = document.getElementById('btn-rot-cw')!;
const vpEl         = document.getElementById('viewport')!;
const btnHelp      = document.getElementById('btn-help')!;
const helpBackdrop = document.getElementById('help-backdrop')!;
const wpOpacityEl  = document.getElementById('wp-opacity') as HTMLInputElement;
const partSelect   = document.getElementById('part-select') as HTMLSelectElement;
const gcFilename   = document.getElementById('gcode-filename')!;
const holeList     = document.getElementById('hole-list')!;
const dropOverlay  = document.getElementById('drop-overlay')!;
const cx = document.getElementById('cx')!, cy = document.getElementById('cy')!;
const cz = document.getElementById('cz')!, ca = document.getElementById('ca')!;
const cf = document.getElementById('cf')!;
const infoA        = document.getElementById('info-a')!;
const infoHoleDiv  = document.getElementById('info-hole')!;
const infoHoleName = document.getElementById('info-hole-name')!;

// View buttons
document.querySelectorAll('[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    const v = (btn as HTMLElement).dataset['view'] as 'iso'|'top'|'side'|'front';
    scene3d.setView(v);
  });
});

// ── State ───────────────────────────────────────────────────────────────────
let showYaml = true;
let showGrid = true;
let showWireframe = false;
let loadedParts: FlutePartGeometry[] = [];
let loadedGCodeFilename = '';
let loadedSegments: MotionSegment[] = [];

const wpParams: WorkpieceParams = {
  diamTop: 29, diamBottom: 27, length: 240, xOrigin: 0,
};

// ── 3D Setup ─────────────────────────────────────────────────────────────────
const scene3d   = new Scene(canvas);
const wpObject  = new WorkpieceObject(wpParams);
const toolPath  = new ToolPathObject();
const toolObj   = new ToolObject();
let   gridObj: THREE.Object3D = buildGrid(0, 240);
let   overlayObj: FluteOverlay | null = null;
let   loadedXMax = 0;   // GCode X of upper end of flute (for YAML overlay alignment)

scene3d.scene.add(wpObject.group, toolPath.group, toolObj.group, gridObj);
scene3d.setView('iso');

// ── GCode panel ──────────────────────────────────────────────────────────────
const gcPanel = new GCodePanel(
  document.getElementById('gcode-list-container')!,
  document.getElementById('gcode-list')!,
  (lineIndex: number) => {
    if (lineIndex >= 0) simulator.seekToLine(lineIndex);
  },
  (lineIndex: number) => {
    simulator.seekToLine(lineIndex);
  }
);

// ── Simulator ────────────────────────────────────────────────────────────────
const simulator = new Simulator((state: SimulatorState) => {
  updateCoords(state.machine);
  updateScrubber(state);
  updatePlayButton(state.isPlaying);
  updateInfoOverlay(state);
  updateToolPosition(state.machine);
  gcPanel.scrollToLine(state.lineIndex);

  if (state.currentHoleName) {
    infoHoleDiv.style.display = '';
    infoHoleName.textContent = state.currentHoleName;
  } else {
    infoHoleDiv.style.display = 'none';
  }
});

function updateCoords(m: MachineState) {
  cx.textContent = m.x.toFixed(3);
  cy.textContent = m.y.toFixed(3);
  cz.textContent = m.z.toFixed(3);
  ca.textContent = m.a.toFixed(2) + '°';
  cf.textContent = m.f.toFixed(0);
}

function updateScrubber(state: SimulatorState) {
  const pct = state.totalLines > 0 ? (state.lineIndex / state.totalLines) * 100 : 0;
  scrubber.value = String(pct);
  progressInfo.textContent = `${state.lineIndex + 1} / ${state.totalLines}`;
}

function updatePlayButton(isPlaying: boolean) {
  btnPlay.textContent = isPlaying ? '⏸' : '▶';
}

function updateInfoOverlay(state: SimulatorState) {
  infoA.textContent = state.machine.a.toFixed(2) + '°';
}

function updateToolPosition(m: MachineState) {
  // machine Y = longitudinal (world X), machine X = cross/radial
  const r = wpObject.radiusAt(m.y);
  const aRad = (m.a * Math.PI) / 180;
  const depth = r + m.z;
  const worldPos = new THREE.Vector3(
    m.y,                                           // machine Y → world X (longitudinal)
    depth * Math.sin(aRad) + m.x * Math.cos(aRad),
    depth * Math.cos(aRad) - m.x * Math.sin(aRad)
  );
  toolObj.setPosition(worldPos, m.a, m.y, r);
}

// ── Rotation around longitudinal axis ───────────────────────────────────────
// 90°/s  →  4 s per full 360° revolution
const ROT_DEG_PER_S = 90;
let rotAnim: { dir: 1 | -1; lastT: number; id: number } | null = null;

function startRotation(dir: 1 | -1) {
  if (rotAnim?.dir === dir) return;   // already running this direction
  stopRotation();
  const state = { dir, lastT: performance.now(), id: 0 };
  const tick = (now: number) => {
    const dt = (now - state.lastT) / 1000;
    state.lastT = now;
    scene3d.rotateAroundLongAxis(dir * ROT_DEG_PER_S * dt);
    state.id = requestAnimationFrame(tick);
    rotAnim = state;
  };
  state.id = requestAnimationFrame(tick);
  rotAnim = state;
}

function stopRotation() {
  if (rotAnim) { cancelAnimationFrame(rotAnim.id); rotAnim = null; }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// ── Load GCode ───────────────────────────────────────────────────────────────
function loadGCode(text: string, filename: string) {
  loadedGCodeFilename = filename;

  const lines = parseGCode(text);
  const result = buildMotion(lines);

  // Update tool diameter from GCode comment
  toolObj.setToolDiam(result.toolDiameter);
  toolDiamEl.value = String(result.toolDiameter);

  loadedSegments = result.segments;

  // Derive workpiece params from GCode Y range (machine Y = longitudinal axis)
  const [yMin, yMax] = result.yRange;
  loadedXMax = yMax;      // world X of upper (large-radius) end
  wpParams.xOrigin = yMin;
  wpParams.length = Math.max(10, yMax - yMin);
  wpObject.setParams(wpParams);

  // Rebuild grid
  scene3d.scene.remove(gridObj);
  gridObj = buildGrid(yMin - 20, yMax + 20);
  scene3d.scene.add(gridObj);
  gridObj.visible = showGrid;

  // Build toolpath geometry
  const radiusFn = (x: number) => wpObject.radiusAt(x);
  const buffers = buildToolPathBuffers(result.segments, radiusFn);
  toolPath.load(buffers);

  // Load simulator
  simulator.load(lines, result.machineStates, result.segments);
  scrubber.max = String(lines.length - 1);

  gcFilename.textContent = filename;
  gcPanel.load(lines);

  // Populate hole buttons
  holeList.innerHTML = '';
  for (const mark of result.marks) {
    // machineStates[i] = state BEFORE line i executes, so seeking to the MARK
    // comment line shows the previous hole's end position.  Find the first
    // motion command after the MARK and seek to the line AFTER it so the tool
    // is shown at the hole position (state after the rapid/feed move).
    // The GCode structure around each hole is:
    //   G00 Z<lift>           ← BEFORE the MARK
    //   (MARK Hole: <name>)   ← mark.lineIndex
    //   ...comments...
    //   G00 A<angle>          ← rotate
    //   G00 X<x> Y<y>         ← position
    //   G01 Z0                ← touch surface  ← we seek HERE
    //   G92 Z0                ← reset
    //
    // machineStates[i] = state BEFORE line i, so seeking to the first G01
    // gives us the state AFTER all the G00 rapids = tool at correct A,X,Y
    // (Z still lifted above surface, which is fine for visualisation).
    let seekIdx = mark.lineIndex + 1;
    for (let i = mark.lineIndex + 1; i < lines.length; i++) {
      const t = lines[i].command?.type;
      if (t === 'G01' || t === 'G02' || t === 'G03') {
        seekIdx = i;   // state BEFORE this line = after all G00 rapids
        break;
      }
    }

    const btn = document.createElement('button');
    btn.className = 'hole-btn';
    btn.textContent = formatNoteName(mark.name);
    btn.title = `${mark.name}  –  Zeile ${mark.lineIndex + 1}`;
    btn.addEventListener('click', () => {
      simulator.seekToLine(seekIdx);
      gcPanel.scrollToLine(seekIdx);
    });
    holeList.appendChild(btn);
  }

  // Focus camera on workpiece
  const center = new THREE.Vector3((yMin + yMax) / 2, 0, 0);
  scene3d.focusOn(center, wpParams.length / 2);

  // If YAML parts are already loaded, re-apply the matching part with the new xOffset
  if (loadedParts.length > 0) {
    const match = matchPart(loadedParts, filename);
    partSelect.value = match.name;
    applyOverlay(match);
  }
}

// ── Load YAML ────────────────────────────────────────────────────────────────

function applyOverlay(part: FlutePartGeometry) {
  // ── Pull workpiece geometry from YAML ──────────────────────────────────────
  wpParams.diamTop    = +(part.radiusAtZero * 2).toFixed(3);
  wpParams.diamBottom = +(part.radiusAtEnd  * 2).toFixed(3);
  wpParams.length     = part.boreLen;
  // Bore zero = machine Y=0 = loadedXMax (upper end); lower end at loadedXMax - boreLen
  wpParams.xOrigin    = loadedXMax - part.boreLen;

  wpObject.setParams(wpParams);

  // Rebuild toolpath so it uses the updated (YAML-derived) radiusFn
  if (loadedSegments.length > 0) {
    const radiusFn = (x: number) => wpObject.radiusAt(x);
    toolPath.load(buildToolPathBuffers(loadedSegments, radiusFn));
  }

  // Update GUI inputs to reflect the YAML values
  wpDiamTop.value = wpParams.diamTop.toString();
  wpDiamBot.value = wpParams.diamBottom.toString();
  wpLength.value  = wpParams.length.toString();

  // ── Rebuild overlay ────────────────────────────────────────────────────────
  // Find the socket tenon: the upper adjacent part's tenonAtLowerEnd inserts into
  // this part's upper bore end. This zone should be highlighted to warn if holes
  // from the GCode fall inside it and would break the joint.
  const partIndex = loadedParts.indexOf(part);
  const upperPart = partIndex > 0 ? loadedParts[partIndex - 1] : null;
  const socketTenon = upperPart?.tenonAtLowerEnd;

  if (overlayObj) scene3d.scene.remove(overlayObj.group);
  overlayObj = new FluteOverlay(part, loadedXMax || wpParams.xOrigin + wpParams.length, socketTenon);
  if (showWireframe) overlayObj.setWireframe(true);
  overlayObj.setSocketPadding(parseFloat(socketPaddingEl.value) || 0);
  overlayObj.setOpacity(parseInt(wpOpacityEl.value) / 100);
  scene3d.scene.add(overlayObj.group);
  showYaml = true;
  overlayObj.group.visible = true;
  wpObject.group.visible = false;
  btnToggleYaml.style.display = '';
  btnToggleYaml.classList.add('active');
  btnWireframe.style.display = '';
  btnWireframe.classList.toggle('active', showWireframe);
  socketPaddingWrap.style.display = socketTenon ? 'inline-flex' : 'none';
}

function loadYaml(text: string) {
  const parts = parseYaml(text);
  if (parts.length === 0) return;
  loadedParts = parts;

  // Populate part selector
  partSelect.innerHTML = '';
  for (const p of parts) {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    partSelect.appendChild(opt);
  }
  partSelect.style.display = parts.length > 1 ? '' : 'none';

  const match = matchPart(parts, loadedGCodeFilename);
  partSelect.value = match.name;
  applyOverlay(match);
}

// ── UI events ────────────────────────────────────────────────────────────────
btnLoadNc.addEventListener('click', () => fileNc.click());
btnLoadYaml.addEventListener('click', () => fileYaml.click());

fileNc.addEventListener('change', () => {
  const f = fileNc.files?.[0];
  if (!f) return;
  f.text().then(t => loadGCode(t, f.name));
});

fileYaml.addEventListener('change', () => {
  const f = fileYaml.files?.[0];
  if (!f) return;
  f.text().then(t => loadYaml(t));
});

// Drag & drop
vpEl.addEventListener('dragover', (e) => { e.preventDefault(); dropOverlay.classList.add('active'); });
vpEl.addEventListener('dragleave', () => dropOverlay.classList.remove('active'));
vpEl.addEventListener('drop', (e) => {
  e.preventDefault();
  dropOverlay.classList.remove('active');
  const files = Array.from(e.dataTransfer?.files ?? []);
  for (const f of files) {
    if (f.name.endsWith('.nc') || f.name.endsWith('.gcode')) f.text().then(t => loadGCode(t, f.name));
    if (f.name.endsWith('.yaml') || f.name.endsWith('.yml'))  f.text().then(t => loadYaml(t));
  }
});

// Transport
btnPlay.addEventListener('click', () => {
  if (simulator.currentState.isPlaying) simulator.pause();
  else simulator.play();
});
btnStop.addEventListener('click', () => simulator.stop());
btnStep.addEventListener('click', () => simulator.step());

scrubber.addEventListener('input', () => {
  simulator.seekToLine(parseInt(scrubber.value));
});

speedSelect.addEventListener('change', () => {
  simulator.setSpeed(parseFloat(speedSelect.value));
});

partSelect.addEventListener('change', () => {
  const part = loadedParts.find(p => p.name === partSelect.value);
  if (part) applyOverlay(part);
});

// Workpiece params
[wpDiamTop, wpDiamBot, wpLength].forEach(el => {
  el.addEventListener('change', () => {
    wpParams.diamTop    = parseFloat(wpDiamTop.value);
    wpParams.diamBottom = parseFloat(wpDiamBot.value);
    wpParams.length     = parseFloat(wpLength.value);
    wpObject.setParams(wpParams);
    if (overlayObj) overlayObj.setXOffset(wpParams.xOrigin);
  });
});

toolDiamEl.addEventListener('change', () => {
  toolObj.setToolDiam(parseFloat(toolDiamEl.value));
});

// Toggle grid
btnToggleGrid.addEventListener('click', () => {
  showGrid = !showGrid;
  gridObj.visible = showGrid;
  btnToggleGrid.classList.toggle('active', showGrid);
});

// Workpiece / overlay opacity slider
wpOpacityEl.addEventListener('input', () => {
  const v = parseInt(wpOpacityEl.value) / 100;
  wpObject.setOpacity(v);
  if (overlayObj) overlayObj.setOpacity(v);
});

// Toggle YAML overlay (cylinder follows inversely: hidden when overlay is shown)
btnToggleYaml.addEventListener('click', () => {
  showYaml = !showYaml;
  if (overlayObj) overlayObj.group.visible = showYaml;
  wpObject.group.visible = !showYaml;
  btnToggleYaml.classList.toggle('active', showYaml);
});

// Toggle wireframe / solid for the YAML overlay
btnWireframe.addEventListener('click', () => {
  showWireframe = !showWireframe;
  if (overlayObj) overlayObj.setWireframe(showWireframe);
  btnWireframe.classList.toggle('active', showWireframe);
});

// Socket padding (min. clearance beyond socket zone)
socketPaddingEl.addEventListener('change', () => {
  if (overlayObj) overlayObj.setSocketPadding(parseFloat(socketPaddingEl.value) || 0);
});

// Keyboard shortcuts
// We preventDefault on every handled key so the browser's find-as-you-type
// (Firefox quick-find) cannot intercept them.  The viewport has tabindex="0"
// and receives focus on load / click, which additionally keeps the browser
// out of the way.
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  switch (e.key) {
    case ' ':
      e.preventDefault();
      if (simulator.currentState.isPlaying) simulator.pause(); else simulator.play();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      simulator.seekToLine(simulator.currentState.lineIndex - 1);
      break;
    case 'ArrowRight':
      e.preventDefault();
      simulator.seekToLine(simulator.currentState.lineIndex + 1);
      break;
    case 'i': case 'I': e.preventDefault(); scene3d.setView('iso');   break;
    case 't': case 'T': e.preventDefault(); scene3d.setView('top');   break;
    case 's': case 'S': e.preventDefault(); scene3d.setView('side');  break;
    case 'f': case 'F': e.preventDefault(); scene3d.setView('front'); break;
    case 'r':
      e.preventDefault();
      if (!e.repeat) startRotation(1);   // start on first press, ignore auto-repeat
      break;
    case 'R':
      e.preventDefault();
      if (!e.repeat) startRotation(-1);
      break;
    case '?':
      e.preventDefault();
      helpBackdrop.classList.contains('open') ? closeHelp() : openHelp();
      break;
    case 'Escape':
      if (helpBackdrop.classList.contains('open')) { e.preventDefault(); closeHelp(); }
      break;
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'r' || e.key === 'R') stopRotation();
});

// ── Help modal ───────────────────────────────────────────────────────────────
function openHelp()  { helpBackdrop.classList.add('open');    btnHelp.classList.add('active'); }
function closeHelp() { helpBackdrop.classList.remove('open'); btnHelp.classList.remove('active'); vpEl.focus(); }

btnHelp.addEventListener('click', () =>
  helpBackdrop.classList.contains('open') ? closeHelp() : openHelp()
);
document.getElementById('btn-help-close')!.addEventListener('click', closeHelp);
helpBackdrop.addEventListener('click', (e) => { if (e.target === helpBackdrop) closeHelp(); });

// ── Rotation buttons (hold to spin) ──────────────────────────────────────────
function addHoldEvents(btn: HTMLElement, dir: 1 | -1) {
  btn.addEventListener('mousedown',   () => startRotation(dir));
  btn.addEventListener('touchstart',  () => startRotation(dir), { passive: true });
  btn.addEventListener('mouseup',     stopRotation);
  btn.addEventListener('mouseleave',  stopRotation);
  btn.addEventListener('touchend',    stopRotation);
  btn.addEventListener('touchcancel', stopRotation);
}
addHoldEvents(btnRotCcw, 1);
addHoldEvents(btnRotCw, -1);

// ── Viewport focus ────────────────────────────────────────────────────────────
// Give the viewport keyboard focus on load and on click so the browser's
// find-as-you-type never intercepts our shortcuts.
vpEl.focus();
vpEl.addEventListener('click', () => vpEl.focus());

// ── Start render loop ────────────────────────────────────────────────────────
scene3d.start();
