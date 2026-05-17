export interface MachineState {
  x: number;
  y: number;
  z: number;
  a: number;
  f: number;
  isAbsolute: boolean;
}

export interface AxisParams {
  x?: number;
  y?: number;
  z?: number;
  a?: number;
}

export interface ArcParams extends AxisParams {
  i: number;
  j: number;
}

export type ParsedCommand =
  | { type: 'G00' | 'G01'; params: AxisParams }
  | { type: 'G02' | 'G03'; params: ArcParams }
  | { type: 'G92'; params: AxisParams }
  | { type: 'F'; value: number }
  | { type: 'S'; value: number }
  | { type: 'G21' | 'G90' | 'M03' | 'M05' | 'M30' };

export interface GCodeLine {
  lineIndex: number;  // 0-based index in array
  raw: string;
  command: ParsedCommand | null;
  comment: string;
  mark: string | null;  // hole name from MARK comment
}

// A processed motion segment ready for 3D rendering
export interface MotionSegment {
  fromMachine: MachineState;
  toMachine: MachineState;
  isRapid: boolean;
  lineIndex: number;
  // Arc parameters (G02/G03), undefined for linear moves
  arc?: { i: number; j: number; cw: boolean };
}

export interface WorkpieceParams {
  diamTop: number;    // outer diameter at upper end (mm)
  diamBottom: number; // outer diameter at lower end (mm)
  length: number;     // total length (mm)
  xOrigin: number;    // world X (= machine Y) of the lower end (small-radius end)
}

export interface FluteHole {
  name: string;
  centerX: number;  // from YAML centerX (negative = distance from upper end)
  alpha: number;    // rotation angle in degrees
  diameter: number; // diamX from YAML
}

export interface FluteTenonGeometry {
  length: number;
  radius: number;
}

export interface FlutePartGeometry {
  name: string;
  boreLen: number;
  radiusAtZero: number;
  radiusAtEnd: number;
  tenonAtZero?: FluteTenonGeometry;
  tenonAtLowerEnd?: FluteTenonGeometry;
  holes: FluteHole[];
}

export interface SimulatorState {
  lineIndex: number;
  machine: MachineState;
  isPlaying: boolean;
  speedMultiplier: number;
  totalLines: number;
  currentHoleName: string | null;
}
