import type { MachineState, MotionSegment, SimulatorState, GCodeLine } from '../types';

export type SimulatorCallback = (state: SimulatorState) => void;

const DEFAULT_MACHINE: MachineState = { x: 0, y: 0, z: 0, a: 0, f: 600, isAbsolute: true };

export class Simulator {
  private lines: GCodeLine[] = [];
  private machineStates: MachineState[] = [];
  private segments: MotionSegment[] = [];
  private segmentByLine: Map<number, MotionSegment> = new Map();

  private state: SimulatorState = {
    lineIndex: 0,
    machine: { ...DEFAULT_MACHINE },
    isPlaying: false,
    speedMultiplier: 10,
    totalLines: 0,
    currentHoleName: null,
  };

  private onUpdate: SimulatorCallback;
  private rafId: number | null = null;
  private lastTime = 0;
  private timeAccum = 0; // ms of simulated time accumulated

  constructor(onUpdate: SimulatorCallback) {
    this.onUpdate = onUpdate;
  }

  load(
    lines: GCodeLine[],
    machineStates: MachineState[],
    segments: MotionSegment[]
  ) {
    this.lines = lines;
    this.machineStates = machineStates;
    this.segments = segments;

    this.segmentByLine = new Map();
    for (const seg of segments) {
      if (!this.segmentByLine.has(seg.lineIndex)) {
        this.segmentByLine.set(seg.lineIndex, seg);
      }
    }

    this.state = {
      lineIndex: 0,
      machine: { ...DEFAULT_MACHINE },
      isPlaying: false,
      speedMultiplier: this.state.speedMultiplier,
      totalLines: lines.length,
      currentHoleName: null,
    };
    this.emit();
  }

  seekToLine(lineIndex: number) {
    const idx = Math.max(0, Math.min(lineIndex, this.lines.length - 1));
    this.state.lineIndex = idx;
    this.state.machine = this.machineStates[idx]
      ? { ...this.machineStates[idx] }
      : { ...DEFAULT_MACHINE };
    this.state.currentHoleName = this.findCurrentHoleName(idx);
    this.emit();
  }

  step() {
    this.advanceLine();
    this.emit();
  }

  play() {
    if (this.state.isPlaying) return;
    this.state.isPlaying = true;
    this.lastTime = performance.now();
    this.timeAccum = 0;
    this.scheduleLoop();
    this.emit();
  }

  pause() {
    this.state.isPlaying = false;
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    this.emit();
  }

  stop() {
    this.pause();
    this.seekToLine(0);
  }

  setSpeed(multiplier: number) {
    this.state.speedMultiplier = multiplier;
  }

  get currentState() { return this.state; }

  private scheduleLoop() {
    this.rafId = requestAnimationFrame((now) => {
      if (!this.state.isPlaying) return;
      const dt = now - this.lastTime;
      this.lastTime = now;

      if (this.state.speedMultiplier === 0) {
        // Max speed: advance as many lines as possible in ~16ms frame budget
        const budget = Date.now() + 12;
        while (Date.now() < budget && this.state.isPlaying) {
          if (!this.advanceLine()) break;
        }
      } else {
        // Time-based: simulate real feed rate × speed multiplier
        this.timeAccum += dt * this.state.speedMultiplier;
        // Advance lines until we've consumed the accumulated time
        while (this.timeAccum > 0 && this.state.isPlaying) {
          const lineTime = this.estimateLineTime(this.state.lineIndex);
          if (lineTime > 0 && this.timeAccum < lineTime) break;
          this.timeAccum -= lineTime > 0 ? lineTime : 0;
          if (!this.advanceLine()) break;
        }
      }

      this.emit();
      if (this.state.isPlaying) this.scheduleLoop();
    });
  }

  private estimateLineTime(lineIdx: number): number {
    const seg = this.segmentByLine.get(lineIdx);
    if (!seg || seg.isRapid) return 0; // rapids: instant
    const fm = seg.fromMachine, tm = seg.toMachine;
    const dx = tm.x - fm.x, dy = tm.y - fm.y, dz = tm.z - fm.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const f = fm.f || 600;
    return (dist / f) * 60_000; // ms
  }

  // Returns false when at end of program
  private advanceLine(): boolean {
    const nextIdx = this.state.lineIndex + 1;
    if (nextIdx >= this.lines.length) {
      this.state.isPlaying = false;
      return false;
    }
    this.state.lineIndex = nextIdx;
    this.state.machine = this.machineStates[nextIdx]
      ? { ...this.machineStates[nextIdx] }
      : this.state.machine;
    this.state.currentHoleName = this.findCurrentHoleName(nextIdx);

    // Check M30
    const cmd = this.lines[nextIdx]?.command;
    if (cmd?.type === 'M30') {
      this.state.isPlaying = false;
      return false;
    }
    return true;
  }

  private findCurrentHoleName(lineIdx: number): string | null {
    // Walk backwards to find nearest MARK
    for (let i = lineIdx; i >= Math.max(0, lineIdx - 50); i--) {
      if (this.lines[i]?.mark) return this.lines[i].mark;
    }
    return null;
  }

  private emit() {
    this.onUpdate({ ...this.state });
  }
}
