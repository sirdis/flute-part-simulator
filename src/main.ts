import * as THREE from 'three';
import { parseGCode, buildMotion } from './parser/GCodeParser';
import { parseYaml } from './parser/YamlParser';
import { Scene } from './renderer/Scene';
import { WorkpieceObject, FluteOverlay, buildGrid } from './renderer/Workpiece';
import { ToolPathObject, buildToolPathBuffers } from './renderer/ToolPath';
import { ToolObject } from './renderer/Tool';
import { Simulator } from './simulation/Simulator';
import { GCodePanel } from './ui/GCodePanel';
import type { WorkpieceParams, FlutePartGeometry, SimulatorState, MachineState } from './types';

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
const btnToggleYaml= document.getElementById('btn-toggle-yaml')!;
const btnToggleGrid= document.getElementById('btn-toggle-grid')!;
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
let flutePart: FlutePartGeometry | null = null;

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

// ── Helpers ──────────────────────────────────────────────────────────────────

// Format a raw MARK hole name into a compact musical label.
// "c-sharp-2" → "C♯2",  "b-flat" → "B♭",  "c-2" → "C2"
function formatNoteName(raw: string): string {
  return raw
    .replace(/-sharp/i, '♯')
    .replace(/-flat/i,  '♭')
    .replace(/-natural/i, '♮')
    .replace(/^([a-g])/i, (_, l: string) => l.toUpperCase())
    .replace(/-(\d+)$/, '$1');   // strip hyphen before trailing number
}

// ── Load GCode ───────────────────────────────────────────────────────────────
function loadGCode(text: string, filename: string) {
  const lines = parseGCode(text);
  const result = buildMotion(lines);

  // Update tool diameter from GCode comment
  toolObj.setToolDiam(result.toolDiameter);
  (toolDiamEl as HTMLInputElement).value = String(result.toolDiameter);

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
    const btn = document.createElement('button');
    btn.className = 'hole-btn';
    btn.textContent = formatNoteName(mark.name);
    btn.title = `${mark.name}  –  Zeile ${mark.lineIndex + 1}`;
    btn.addEventListener('click', () => {
      simulator.seekToLine(mark.lineIndex);
      gcPanel.scrollToLine(mark.lineIndex);
    });
    holeList.appendChild(btn);
  }

  // Focus camera on workpiece
  const center = new THREE.Vector3((yMin + yMax) / 2, 0, 0);
  scene3d.focusOn(center, wpParams.length / 2);
}

// ── Load YAML ────────────────────────────────────────────────────────────────
function loadYaml(text: string) {
  const parts = parseYaml(text);
  if (parts.length === 0) return;
  flutePart = parts[0]; // single part for now

  if (overlayObj) {
    scene3d.scene.remove(overlayObj.group);
  }
  // Align overlay: upper end of flute at xMax (largest GCode X value)
  overlayObj = new FluteOverlay(flutePart, loadedXMax || wpParams.xOrigin + wpParams.length);
  scene3d.scene.add(overlayObj.group);
  showYaml = true;                          // always start visible on (re-)load
  overlayObj.group.visible = true;
  wpObject.group.visible = false;           // overlay replaces the plain cylinder
  btnToggleYaml.style.display = '';
  btnToggleYaml.classList.add('active');
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
const vp = document.getElementById('viewport')!;
vp.addEventListener('dragover', (e) => { e.preventDefault(); dropOverlay.classList.add('active'); });
vp.addEventListener('dragleave', () => dropOverlay.classList.remove('active'));
vp.addEventListener('drop', (e) => {
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

// Toggle YAML overlay (cylinder follows inversely: hidden when overlay is shown)
btnToggleYaml.addEventListener('click', () => {
  showYaml = !showYaml;
  if (overlayObj) overlayObj.group.visible = showYaml;
  wpObject.group.visible = !showYaml;
  btnToggleYaml.classList.toggle('active', showYaml);
});

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  switch (e.key) {
    case ' ': e.preventDefault();
      if (simulator.currentState.isPlaying) simulator.pause(); else simulator.play();
      break;
    case 'ArrowLeft':
      simulator.seekToLine(simulator.currentState.lineIndex - 1);
      break;
    case 'ArrowRight':
      simulator.seekToLine(simulator.currentState.lineIndex + 1);
      break;
    case 'i': case 'I': scene3d.setView('iso'); break;
    case 't': case 'T': scene3d.setView('top'); break;
    case 's': case 'S': scene3d.setView('side'); break;
    case 'f': case 'F': scene3d.setView('front'); break;
  }
});

// ── Start render loop ────────────────────────────────────────────────────────
scene3d.start();
